/*
 * JARVIS Buddy Robot — Sensor Suite Implementation
 * ==================================================
 * HC-SR04 ultrasonic with median filter, IR edge detection with
 * safety override, and SG90 servo spatial scanning.
 *
 * Key safety rule: If front distance < US_MIN_SAFE_CM OR any IR
 * detects a drop, the emergency stop flag is set IMMEDIATELY.
 * This overrides all motor commands — the navigation task checks
 * this flag every cycle.
 */

#include "sensors.h"
#include "config.h"
#include "motor_driver.h"

// FreeRTOS mutex for thread-safe sensor data access
static SemaphoreHandle_t _dataMutex = NULL;
static SensorData _data = {100.0, false, false, 90, false};


// ---------------------------------------------------------------------------
// HC-SR04 — Non-blocking distance measurement with median filter
// ---------------------------------------------------------------------------
static float _readUltrasonic() {
    // Send 10μs trigger pulse
    digitalWrite(ULTRASONIC_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(ULTRASONIC_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(ULTRASONIC_TRIG, LOW);

    // Measure echo pulse duration
    // pulseIn returns 0 on timeout — we treat that as "no obstacle" (max range)
    unsigned long duration = pulseIn(ULTRASONIC_ECHO, HIGH, US_TIMEOUT_US);

    if (duration == 0) {
        return 500.0;  // No echo = beyond max range
    }

    // Speed of sound ≈ 343 m/s = 0.0343 cm/μs
    // Distance = (duration × 0.0343) / 2
    return (duration * 0.0343) / 2.0;
}

static float _medianOfThree(float a, float b, float c) {
    // Simple median filter to reject outlier readings
    if (a > b) { float t = a; a = b; b = t; }
    if (b > c) { float t = b; b = c; c = t; }
    if (a > b) { float t = a; a = b; b = t; }
    return b;
}

static float _getFilteredDistance() {
    // Take 3 readings with small delays for median filtering
    float r1 = _readUltrasonic();
    delayMicroseconds(100);
    float r2 = _readUltrasonic();
    delayMicroseconds(100);
    float r3 = _readUltrasonic();
    return _medianOfThree(r1, r2, r3);
}


// ---------------------------------------------------------------------------
// Servo control — using LEDC for precise pulse width control
// ---------------------------------------------------------------------------
static void _setServoAngle(int angle) {
    // Map angle (0–180) to pulse width (500–2400 μs) within 16-bit resolution at 50Hz
    // Period = 20ms = 20000μs. Duty = pulseWidth / 20000 * 65535
    angle = constrain(angle, 0, 180);
    uint32_t pulseUs = map(angle, 0, 180, SERVO_MIN_US, SERVO_MAX_US);
    uint32_t duty = (pulseUs * 65535) / 20000;
    ledcWrite(SERVO_CH, duty);
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
void sensorsInit() {
    // Ultrasonic pins
    pinMode(ULTRASONIC_TRIG, OUTPUT);
    pinMode(ULTRASONIC_ECHO, INPUT);
    digitalWrite(ULTRASONIC_TRIG, LOW);

    // IR edge sensors — INPUT_PULLUP since they're active-LOW
    pinMode(IR_LEFT, INPUT_PULLUP);
    pinMode(IR_RIGHT, INPUT_PULLUP);

    // Servo PWM via LEDC
    ledcSetup(SERVO_CH, SERVO_FREQ, SERVO_RES);
    ledcAttachPin(SERVO_PIN, SERVO_CH);
    _setServoAngle(90);  // Center position

    // Create mutex for shared sensor data
    _dataMutex = xSemaphoreCreateMutex();
    if (_dataMutex == NULL) {
        Serial.println("[SENSOR] ❌ Failed to create data mutex!");
    }

    Serial.println("[SENSOR] Sensor suite initialized");
}


bool sensorsUpdate() {
    // Read ultrasonic with median filter
    float distance = _getFilteredDistance();

    // Read IR sensors (active-LOW: LOW = edge detected)
    bool leftEdge = (digitalRead(IR_LEFT) == LOW);
    bool rightEdge = (digitalRead(IR_RIGHT) == LOW);

    // Determine if emergency stop is needed
    bool emergency = false;
    if (distance < US_MIN_SAFE_CM) {
        emergency = true;
        Serial.printf("[SENSOR] ⚠️ Obstacle too close: %.1f cm\n", distance);
    }
    if (leftEdge) {
        emergency = true;
        Serial.println("[SENSOR] ⚠️ Left edge/drop detected!");
    }
    if (rightEdge) {
        emergency = true;
        Serial.println("[SENSOR] ⚠️ Right edge/drop detected!");
    }

    // Update shared data (mutex-protected)
    if (xSemaphoreTake(_dataMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        _data.frontDistanceCm = distance;
        _data.leftIrBlocked = leftEdge;
        _data.rightIrBlocked = rightEdge;

        if (emergency && !_data.emergencyStop) {
            _data.emergencyStop = true;
            motorEmergencyStop();  // Immediately halt all motors
        }

        xSemaphoreGive(_dataMutex);
    }

    return emergency;
}


SensorData sensorsGetData() {
    SensorData copy;
    if (xSemaphoreTake(_dataMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        copy = _data;
        xSemaphoreGive(_dataMutex);
    } else {
        // Return safe defaults if mutex timeout
        copy = {500.0, false, false, 90, true};
    }
    return copy;
}


void sensorsSweep(float* depthMap, int mapSize) {
    // Sweep servo from 0° to 180° in SERVO_SWEEP_DEG increments
    // At each position, take a filtered ultrasonic reading
    int idx = 0;
    for (int angle = 0; angle <= 180 && idx < mapSize; angle += SERVO_SWEEP_DEG) {
        _setServoAngle(angle);
        vTaskDelay(pdMS_TO_TICKS(100));  // Let servo settle

        depthMap[idx] = _getFilteredDistance();

        // Update servo angle in shared data
        if (xSemaphoreTake(_dataMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
            _data.servoAngle = angle;
            xSemaphoreGive(_dataMutex);
        }

        Serial.printf("[SENSOR] Sweep %d°: %.1f cm\n", angle, depthMap[idx]);
        idx++;
    }

    // Return servo to center
    _setServoAngle(90);
}


void sensorsClearEmergency() {
    if (xSemaphoreTake(_dataMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        _data.emergencyStop = false;
        xSemaphoreGive(_dataMutex);
    }
    Serial.println("[SENSOR] Emergency cleared");
}
