"""
JARVIS Buddy Robot — FastAPI Cloud Brain
========================================
High-performance async server that:
  1. Ingests telemetry & raw audio from ESP32/Simulator over HTTP
  2. Transcribes speech via faster-whisper (small model)
  3. Reasons via LLM (Gemini API or Ollama local) with strict JSON output
  4. Routes TTS audio to host PC default audio device (Avatar Speaker)
  5. Logs all interactions to SQLite for persistent memory

Half-duplex audio protocol:
  - Continuous listening until speech detected
  - Pause mic during LLM processing + TTS playback
  - Resume listening after TTS completes
"""

import io
import json
import logging
import os
import struct
import tempfile
import threading
import wave
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
import pyttsx3
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import InteractionLog, TelemetryLog, get_session, init_db
from schemas import CommandResponse, GeminiResponse, RobotAction, SensorTelemetry

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
load_dotenv()

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini").lower()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("jarvis")

# ---------------------------------------------------------------------------
# Global state — thread-safe via GIL for simple reads/writes
# ---------------------------------------------------------------------------
latest_telemetry: dict = {
    "front_distance_cm": 100.0,
    "left_ir_blocked": False,
    "right_ir_blocked": False,
    "servo_angle": 90,
}
latest_command: CommandResponse = CommandResponse(
    emotion="IDLE", actions=[], speech_text=""
)
is_processing: bool = False  # Half-duplex flag: True while LLM + TTS running

# ---------------------------------------------------------------------------
# Whisper STT engine (loaded once at startup)
# ---------------------------------------------------------------------------
whisper_model = None

# ---------------------------------------------------------------------------
# TTS engine — runs in a dedicated thread to avoid blocking async loop
# ---------------------------------------------------------------------------
tts_engine = None
tts_lock = threading.Lock()


def _init_tts():
    """Initialize pyttsx3 in the calling thread."""
    global tts_engine
    tts_engine = pyttsx3.init()
    # Slightly robotic but clear voice
    tts_engine.setProperty("rate", 160)
    tts_engine.setProperty("volume", 0.9)


def speak_text(text: str):
    """
    Synthesize and play TTS on the host PC's default audio output.
    This plays through whatever speaker (Bluetooth or otherwise) the PC uses.
    Runs synchronously in a background thread.
    """
    global is_processing
    with tts_lock:
        try:
            if tts_engine is None:
                _init_tts()
            tts_engine.say(text)
            tts_engine.runAndWait()
        except Exception as e:
            logger.error(f"TTS playback error: {e}")
        finally:
            is_processing = False  # Resume listening


# ---------------------------------------------------------------------------
# Gemini API client
# ---------------------------------------------------------------------------
gemini_genai = None


def _init_gemini():
    """Lazy-initialize the Gemini generative AI client."""
    global gemini_genai
    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        gemini_genai = genai
        logger.info(f"Gemini API initialized with model: {GEMINI_MODEL}")
    except Exception as e:
        logger.error(f"Failed to initialize Gemini: {e}")


# ---------------------------------------------------------------------------
# LLM system prompt — grounded in sensor data
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are JARVIS, an advanced AI desktop companion robot. You have a physical body with wheels, ultrasonic sensors, IR edge-detection sensors, and an RGB display that shows your emotions.

CRITICAL RULES:
1. You MUST evaluate the robot's sensor data before deciding any movement.
2. If front_distance_cm < 15, you MUST NOT issue FORWARD actions.
3. If left_ir_blocked is true, the left side has an edge/drop — do NOT turn left.
4. If right_ir_blocked is true, the right side has an edge/drop — do NOT turn right.
5. Your personality is witty, helpful, and slightly sarcastic — like the real JARVIS.
6. Keep speech_reply concise (under 50 words) for quick TTS playback.
7. Choose emotions that match the conversational context from this list:
   IDLE, HAPPY, SAD, THINKING, ALERT, LISTENING, SLEEPING, EXCITED, CONFUSED, ANGRY, SHY, LOVE, SURPRISED, BORED

