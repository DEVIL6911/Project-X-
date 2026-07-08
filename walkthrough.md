# JARVIS Buddy Robot — Build Walkthrough

## What Was Built

A complete **three-tier Embodied AI system** with 18 production files totaling ~160KB of code:

### Backend (5 files)
| File | Size | Purpose |
|------|------|---------|
| [app.py](file:///d:/Project R/JarvisRobot/backend/app.py) | 21KB | FastAPI server with dual LLM (Gemini/Ollama), Whisper STT, Avatar TTS, half-duplex audio |
| [database.py](file:///d:/Project R/JarvisRobot/backend/database.py) | 3.5KB | SQLAlchemy async ORM with InteractionLog + TelemetryLog models |
| [schemas.py](file:///d:/Project R/JarvisRobot/backend/schemas.py) | 3.3KB | Pydantic validation for 14 emotions, sensor data, robot actions, LLM output |
| [requirements.txt](file:///d:/Project R/JarvisRobot/backend/requirements.txt) | 315B | Python dependencies |
| [.env](file:///d:/Project R/JarvisRobot/backend/.env) | 547B | Configurable LLM provider, Whisper model, server settings |

### Firmware (10 files)
| File | Size | Purpose |
|------|------|---------|
| [config.h](file:///d:/Project R/JarvisRobot/firmware/config.h) | 6.4KB | All pin definitions (conflict-resolved), RTOS tuning, emotion enum |
| [motor_driver.h](file:///d:/Project R/JarvisRobot/firmware/motor_driver.h) / [.cpp](file:///d:/Project R/JarvisRobot/firmware/motor_driver.cpp) | 5.3KB | DRV8833 LEDC PWM, emergency stop, JSON action parser |
| [sensors.h](file:///d:/Project R/JarvisRobot/firmware/sensors.h) / [.cpp](file:///d:/Project R/JarvisRobot/firmware/sensors.cpp) | 7.4KB | HC-SR04 median filter, IR edge detect, SG90 servo sweep, mutex |
| [mic_i2s.h](file:///d:/Project R/JarvisRobot/firmware/mic_i2s.h) / [.cpp](file:///d:/Project R/JarvisRobot/firmware/mic_i2s.cpp) | 9.4KB | I2S DMA double-buffer, WAV packaging, multipart HTTP POST |
| [display.h](file:///d:/Project R/JarvisRobot/firmware/display.h) / [.cpp](file:///d:/Project R/JarvisRobot/firmware/display.cpp) | 18KB | ST7735 14-emotion face renderer with unique eye/mouth/animation per state |
| [main.ino](file:///d:/Project R/JarvisRobot/firmware/main.ino) | 12.7KB | 4-task FreeRTOS orchestration pinned to dual cores |

### Simulator (3 files)
| File | Size | Purpose |
|------|------|---------|
| [index.html](file:///d:/Project R/JarvisRobot/simulator/index.html) | 8.6KB | Three-panel UI: room view, emotion display, interaction console |
| [style.css](file:///d:/Project R/JarvisRobot/simulator/style.css) | 17KB | Premium dark theme with glassmorphism and micro-animations |
| [app.js](file:///d:/Project R/JarvisRobot/simulator/app.js) | 48KB | Full simulation engine (raycasting, physics, emotions, network, mic) |

---

## Key Design Decisions

1. **Dual LLM Support**: Backend accepts both Gemini API and local Ollama models via `.env` toggle — no code changes needed to switch
2. **Half-Duplex Audio**: Continuous listening pauses during LLM processing and TTS playback, then auto-resumes
3. **Simulator = Drop-in ESP32 Replacement**: Uses the exact same HTTP API endpoints, so the backend can't tell if it's talking to real hardware or the simulator
4. **Safety-First RTOS**: Navigation task has highest priority (P4) and emergency stops override everything — even mid-action sequences
5. **14 Emotion States**: Each with unique RGB palette, eye geometry, mouth expression, and frame animation

---

## How to Test

### Quick Start (Simulator Only)
1. `cd backend && pip install -r requirements.txt`
2. Edit `.env` with your LLM credentials
3. `python app.py`
4. Open `simulator/index.html` in browser
5. Click **Connect** → type a message or use the microphone

### Controls
- **WASD** or **D-pad**: Manual motor control
- **Spacebar**: Emergency stop
- **Click canvas**: Place obstacles
- **Drag obstacles**: Reposition them
- **Double-click obstacle**: Delete it
- **Emotion buttons**: Test display states
- **Mic button**: Record and send audio to Whisper
