/*
 * JARVIS Buddy Robot — Motor Driver Implementation
 * ==================================================
 * DRV8833 dual H-bridge control using ESP32 LEDC hardware PWM.
 *
 * Motor truth table (DRV8833):
 *   IN1=HIGH, IN2=LOW  → Forward
 *   IN1=LOW,  IN2=HIGH → Backward
 *   IN1=LOW,  IN2=LOW  → Coast (free spin)
 *   IN1=HIGH, IN2=HIGH → Brake (active stop)
 *
 * Speed control: PWM duty on the active pin, other pin LOW.
 */

#include "motor_driver.h"
#include "config.h"

// Atomic flag for emergency stop — can be set from any task/ISR
static volatile bool _emergencyActive = false;
static volatile bool _isBusy = false;


void motorInit() {
    // Configure LEDC PWM channels for each motor pin
    ledcSetup(MOTOR_CH_IN1, MOTOR_PWM_FREQ, MOTOR_PWM_RES);
    ledcSetup(MOTOR_CH_IN2, MOTOR_PWM_FREQ, MOTOR_PWM_RES);
    ledcSetup(MOTOR_CH_IN3, MOTOR_PWM_FREQ, MOTOR_PWM_RES);
    ledcSetup(MOTOR_CH_IN4, MOTOR_PWM_FREQ, MOTOR_PWM_RES);

    ledcAttachPin(MOTOR_IN1, MOTOR_CH_IN1);
    ledcAttachPin(MOTOR_IN2, MOTOR_CH_IN2);
    ledcAttachPin(MOTOR_IN3, MOTOR_CH_IN3);
    ledcAttachPin(MOTOR_IN4, MOTOR_CH_IN4);

    motorStop();
    Serial.println("[MOTOR] DRV8833 initialized on LEDC channels 0-3");
}


void motorForward(uint8_t speed) {
    if (_emergencyActive) return;
    // Left motor forward + Right motor forward
    ledcWrite(MOTOR_CH_IN1, speed);
    ledcWrite(MOTOR_CH_IN2, 0);
    ledcWrite(MOTOR_CH_IN3, speed);
    ledcWrite(MOTOR_CH_IN4, 0);
}


void motorBackward(uint8_t speed) {
    if (_emergencyActive) return;
    // Left motor backward + Right motor backward
    ledcWrite(MOTOR_CH_IN1, 0);
    ledcWrite(MOTOR_CH_IN2, speed);
    ledcWrite(MOTOR_CH_IN3, 0);
    ledcWrite(MOTOR_CH_IN4, speed);
}


void motorTurnLeft(uint8_t speed) {
    if (_emergencyActive) return;
    // Left motor backward + Right motor forward (pivot turn)
    ledcWrite(MOTOR_CH_IN1, 0);
    ledcWrite(MOTOR_CH_IN2, speed);
    ledcWrite(MOTOR_CH_IN3, speed);
    ledcWrite(MOTOR_CH_IN4, 0);
}


void motorTurnRight(uint8_t speed) {
    if (_emergencyActive) return;
    // Left motor forward + Right motor backward (pivot turn)
    ledcWrite(MOTOR_CH_IN1, speed);
    ledcWrite(MOTOR_CH_IN2, 0);
    ledcWrite(MOTOR_CH_IN3, 0);
    ledcWrite(MOTOR_CH_IN4, speed);
}


void motorStop() {
    // Active brake — both pins HIGH on each motor
    ledcWrite(MOTOR_CH_IN1, 0);
    ledcWrite(MOTOR_CH_IN2, 0);
    ledcWrite(MOTOR_CH_IN3, 0);
    ledcWrite(MOTOR_CH_IN4, 0);
}


void motorEmergencyStop() {
    _emergencyActive = true;
    motorStop();
    Serial.println("[MOTOR] ⚠️ EMERGENCY STOP ACTIVATED");
}


void motorExecuteActions(JsonArray actions) {
    _isBusy = true;
    _emergencyActive = false;  // Clear emergency for new command sequence

    for (JsonObject action : actions) {
        // Bail if emergency triggered mid-sequence
        if (_emergencyActive) {
            Serial.println("[MOTOR] Action sequence aborted — emergency stop");
            break;
        }

        const char* type = action["type"] | "STOP";
        int duration = action["duration_ms"] | 500;
        int speed = action["speed"] | 150;

        // Clamp values to safe ranges
        speed = constrain(speed, 0, 255);
        duration = constrain(duration, 0, 5000);

        Serial.printf("[MOTOR] Executing: %s speed=%d duration=%dms\n", type, speed, duration);

        if (strcmp(type, "FORWARD") == 0) {
            motorForward(speed);
        } else if (strcmp(type, "BACKWARD") == 0) {
            motorBackward(speed);
        } else if (strcmp(type, "TURN_LEFT") == 0) {
            motorTurnLeft(speed);
        } else if (strcmp(type, "TURN_RIGHT") == 0) {
            motorTurnRight(speed);
        } else if (strcmp(type, "STOP") == 0) {
            motorStop();
        } else if (strcmp(type, "SCAN") == 0) {
            // Scan is handled by sensors module, just pause here
            motorStop();
        }

        // Non-blocking delay using vTaskDelay (yields to other FreeRTOS tasks)
        if (duration > 0) {
            vTaskDelay(pdMS_TO_TICKS(duration));
        }
    }

    motorStop();  // Always stop after completing action sequence
    _isBusy = false;
}


bool motorIsBusy() {
    return _isBusy;
}
