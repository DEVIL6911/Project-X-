/*
 * JARVIS Buddy Robot — I2S Microphone Implementation
 * ====================================================
 * INMP441 MEMS mic connected via I2S with DMA double-buffering.
 *
 * Audio pipeline:
 *   1. I2S DMA continuously fills 512-sample buffers (hardware-managed)
 *   2. This module accumulates samples into a 1-second chunk (32KB)
 *   3. When chunk is full, it's HTTP POSTed to the backend
 *   4. Double buffering: one chunk fills while the other transmits
 *
 * Memory safety:
 *   - Total audio buffer footprint: 2 × 32KB = 64KB
 *   - Heap guard: if free heap < 20KB, capture is paused
 */

#include "mic_i2s.h"
#include "config.h"
#include <driver/i2s.h>
#include <HTTPClient.h>

// Double buffer for audio chunks
static uint8_t* _bufferA = nullptr;
static uint8_t* _bufferB = nullptr;
static uint8_t* _activeBuffer = nullptr;   // Currently being filled
static uint8_t* _readyBuffer = nullptr;    // Ready for transmission
static size_t _writePos = 0;               // Write position in active buffer
static volatile bool _chunkReady = false;  // Flag: ready buffer has data
static volatile bool _capturing = false;


void micInit() {
    // I2S configuration for INMP441 MEMS microphone
    const i2s_config_t i2sConfig = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
        .sample_rate = I2S_SAMPLE_RATE,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,  // INMP441 L/R pin to GND = left channel
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = I2S_DMA_BUFFERS,
        .dma_buf_len = I2S_DMA_SAMPLES,
        .use_apll = false,
        .tx_desc_auto_clear = false,
        .fixed_mclk = 0,
    };

    // Pin configuration
    const i2s_pin_config_t pinConfig = {
        .bck_io_num = I2S_SCK,
        .ws_io_num = I2S_WS,
        .data_out_num = I2S_PIN_NO_CHANGE,  // No TX (mic is RX only)
        .data_in_num = I2S_SD,
    };

    // Install and configure I2S driver
    esp_err_t err = i2s_driver_install(I2S_PORT, &i2sConfig, 0, NULL);
    if (err != ESP_OK) {
        Serial.printf("[MIC] ❌ I2S driver install failed: %d\n", err);
        return;
    }

    err = i2s_set_pin(I2S_PORT, &pinConfig);
    if (err != ESP_OK) {
        Serial.printf("[MIC] ❌ I2S pin config failed: %d\n", err);
        return;
    }

    // Allocate double buffers from PSRAM if available, else from heap
    _bufferA = (uint8_t*)malloc(AUDIO_CHUNK_BYTES);
    _bufferB = (uint8_t*)malloc(AUDIO_CHUNK_BYTES);

    if (!_bufferA || !_bufferB) {
        Serial.println("[MIC] ❌ Failed to allocate audio buffers!");
        if (_bufferA) { free(_bufferA); _bufferA = nullptr; }
        if (_bufferB) { free(_bufferB); _bufferB = nullptr; }
        return;
    }

    _activeBuffer = _bufferA;
    _readyBuffer = _bufferB;
    _writePos = 0;
    _chunkReady = false;

    Serial.printf("[MIC] I2S initialized: %dHz, %d-bit, mono\n",
                  I2S_SAMPLE_RATE, I2S_BITS);
    Serial.printf("[MIC] Audio buffers allocated: 2 × %d bytes\n", AUDIO_CHUNK_BYTES);
}


void micStartCapture() {
    if (!_bufferA || !_bufferB) {
        Serial.println("[MIC] Cannot start — buffers not allocated");
        return;
    }
    _capturing = true;
    _writePos = 0;
    i2s_start(I2S_PORT);
    Serial.println("[MIC] 🎤 Capture started");
}


void micStopCapture() {
    _capturing = false;
    i2s_stop(I2S_PORT);
    Serial.println("[MIC] 🔇 Capture stopped");
}


size_t micReadChunk(uint8_t* buffer, size_t maxBytes) {
    if (!_capturing) return 0;

    // Memory guard — skip capture if heap is critically low
    size_t freeHeap = heap_caps_get_free_size(MALLOC_CAP_8BIT);
    if (freeHeap < HEAP_MIN_FREE_KB * 1024) {
        Serial.printf("[MIC] ⚠️ Low heap (%d bytes) — skipping capture\n", freeHeap);
        return 0;
    }

    // Read from I2S DMA into the active buffer
    size_t bytesToRead = min(maxBytes, (size_t)(AUDIO_CHUNK_BYTES - _writePos));
    size_t bytesRead = 0;

    esp_err_t err = i2s_read(I2S_PORT,
                              _activeBuffer + _writePos,
                              bytesToRead,
                              &bytesRead,
                              pdMS_TO_TICKS(100));

    if (err != ESP_OK || bytesRead == 0) {
        return 0;
    }

    _writePos += bytesRead;

    // Check if we've accumulated a full 1-second chunk
    if (_writePos >= AUDIO_CHUNK_BYTES) {
        // Swap buffers — active becomes ready, ready becomes active
        uint8_t* temp = _activeBuffer;
        _activeBuffer = _readyBuffer;
        _readyBuffer = temp;
        _writePos = 0;
        _chunkReady = true;
    }

    // Copy requested data to caller's buffer
    size_t copySize = min(bytesRead, maxBytes);
    if (buffer != nullptr) {
        memcpy(buffer, _activeBuffer + _writePos - bytesRead, copySize);
    }

    return copySize;
}


