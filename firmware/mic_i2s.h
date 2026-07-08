/*
 * JARVIS Buddy Robot — I2S Microphone Header
 * ============================================
 * INMP441 MEMS microphone with DMA buffer management
 * and HTTP POST audio transmission.
 */

#ifndef MIC_I2S_H
#define MIC_I2S_H

#include <Arduino.h>

// Initialize I2S peripheral with DMA for INMP441
void micInit();

// Start continuous audio capture into DMA buffers
void micStartCapture();

// Stop audio capture and release DMA resources
void micStopCapture();

// Read accumulated audio data into a provided buffer
// Returns number of bytes read, or 0 if insufficient data
size_t micReadChunk(uint8_t* buffer, size_t maxBytes);

// Check if a full audio chunk (1 second) is ready for transmission
bool micChunkReady();

// Transmit the current audio chunk to the backend via HTTP POST
// Returns true if the server accepted the audio
bool micTransmitChunk(const char* serverHost, int serverPort, const char* endpoint);

#endif // MIC_I2S_H
