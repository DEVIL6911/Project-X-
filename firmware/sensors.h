/*
 * JARVIS Buddy Robot — Sensor Suite Header
 * ==========================================
 * HC-SR04 ultrasonic, IR edge detection, and SG90 servo scanning.
 */

#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

// Shared sensor data structure — protected by mutex for cross-task access
struct SensorData {
    float frontDistanceCm;    // Ultrasonic reading (0–500 cm)
    bool leftIrBlocked;       // Left IR: true = edge/drop detected
    bool rightIrBlocked;      // Right IR: true = edge/drop detected
    int servoAngle;           // Current sweep position (0–180°)
    bool emergencyStop;       // Safety override flag
};

// Initialize sensor GPIO pins, servo PWM, and the data mutex
void sensorsInit();

// Read all sensors and update the shared SensorData struct
// Returns true if an emergency condition is detected
bool sensorsUpdate();

// Get a thread-safe copy of the current sensor data
SensorData sensorsGetData();

// Perform a full 180° servo sweep and build a depth map
// Returns an array of 13 distance readings (0°, 15°, 30°, ..., 180°)
void sensorsSweep(float* depthMap, int mapSize);

// Reset emergency stop flag (call after obstacle cleared)
void sensorsClearEmergency();

#endif // SENSORS_H
