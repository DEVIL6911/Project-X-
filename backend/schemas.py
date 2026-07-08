"""
JARVIS Buddy Robot — Pydantic Schema Definitions
=================================================
Strict data contracts between ESP32/Simulator and the backend,
and between the backend and the LLM engine. Every byte crossing
a boundary is validated here.
"""

from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Emotion enum — 14 states for the RGB display
# ---------------------------------------------------------------------------
EmotionType = Literal[
    "IDLE", "HAPPY", "SAD", "THINKING", "ALERT",
    "LISTENING", "SLEEPING", "EXCITED", "CONFUSED",
    "ANGRY", "SHY", "LOVE", "SURPRISED", "BORED",
]


# ---------------------------------------------------------------------------
# Inbound from ESP32 / Simulator
# ---------------------------------------------------------------------------
class SensorTelemetry(BaseModel):
    """Validates the telemetry POST payload from the edge device."""
    front_distance_cm: float = Field(ge=0, le=500, description="Ultrasonic distance in cm")
    left_ir_blocked: bool = Field(description="True if left IR detects edge/drop")
    right_ir_blocked: bool = Field(description="True if right IR detects edge/drop")
    servo_angle: int = Field(ge=0, le=180, default=90, description="Servo sweep angle")


# ---------------------------------------------------------------------------
# Robot action primitives
# ---------------------------------------------------------------------------
class RobotAction(BaseModel):
    """A single motor action the robot should execute."""
    type: Literal[
        "FORWARD", "BACKWARD", "TURN_LEFT", "TURN_RIGHT", "STOP", "SCAN"
    ] = Field(description="Movement primitive")
    duration_ms: int = Field(ge=0, le=5000, default=500, description="Action duration in ms")
    speed: int = Field(ge=0, le=255, default=150, description="Motor speed 0-255")


# ---------------------------------------------------------------------------
# LLM structured output — enforced on Gemini/Ollama response
# ---------------------------------------------------------------------------
class GeminiResponse(BaseModel):
    """
    Strict schema for the LLM cognitive output.
    The LLM MUST return JSON matching this schema exactly.
    """
    thought_process: str = Field(
        description="Internal reasoning about the current situation, sensor data, and user intent"
    )
    speech_reply: str = Field(
        description="What the robot says aloud to the user"
    )
    emotion: EmotionType = Field(
        default="IDLE",
        description="Emotional state to display on the RGB screen"
    )
    actions: list[RobotAction] = Field(
        default_factory=list,
        description="Sequence of movement actions to execute"
    )


# ---------------------------------------------------------------------------
# Outbound to ESP32 / Simulator — response to GET /api/command
# ---------------------------------------------------------------------------
class CommandResponse(BaseModel):
    """What the edge device receives when polling for commands."""
    emotion: EmotionType = Field(default="IDLE")
    actions: list[RobotAction] = Field(default_factory=list)
    speech_text: str = Field(default="")