You MUST respond with ONLY a valid JSON object matching this exact schema:
{
    "thought_process": "your internal reasoning about the situation",
    "speech_reply": "what you say aloud to the user",
    "emotion": "one of the 14 emotion states",
    "actions": [{"type": "FORWARD|BACKWARD|TURN_LEFT|TURN_RIGHT|STOP|SCAN", "duration_ms": 500, "speed": 150}]
}
"""


async def query_gemini(user_text: str, sensor_context: str, history: str) -> GeminiResponse:
    """Send a grounded prompt to Gemini and parse the structured JSON response."""
    if gemini_genai is None:
        _init_gemini()
    if gemini_genai is None:
        raise HTTPException(status_code=503, detail="Gemini API not available")

    model = gemini_genai.GenerativeModel(
        GEMINI_MODEL,
        system_instruction=SYSTEM_PROMPT,
    )

    prompt = (
        f"CURRENT SENSOR DATA:\n{sensor_context}\n\n"
        f"RECENT CONVERSATION HISTORY:\n{history}\n\n"
        f"USER SAYS: {user_text}\n\n"
        f"Respond with a JSON object matching the required schema."
    )

    try:
        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "temperature": 0.7,
                "max_output_tokens": 512,
            },
        )
        raw = response.text.strip()
        logger.info(f"Gemini raw response: {raw}")
        return GeminiResponse.model_validate_json(raw)

    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        return GeminiResponse(
            thought_process=f"Gemini error: {str(e)}",
            speech_reply="I had a brief malfunction. Could you repeat that?",
            emotion="CONFUSED",
            actions=[RobotAction(type="STOP", duration_ms=0)],
        )


async def query_ollama(user_text: str, sensor_context: str, history: str) -> GeminiResponse:
    """Send a grounded prompt to a local Ollama instance and parse the JSON response."""
    prompt = (
        f"{SYSTEM_PROMPT}\n\n"
        f"CURRENT SENSOR DATA:\n{sensor_context}\n\n"
        f"RECENT CONVERSATION HISTORY:\n{history}\n\n"
        f"USER SAYS: {user_text}\n\n"
        f"Respond with ONLY a valid JSON object matching the required schema. No markdown, no explanation."
    )

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "format": "json",
                    "options": {
                        "temperature": 0.7,
                        "num_predict": 512,
                    },
                },
            )
            response.raise_for_status()
            data = response.json()
            raw = data.get("response", "{}").strip()
            logger.info(f"Ollama raw response: {raw}")
            return GeminiResponse.model_validate_json(raw)

    except Exception as e:
        logger.error(f"Ollama error: {e}")
        return GeminiResponse(
            thought_process=f"Ollama error: {str(e)}",
            speech_reply="My local brain hiccupped. One moment.",
            emotion="CONFUSED",
            actions=[RobotAction(type="STOP", duration_ms=0)],
        )


async def query_llm(user_text: str, sensor_context: str, history: str) -> GeminiResponse:
    """Route to the configured LLM provider."""
    if LLM_PROVIDER == "ollama":
        return await query_ollama(user_text, sensor_context, history)
    else:
        return await query_gemini(user_text, sensor_context, history)


# ---------------------------------------------------------------------------
# Application lifecycle
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown hooks."""
    # Startup
    logger.info("🤖 JARVIS Brain booting up...")
    await init_db()
    logger.info("✅ Database initialized")

    # Load Whisper model in background thread so server boots instantly
    def _load_whisper_bg():
        global whisper_model
        try:
            logger.info(f"⏳ Downloading/Loading Whisper '{WHISPER_MODEL_SIZE}' model in background...")
            from faster_whisper import WhisperModel
            whisper_model = WhisperModel(
                WHISPER_MODEL_SIZE,
                device=WHISPER_DEVICE,
                compute_type=WHISPER_COMPUTE_TYPE,
            )
            logger.info(f"✅ Whisper '{WHISPER_MODEL_SIZE}' model loaded on {WHISPER_DEVICE}")
        except Exception as e:
            logger.warning(f"⚠️  Whisper failed to load: {e}. STT will be unavailable.")

    threading.Thread(target=_load_whisper_bg, daemon=True).start()

    # Initialize LLM
    if LLM_PROVIDER == "gemini":
        _init_gemini()
    else:
        logger.info(f"✅ Using Ollama at {OLLAMA_BASE_URL} with model '{OLLAMA_MODEL}'")

    # Initialize TTS in background thread
    threading.Thread(target=_init_tts, daemon=True).start()
    logger.info("✅ TTS engine initialized")

    logger.info(f"🧠 JARVIS Brain online — LLM: {LLM_PROVIDER}")
    yield

    # Shutdown
    logger.info("🤖 JARVIS Brain shutting down...")


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------
app = FastAPI(
    title="JARVIS Buddy Robot — Cloud Brain",
    description="Embodied AI backend with Whisper STT, LLM reasoning, and Avatar TTS",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow simulator and ESP32 from any origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health_check():
    """System health and status."""
    return {
        "status": "online",
        "llm_provider": LLM_PROVIDER,
        "whisper_loaded": whisper_model is not None,
        "is_processing": is_processing,
    }


@app.post("/api/telemetry")
async def ingest_telemetry(
    data: SensorTelemetry,
    session: AsyncSession = Depends(get_session),
):
    """
    Receive sensor telemetry from ESP32/Simulator.
    Updates in-memory state and logs to database.
    """
    global latest_telemetry

    # Update in-memory latest state
    latest_telemetry = data.model_dump()

    # Persist to database
    log = TelemetryLog(
        front_distance_cm=data.front_distance_cm,
        left_ir_blocked=data.left_ir_blocked,
        right_ir_blocked=data.right_ir_blocked,
        servo_angle=data.servo_angle,
    )
    session.add(log)
    await session.commit()

    return {"status": "ok", "is_processing": is_processing}


@app.post("/api/audio")
async def ingest_audio(
    audio: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    """
    Receive raw PCM audio from ESP32/Simulator.
    Transcribes via Whisper, triggers LLM reasoning, and initiates TTS.
    Half-duplex: sets is_processing=True during pipeline execution.
    """
    global latest_command, is_processing

    # Half-duplex gate: reject audio while processing a response
    if is_processing:
        return {"status": "busy", "message": "Currently processing a response"}

    if whisper_model is None:
        return {"status": "busy", "message": "Whisper STT model is still downloading/loading in background..."}

    try:
        # Read the uploaded audio bytes
        audio_bytes = await audio.read()
        if len(audio_bytes) < 1000:
            return {"status": "skip", "message": "Audio too short"}

        # Convert raw PCM to WAV for Whisper
        # Expected format: 16kHz, 16-bit, mono
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(16000)
            wf.writeframes(audio_bytes)
        wav_buffer.seek(0)

        # Write to temp file for faster-whisper
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(wav_buffer.read())
            tmp_path = tmp.name

        # Transcribe
        segments, info = whisper_model.transcribe(
            tmp_path,
            beam_size=5,
            language="en",
            vad_filter=True,          # Filter out non-speech
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200,
            ),
        )
        transcript = " ".join(seg.text for seg in segments).strip()

        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

        if not transcript:
            return {"status": "silence", "message": "No speech detected"}

        logger.info(f"🎤 Transcribed: '{transcript}'")

        # ---- Begin half-duplex processing ----
        is_processing = True

        # Build sensor context string for LLM grounding
        sensor_context = (
            f"Front Distance: {latest_telemetry['front_distance_cm']:.1f} cm\n"
            f"Left IR Blocked: {latest_telemetry['left_ir_blocked']}\n"
            f"Right IR Blocked: {latest_telemetry['right_ir_blocked']}\n"
            f"Servo Angle: {latest_telemetry['servo_angle']}°"
        )

        # Fetch recent interaction history for context
        result = await session.execute(
            select(InteractionLog)
            .order_by(desc(InteractionLog.timestamp))
            .limit(5)
        )
        recent = result.scalars().all()
        history_lines = []
        for log in reversed(recent):
            if log.user_speech:
                history_lines.append(f"Human: {log.user_speech}")
            if log.robot_speech:
                history_lines.append(f"JARVIS: {log.robot_speech}")
        history = "\n".join(history_lines) if history_lines else "(No prior conversation)"

        # Query LLM
        llm_response = await query_llm(transcript, sensor_context, history)

        # Update command buffer for ESP32/Simulator to poll
        latest_command = CommandResponse(
            emotion=llm_response.emotion,
            actions=llm_response.actions,
            speech_text=llm_response.speech_reply,
        )

        # Log interaction to database
        interaction = InteractionLog(
            user_speech=transcript,
            robot_thought=llm_response.thought_process,
            robot_speech=llm_response.speech_reply,
            emotion=llm_response.emotion,
            actions_json=json.dumps([a.model_dump() for a in llm_response.actions]),
        )
        session.add(interaction)
        await session.commit()

        logger.info(f"🧠 Thought: {llm_response.thought_process}")
        logger.info(f"💬 Says: {llm_response.speech_reply}")
        logger.info(f"😊 Emotion: {llm_response.emotion}")

        # Trigger TTS in background thread (is_processing cleared when TTS finishes)
        if llm_response.speech_reply:
            threading.Thread(
                target=speak_text,
                args=(llm_response.speech_reply,),
                daemon=True,
            ).start()
        else:
            is_processing = False

        return {
            "status": "ok",
            "transcript": transcript,
            "response": llm_response.model_dump(),
        }

    except Exception as e:
        is_processing = False
        logger.error(f"Audio processing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/command", response_model=CommandResponse)
async def get_command():
    """
    Polled by ESP32/Simulator to fetch the latest command.
    Returns the current emotion state and action queue.
    """
    return latest_command


@app.post("/api/command/clear")
async def clear_command():
    """
    Called by ESP32/Simulator after executing the command.
    Resets the command buffer to prevent re-execution.
    """
    global latest_command
    latest_command = CommandResponse(emotion=latest_command.emotion, actions=[], speech_text="")
    return {"status": "cleared"}


@app.get("/api/telemetry/latest")
async def get_latest_telemetry():
    """Return the most recent telemetry for debugging/simulator display."""
    return latest_telemetry


@app.get("/api/status")
async def get_status():
    """Full system status for the simulator dashboard."""
    return {
        "is_processing": is_processing,
        "current_emotion": latest_command.emotion,
        "llm_provider": LLM_PROVIDER,
        "telemetry": latest_telemetry,
        "pending_actions": len(latest_command.actions),
    }


# ---------------------------------------------------------------------------
# Direct text input (for simulator keyboard input, bypasses audio)
# ---------------------------------------------------------------------------
@app.post("/api/text")
async def ingest_text(
    payload: dict,
    session: AsyncSession = Depends(get_session),
):
    """
    Accept direct text input from the simulator's keyboard.
    Bypasses Whisper and goes straight to LLM reasoning.
    Useful for testing without a microphone.
    """
    global latest_command, is_processing

    text = payload.get("text", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    if is_processing:
        return {"status": "busy", "message": "Currently processing a response"}

    is_processing = True
    logger.info(f"⌨️  Text input: '{text}'")

    # Build sensor context
    sensor_context = (
        f"Front Distance: {latest_telemetry['front_distance_cm']:.1f} cm\n"
        f"Left IR Blocked: {latest_telemetry['left_ir_blocked']}\n"
        f"Right IR Blocked: {latest_telemetry['right_ir_blocked']}\n"
        f"Servo Angle: {latest_telemetry['servo_angle']}°"
    )

    # Recent history
    result = await session.execute(
        select(InteractionLog)
        .order_by(desc(InteractionLog.timestamp))
        .limit(5)
    )
    recent = result.scalars().all()
    history_lines = []
    for log in reversed(recent):
        if log.user_speech:
            history_lines.append(f"Human: {log.user_speech}")
        if log.robot_speech:
            history_lines.append(f"JARVIS: {log.robot_speech}")
    history = "\n".join(history_lines) if history_lines else "(No prior conversation)"

    # Query LLM
    llm_response = await query_llm(text, sensor_context, history)

    # Update command buffer
    latest_command = CommandResponse(
        emotion=llm_response.emotion,
        actions=llm_response.actions,
        speech_text=llm_response.speech_reply,
    )

    # Log interaction
    interaction = InteractionLog(
        user_speech=text,
        robot_thought=llm_response.thought_process,
        robot_speech=llm_response.speech_reply,
        emotion=llm_response.emotion,
        actions_json=json.dumps([a.model_dump() for a in llm_response.actions]),
    )
    session.add(interaction)
    await session.commit()

    # TTS
    if llm_response.speech_reply:
        threading.Thread(
            target=speak_text,
            args=(llm_response.speech_reply,),
            daemon=True,
        ).start()
    else:
        is_processing = False

    return {
        "status": "ok",
        "response": llm_response.model_dump(),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    host = os.getenv("SERVER_HOST", "127.0.0.1")
    port = int(os.getenv("SERVER_PORT", "3000"))
    uvicorn.run("app:app", host=host, port=port, reload=False)
