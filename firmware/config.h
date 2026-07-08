/*
 * JARVIS Buddy Robot — Global Configuration
 * ==========================================
 * Central pin definitions, network config, and FreeRTOS tuning.
 * ALL hardware constants live here — never use magic numbers in modules.
 *
 * PIN CONFLICT NOTES:
 *   Original spec had GPIO 5/18/4 double-assigned.
 *   HC-SR04 TRIG moved: GPIO 5  → GPIO 13
 *   HC-SR04 ECHO moved: GPIO 18 → GPIO 14
 *   Right IR moved:     GPIO 4  → GPIO 15
 *   Display keeps original pins (GPIO 5, 18, 4, 2, 23).
 */

#ifndef CONFIG_H
#define CONFIG_H

// =========================================================================
// Wi-Fi Credentials (hardcoded provisioning)
// =========================================================================
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"
#define WIFI_MAX_RETRY  20
#define WIFI_RETRY_MS   500

// =========================================================================
// Backend Server
// =========================================================================
#define BACKEND_HOST    "127.0.0.1"       // Local loopback IP
#define BACKEND_PORT    3000
#define API_TELEMETRY   "/api/telemetry"
#define API_AUDIO       "/api/audio"
#define API_COMMAND     "/api/command"
#define API_CMD_CLEAR   "/api/command/clear"

// =========================================================================
// Locomotion — DRV8833 Dual H-Bridge
// =========================================================================
#define MOTOR_IN1       32    // Left motor forward
#define MOTOR_IN2       33    // Left motor backward
#define MOTOR_IN3       16    // Right motor forward
#define MOTOR_IN4       17    // Right motor backward

// LEDC PWM channels for motor speed control
#define MOTOR_CH_IN1    0
#define MOTOR_CH_IN2    1
#define MOTOR_CH_IN3    2
#define MOTOR_CH_IN4    3
#define MOTOR_PWM_FREQ  1000  // 1kHz PWM frequency
#define MOTOR_PWM_RES   8     // 8-bit resolution (0–255)

// =========================================================================
// Spatial Awareness — HC-SR04 Ultrasonic (REMAPPED to avoid SPI conflict)
// =========================================================================
#define ULTRASONIC_TRIG 13    // Originally GPIO 5, moved to avoid ST7735 CS conflict
#define ULTRASONIC_ECHO 14    // Originally GPIO 18, moved to avoid ST7735 SCK conflict
#define US_TIMEOUT_US   30000 // 30ms timeout ≈ 5m max range
#define US_MIN_SAFE_CM  15.0  // Emergency stop threshold

// =========================================================================
// Edge/Drop Detection — IR Sensors
// =========================================================================
#define IR_LEFT         19    // Left IR sensor (unchanged)
#define IR_RIGHT        15    // Originally GPIO 4, moved to avoid ST7735 RESET conflict
// IR sensors are active-LOW: LOW = edge/drop detected

// =========================================================================
// Scanning Actuator — SG90 Servo
// =========================================================================
#define SERVO_PIN       22
#define SERVO_CH        4     // LEDC channel for servo PWM
#define SERVO_FREQ      50    // 50Hz for standard servos
#define SERVO_RES       16    // 16-bit resolution for fine angle control
#define SERVO_MIN_US    500   // 0° pulse width in microseconds
#define SERVO_MAX_US    2400  // 180° pulse width in microseconds
#define SERVO_SWEEP_DEG 15    // Degrees per sweep step

// =========================================================================
// Visual Interface — ST7735 1.8" SPI TFT (keeps original pins)
// =========================================================================
#define TFT_CS          5     // Chip Select
#define TFT_RST         4     // Reset
#define TFT_DC          2     // Data/Command
#define TFT_MOSI        23    // SPI MOSI (hardware SPI)
#define TFT_SCK         18    // SPI Clock (hardware SPI)
// Note: TFT uses hardware VSPI bus

// =========================================================================
// Audio Ingestion — INMP441 I2S MEMS Microphone
// =========================================================================
#define I2S_WS          25    // Word Select (LRCLK)
#define I2S_SCK         26    // Serial Clock (BCLK)
#define I2S_SD          27    // Serial Data (DIN)
#define I2S_PORT        I2S_NUM_0
#define I2S_SAMPLE_RATE 16000 // 16kHz for Whisper compatibility
#define I2S_BITS        16    // 16-bit depth
#define I2S_DMA_BUFFERS 8     // Number of DMA buffers
#define I2S_DMA_SAMPLES 512   // Samples per DMA buffer
#define AUDIO_CHUNK_MS  1000  // Accumulate 1 second before HTTP POST
#define AUDIO_CHUNK_BYTES (I2S_SAMPLE_RATE * 2) // 32KB per 1-second chunk (16-bit mono)

// =========================================================================
// FreeRTOS Task Configuration
// =========================================================================
#define TASK_NAV_STACK      4096
#define TASK_NAV_PRIORITY   4     // Highest — safety critical
#define TASK_NAV_CORE       0
#define TASK_NAV_RATE_MS    50    // 20Hz sensor loop

#define TASK_AUDIO_STACK    8192  // Larger for DMA + HTTP buffer
#define TASK_AUDIO_PRIORITY 3
#define TASK_AUDIO_CORE     1

#define TASK_DISPLAY_STACK  4096
#define TASK_DISPLAY_PRIORITY 2
#define TASK_DISPLAY_CORE   0
#define TASK_DISPLAY_RATE_MS 100  // 10Hz frame rate

#define TASK_NET_STACK      8192  // Larger for HTTP client buffers
#define TASK_NET_PRIORITY   1
#define TASK_NET_CORE       1
#define TASK_NET_RATE_MS    500   // 2Hz command poll

// =========================================================================
// Safety & Watchdog
// =========================================================================
#define WATCHDOG_TIMEOUT_S  5     // Task watchdog timeout
#define HEAP_MIN_FREE_KB    20    // Skip audio capture if heap below this

// =========================================================================
// Emotion states — must match backend EmotionType
// =========================================================================
enum Emotion {
    EMO_IDLE = 0,
    EMO_HAPPY,
    EMO_SAD,
    EMO_THINKING,
    EMO_ALERT,
    EMO_LISTENING,
    EMO_SLEEPING,
    EMO_EXCITED,
    EMO_CONFUSED,
    EMO_ANGRY,
    EMO_SHY,
    EMO_LOVE,
    EMO_SURPRISED,
    EMO_BORED,
    EMO_COUNT  // Total count sentinel
};

#endif // CONFIG_H