bool micChunkReady() {
    return _chunkReady;
}


bool micTransmitChunk(const char* serverHost, int serverPort, const char* endpoint) {
    if (!_chunkReady) return false;

    HTTPClient http;
    String url = String("http://") + serverHost + ":" + String(serverPort) + endpoint;

    http.begin(url);
    // Send as multipart/form-data with the audio file
    // The backend expects a file upload named "audio"
    http.addHeader("Content-Type", "application/octet-stream");

    // Build a minimal WAV header + PCM data for the backend
    // WAV header is 44 bytes
    const int wavHeaderSize = 44;
    size_t totalSize = wavHeaderSize + AUDIO_CHUNK_BYTES;
    uint8_t* wavBuffer = (uint8_t*)malloc(totalSize);

    if (!wavBuffer) {
        Serial.println("[MIC] ❌ Failed to allocate WAV buffer for transmission");
        _chunkReady = false;
        http.end();
        return false;
    }

    // Write WAV header
    uint32_t dataSize = AUDIO_CHUNK_BYTES;
    uint32_t fileSize = totalSize - 8;
    uint16_t audioFormat = 1;      // PCM
    uint16_t numChannels = 1;      // Mono
    uint32_t sampleRate = I2S_SAMPLE_RATE;
    uint16_t bitsPerSample = 16;
    uint32_t byteRate = sampleRate * numChannels * bitsPerSample / 8;
    uint16_t blockAlign = numChannels * bitsPerSample / 8;

    // RIFF header
    memcpy(wavBuffer, "RIFF", 4);
    memcpy(wavBuffer + 4, &fileSize, 4);
    memcpy(wavBuffer + 8, "WAVE", 4);
    // fmt sub-chunk
    memcpy(wavBuffer + 12, "fmt ", 4);
    uint32_t fmtSize = 16;
    memcpy(wavBuffer + 16, &fmtSize, 4);
    memcpy(wavBuffer + 20, &audioFormat, 2);
    memcpy(wavBuffer + 22, &numChannels, 2);
    memcpy(wavBuffer + 24, &sampleRate, 4);
    memcpy(wavBuffer + 28, &byteRate, 4);
    memcpy(wavBuffer + 32, &blockAlign, 2);
    memcpy(wavBuffer + 34, &bitsPerSample, 2);
    // data sub-chunk
    memcpy(wavBuffer + 36, "data", 4);
    memcpy(wavBuffer + 40, &dataSize, 4);
    // PCM data
    memcpy(wavBuffer + 44, _readyBuffer, AUDIO_CHUNK_BYTES);

    // Use multipart form upload
    // We need to format as multipart/form-data for FastAPI's File() parameter
    String boundary = "----JarvisAudioBoundary";
    String header = "--" + boundary + "\r\n"
                    "Content-Disposition: form-data; name=\"audio\"; filename=\"chunk.wav\"\r\n"
                    "Content-Type: audio/wav\r\n\r\n";
    String footer = "\r\n--" + boundary + "--\r\n";

    size_t bodySize = header.length() + totalSize + footer.length();
    http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);

    // Create the full body
    uint8_t* body = (uint8_t*)malloc(bodySize);
    if (!body) {
        Serial.println("[MIC] ❌ Failed to allocate HTTP body buffer");
        free(wavBuffer);
        _chunkReady = false;
        http.end();
        return false;
    }

    size_t pos = 0;
    memcpy(body + pos, header.c_str(), header.length()); pos += header.length();
    memcpy(body + pos, wavBuffer, totalSize); pos += totalSize;
    memcpy(body + pos, footer.c_str(), footer.length()); pos += footer.length();

    int httpCode = http.POST(body, bodySize);

    free(wavBuffer);
    free(body);
    _chunkReady = false;
    http.end();

    if (httpCode == 200) {
        Serial.println("[MIC] ✅ Audio chunk transmitted successfully");
        return true;
    } else {
        Serial.printf("[MIC] ❌ Audio transmission failed: HTTP %d\n", httpCode);
        return false;
    }
}
