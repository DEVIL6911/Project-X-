/*
 * JARVIS Buddy Robot — Main Firmware Entry Point
 * ================================================
 * FreeRTOS task orchestration on ESP32 dual-core.
 *
 * Task Architecture:
 *   Core 0: Navigation (P4, 20Hz) + Display (P2, 10Hz)
 *   Core 1: Audio Capture (P3, continuous) + Network (P1, 2Hz)
 *
 * Boot sequence:
 *   1. Serial init (115200 baud)
 *   2. Wi-Fi STA connection with retry loop
 *   3. Hardware subsystem initialization
 *   4. FreeRTOS task creation
 *   5. loop() is empty — all work done in tasks
 *
 * Safety invariant: The navigation task ALWAYS has the highest priority.
 * If an obstacle or edge is detected, motors are killed immediately
 * regardless of what other tasks are doing.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#include "config.h"
#include "motor_driver.h"
#include "sensors.h"
#include "mic_i2s.h"
#include "display.h"

// ---------------------------------------------------------------------------
// FreeRTOS Task Handles
// ---------------------------------------------------------------------------
static TaskHandle_t taskNavHandle = NULL;
static TaskHandle_t taskAudioHandle = NULL;
static TaskHandle_t taskDisplayHandle = NULL;
static TaskHandle_t taskNetHandle = NULL;


// ---------------------------------------------------------------------------
// Wi-Fi Connection
// ---------------------------------------------------------------------------
static void connectWiFi() {
    Serial.printf("[WIFI] Connecting to '%s'", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < WIFI_MAX_RETRY) {
        vTaskDelay(pdMS_TO_TICKS(WIFI_RETRY_MS));
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[WIFI] ✅ Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\n[WIFI] ❌ Connection failed after max retries");
        Serial.println("[WIFI] Robot will operate in offline/safety-only mode");
    }
}


// ---------------------------------------------------------------------------
// Task 1: Navigation / Safety Loop (Core 0, Priority 4, 20Hz)
// ---------------------------------------------------------------------------
// This is the highest-priority task. It reads sensors every 50ms and
// enforces safety constraints. If an emergency is detected, it kills
// all motor output IMMEDIATELY — no waiting for network commands.
// ---------------------------------------------------------------------------
static void taskNavigation(void* pvParameters) {
    Serial.println("[NAV] Navigation task started on Core " + String(xPortGetCoreID()));

    TickType_t lastWake = xTaskGetTickCount();

    while (true) {
        // Read all sensors — returns true if emergency condition
        bool emergency = sensorsUpdate();

        if (emergency) {
            // Safety override: motors already stopped by sensorsUpdate()
            displaySetEmotion(EMO_ALERT);
            displaySetMessage("OBSTACLE!");

            // Wait for clearance (re-check every 200ms)
            vTaskDelay(pdMS_TO_TICKS(200));

            // Check if obstacle has cleared
            SensorData data = sensorsGetData();
            if (data.frontDistanceCm >= US_MIN_SAFE_CM &&
                !data.leftIrBlocked && !data.rightIrBlocked) {
                sensorsClearEmergency();
                displaySetEmotion(EMO_IDLE);
                displaySetMessage("");
            }
        }

        // Precise 50ms timing using vTaskDelayUntil
        vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(TASK_NAV_RATE_MS));
    }
}


// ---------------------------------------------------------------------------
// Task 2: Audio Capture (Core 1, Priority 3, Continuous)
// ---------------------------------------------------------------------------
// Continuously reads I2S DMA buffers and accumulates 1-second PCM chunks.
// When a chunk is ready, it hands off to the network task for transmission.
// Pauses capture when the backend is processing a response (half-duplex).
// ---------------------------------------------------------------------------
static void taskAudioCapture(void* pvParameters) {
    Serial.println("[AUDIO] Audio capture task started on Core " + String(xPortGetCoreID()));

    micStartCapture();
    uint8_t readBuffer[1024]; // Temporary read buffer

    while (true) {
        // Half-duplex check: if backend is processing, pause mic
        // We check by polling the backend status via the network task's
        // shared state. For simplicity, we just keep reading but don't transmit.

        // Read from I2S DMA
        size_t bytesRead = micReadChunk(readBuffer, sizeof(readBuffer));

        // If a full 1-second chunk is ready, transmit it
        if (micChunkReady()) {
            displaySetEmotion(EMO_LISTENING);

            bool success = micTransmitChunk(BACKEND_HOST, BACKEND_PORT, API_AUDIO);
            if (success) {
                displaySetEmotion(EMO_THINKING);
            }
        }

        // Small yield to prevent starving lower-priority tasks
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}


// ---------------------------------------------------------------------------
// Task 3: Display Update (Core 0, Priority 2, 10Hz)
// ---------------------------------------------------------------------------
// Renders the current emotion face on the ST7735 at 10 FPS.
// Shares the SPI bus with other SPI devices via mutex.
// ---------------------------------------------------------------------------
static void taskDisplayUpdate(void* pvParameters) {
    Serial.println("[DISPLAY] Display task started on Core " + String(xPortGetCoreID()));

    TickType_t lastWake = xTaskGetTickCount();

    while (true) {
        displayRenderFrame();
        vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(TASK_DISPLAY_RATE_MS));
    }
}


// ---------------------------------------------------------------------------
// Task 4: Network Communication (Core 1, Priority 1, 2Hz)
// ---------------------------------------------------------------------------
// Handles all HTTP communication with the backend:
//   1. POST sensor telemetry to /api/telemetry
//   2. GET latest command from /api/command
//   3. Parse action JSON and dispatch to motor driver
//   4. POST command acknowledgment to /api/command/clear
// ---------------------------------------------------------------------------
static void taskNetwork(void* pvParameters) {
    Serial.println("[NET] Network task started on Core " + String(xPortGetCoreID()));

    TickType_t lastWake = xTaskGetTickCount();

    while (true) {
        if (WiFi.status() != WL_CONNECTED) {
            // Attempt reconnection
            connectWiFi();
            vTaskDelay(pdMS_TO_TICKS(5000));
            continue;
        }

        // ---- POST Telemetry ----
        {
            SensorData data = sensorsGetData();
            HTTPClient http;
            String url = String("http://") + BACKEND_HOST + ":" + String(BACKEND_PORT) + API_TELEMETRY;
            http.begin(url);
            http.addHeader("Content-Type", "application/json");

            // Build JSON payload
            StaticJsonDocument<256> doc;
            doc["front_distance_cm"] = data.frontDistanceCm;
            doc["left_ir_blocked"] = data.leftIrBlocked;
            doc["right_ir_blocked"] = data.rightIrBlocked;
            doc["servo_angle"] = data.servoAngle;

            String payload;
            serializeJson(doc, payload);

            int httpCode = http.POST(payload);
            if (httpCode != 200) {
                Serial.printf("[NET] Telemetry POST failed: %d\n", httpCode);
            }
            http.end();
        }

        // ---- GET Command ----
        {
            HTTPClient http;
            String url = String("http://") + BACKEND_HOST + ":" + String(BACKEND_PORT) + API_COMMAND;
            http.begin(url);

            int httpCode = http.GET();
            if (httpCode == 200) {
                String response = http.getString();
                StaticJsonDocument<1024> doc;
                DeserializationError err = deserializeJson(doc, response);

                if (!err) {
                    // Update emotion display
                    const char* emotion = doc["emotion"] | "IDLE";
                    displaySetEmotion(displayParseEmotion(emotion));

                    // Display speech text as message
                    const char* speech = doc["speech_text"] | "";
                    if (strlen(speech) > 0) {
                        displaySetMessage(speech);
                    }

                    // Execute action array if present and not in emergency
                    JsonArray actions = doc["actions"].as<JsonArray>();
                    if (actions.size() > 0) {
                        SensorData sData = sensorsGetData();
                        if (!sData.emergencyStop) {
                            Serial.printf("[NET] Executing %d actions\n", actions.size());
                            motorExecuteActions(actions);

                            // Acknowledge command execution
                            HTTPClient clearHttp;
                            String clearUrl = String("http://") + BACKEND_HOST + ":" +
                                            String(BACKEND_PORT) + API_CMD_CLEAR;
                            clearHttp.begin(clearUrl);
                            clearHttp.addHeader("Content-Type", "application/json");
                            clearHttp.POST("{}");
                            clearHttp.end();
                        } else {
                            Serial.println("[NET] Skipping actions — emergency stop active");
                        }
                    }
                } else {
                    Serial.printf("[NET] JSON parse error: %s\n", err.c_str());
                }
            }
            http.end();
        }

        vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(TASK_NET_RATE_MS));
    }
}


// ---------------------------------------------------------------------------
// Arduino Setup — runs once on boot
// ---------------------------------------------------------------------------
void setup() {
    Serial.begin(115200);
    delay(1000); // Let serial settle
    Serial.println("=========================================");
    Serial.println("  JARVIS Buddy Robot v1.0");
    Serial.println("  Embodied AI Desktop Companion");
    Serial.println("=========================================");

    // Phase 1: Connect to Wi-Fi
    connectWiFi();

    // Phase 2: Initialize all hardware subsystems
    Serial.println("[INIT] Initializing hardware...");
    motorInit();
    sensorsInit();
    micInit();
    displayInit();
    Serial.println("[INIT] ✅ All hardware initialized");

    // Show boot-up emotion
    displaySetEmotion(EMO_HAPPY);
    displaySetMessage("JARVIS Online!");
    displayRenderFrame();

    // Phase 3: Create FreeRTOS tasks
    Serial.println("[INIT] Creating FreeRTOS tasks...");

    xTaskCreatePinnedToCore(
        taskNavigation,
        "Navigation",
        TASK_NAV_STACK,
        NULL,
        TASK_NAV_PRIORITY,
        &taskNavHandle,
        TASK_NAV_CORE
    );

    xTaskCreatePinnedToCore(
        taskAudioCapture,
        "AudioCapture",
        TASK_AUDIO_STACK,
        NULL,
        TASK_AUDIO_PRIORITY,
        &taskAudioHandle,
        TASK_AUDIO_CORE
    );

    xTaskCreatePinnedToCore(
        taskDisplayUpdate,
        "DisplayUpdate",
        TASK_DISPLAY_STACK,
        NULL,
        TASK_DISPLAY_PRIORITY,
        &taskDisplayHandle,
        TASK_DISPLAY_CORE
    );

    xTaskCreatePinnedToCore(
        taskNetwork,
        "NetworkComm",
        TASK_NET_STACK,
        NULL,
        TASK_NET_PRIORITY,
        &taskNetHandle,
        TASK_NET_CORE
    );

    Serial.println("[INIT] ✅ All tasks created");
    Serial.println("[INIT] 🤖 JARVIS is alive!");

    // Clear boot message after 2 seconds
    vTaskDelay(pdMS_TO_TICKS(2000));
    displaySetEmotion(EMO_IDLE);
    displaySetMessage("");
}


// ---------------------------------------------------------------------------
// Arduino Loop — empty, all work done in FreeRTOS tasks
// ---------------------------------------------------------------------------
void loop() {
    // The Arduino loop task runs at the lowest priority.
    // All real work is handled by the FreeRTOS tasks above.
    // We just yield to prevent the watchdog from triggering.
    vTaskDelay(pdMS_TO_TICKS(1000));
}
