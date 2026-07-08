/*
 * JARVIS Buddy Robot — Motor Driver Header
 * ==========================================
 * DRV8833 dual H-bridge control via ESP32 LEDC PWM.
 * Provides movement primitives and JSON action array parsing.
 */

#ifndef MOTOR_DRIVER_H
#define MOTOR_DRIVER_H

#include <Arduino.h>
#include <ArduinoJson.h>

// Initialize LEDC PWM channels for all four motor pins
void motorInit();

// Movement primitives — speed is 0–255 (mapped to PWM duty cycle)
void motorForward(uint8_t speed);
void motorBackward(uint8_t speed);
void motorTurnLeft(uint8_t speed);
void motorTurnRight(uint8_t speed);
void motorStop();

// Emergency stop — immediately kills all motor output
// Called from safety-critical interrupt context
void motorEmergencyStop();

// Execute a JSON action array from the LLM response
// Format: [{"type":"FORWARD","duration_ms":500,"speed":150}, ...]
void motorExecuteActions(JsonArray actions);

// Check if an action sequence is currently executing
bool motorIsBusy();

#endif // MOTOR_DRIVER_H
