# JARVIS Buddy Robot — Embodied AI Desktop Companion

A three-tier Embodied AI robotics system with ESP32 FreeRTOS firmware, Python FastAPI cloud brain, and a browser-based hardware simulator.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Web Simulator (Browser)                      │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ Room View   │  │ Emotion Face │  │ Chat + Motor Controls   │  │
│  │ (Canvas 2D) │  │ (14 states)  │  │ (Text/Mic/D-pad/WASD)  │  │
│  └──────┬──────┘  └──────────────┘  └────────────┬────────────┘  │
│         │         Same HTTP API                   │              │
│         └─────────────────┬───────────────────────┘              │
└───────────────────────────┼──────────────────────────────────────┘
                            │  HTTP (WiFi)
┌───────────────────────────┼──────────────────────────────────────┐
│              Python FastAPI Server (Cloud Brain)                  │
│  ┌──────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ REST API  │→│ Whisper STT│→│ Gemini/     │→│ Avatar TTS   │  │
│  │ Router    │  │ (small)    │  │ Ollama LLM  │  │ (pyttsx3)   │  │
│  └────┬─────┘  └────────────┘  └─────────────┘  └─────────────┘  │
│       │                                                          │
│  ┌────┴─────────────────────────────────────────────────────────┐ │
│  │  SQLite + SQLAlchemy (Interaction Logs + Telemetry Memory)   │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                            │  HTTP (WiFi)
┌───────────────────────────┼──────────────────────────────────────┐
│              ESP32 Firmware (FreeRTOS Real-Time)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │ Navigation   │  │ Audio I2S    │  │ Network + Display       │ │
│  │ P4, Core 0   │  │ P3, Core 1   │  │ P1-2, Both Cores       │ │
│  │ Sensors+Motor│  │ INMP441 DMA  │  │ HTTP + ST7735 SPI      │ │
│  └──────────────┘  └──────────────┘  └─────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Start the Backend

```bash
cd backend
pip install -r requirements.txt
```

Edit `.env` with your configuration:
```env
# Use Gemini API
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key_here

# OR use local Ollama
LLM_PROVIDER=ollama
OLLAMA_MODEL=mistral
```

Start the server:
```bash
python app.py
```

The server starts at `http://localhost:8080`. Swagger docs at `http://localhost:8080/docs`.

### 2. Open the Simulator

Simply open `simulator/index.html` in your browser. No build step needed.

1. Enter the backend URL (default: `http://localhost:8080`)
2. Click **Connect**
3. Use **WASD keys** or the **D-pad** to drive the robot
4. Click the **microphone** button to speak, or type a message
5. Drag obstacles around the room to test sensors

### 3. Flash ESP32 (Optional — for real hardware)

Requirements:
- Arduino IDE with ESP32 board support
- Libraries: `ArduinoJson`, `Adafruit_ST7735`, `Adafruit_GFX`

1. Edit `firmware/config.h` with your WiFi credentials and PC's IP
2. Open `firmware/main.ino` in Arduino IDE
3. Select board: **ESP32 Dev Module**
4. Flash and monitor via Serial (115200 baud)

## Hardware Pin Mapping

| Peripheral | GPIO | Notes |
|-----------|-------|-------|
| DRV8833 IN1 (Left Fwd) | 32 | LEDC Ch 0 |
| DRV8833 IN2 (Left Bwd) | 33 | LEDC Ch 1 |
| DRV8833 IN3 (Right Fwd) | 16 | LEDC Ch 2 |
| DRV8833 IN4 (Right Bwd) | 17 | LEDC Ch 3 |
| HC-SR04 TRIG | 13 | *Remapped from GPIO 5* |
| HC-SR04 ECHO | 14 | *Remapped from GPIO 18* |
| Left IR Sensor | 19 | Active-LOW |
| Right IR Sensor | 15 | *Remapped from GPIO 4* |
| SG90 Servo | 22 | LEDC Ch 4, 50Hz |
| INMP441 WS | 25 | I2S Word Select |
| INMP441 SCK | 26 | I2S Serial Clock |
| INMP441 SD | 27 | I2S Serial Data |
| ST7735 CS | 5 | SPI Chip Select |
| ST7735 RST | 4 | Display Reset |
| ST7735 DC | 2 | Data/Command |
| ST7735 MOSI | 23 | SPI MOSI |
| ST7735 SCK | 18 | SPI Clock |

> **Note:** GPIO 5, 18, and 4 had conflicts between sensors and display. HC-SR04 and Right IR were remapped to GPIO 13, 14, 15 to resolve.

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | System health check |
| `/api/telemetry` | POST | Ingest sensor data |
| `/api/audio` | POST | Send audio for STT → LLM pipeline |
| `/api/text` | POST | Direct text input (bypasses Whisper) |
| `/api/command` | GET | Poll for latest robot commands |
| `/api/command/clear` | POST | Acknowledge command execution |
| `/api/telemetry/latest` | GET | Get latest sensor readings |
| `/api/status` | GET | Full system status |

## Emotion System (14 States)

| Emotion | Color | Eye Style | Animation |
|---------|-------|-----------|-----------|
| IDLE | Calm Blue | Neutral circles | Gentle blink |
| HAPPY | Warm Green | Wide circles | Slight bounce |
| SAD | Soft Purple | Droopy arcs | Slow sway |
| THINKING | Amber | One squinted | Animated dots |
| ALERT | Red | Wide diamonds | Flash border |
| LISTENING | Bright Cyan | Normal + pulse | Expanding rings |
| SLEEPING | Slate Gray | Curved closed | Floating Zs |
| EXCITED | Yellow | Star-like | Rapid bounce |
| CONFUSED | Deep Orange | Different sizes | Wavy mouth |
| ANGRY | Intense Red | V-browed | Screen shake |
| SHY | Pink | Looking away | Small smile |
| LOVE | Hot Pink | Heart shapes | Floating hearts |
| SURPRISED | Violet | Large hollow | Wide O mouth |
| BORED | Brown | Half-lidded | Yawn mouth |

## License

MIT
