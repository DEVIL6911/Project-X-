"""
JARVIS Buddy Robot — Persistent Memory Layer
=============================================
SQLAlchemy async ORM with aiosqlite for time-series telemetry
and interaction logging. Gives the robot long-term memory.
"""

import os
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


# ---------------------------------------------------------------------------
# Database engine — SQLite stored alongside the backend for simplicity
# ---------------------------------------------------------------------------
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./jarvis_memory.db")

engine = create_async_engine(
    DATABASE_URL,
    echo=False,  # Set True for SQL debugging
    connect_args={"check_same_thread": False},
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# ---------------------------------------------------------------------------
# Base model
# ---------------------------------------------------------------------------
class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# ORM Models
# ---------------------------------------------------------------------------
class InteractionLog(Base):
    """
    Records every human-robot conversation turn.
    Used to feed context back into the LLM for continuity.
    """
    __tablename__ = "interaction_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    user_speech = Column(Text, nullable=True)            # Whisper transcription
    robot_thought = Column(Text, nullable=True)           # LLM thought_process
    robot_speech = Column(Text, nullable=True)            # LLM speech_reply
    emotion = Column(String(20), default="IDLE")          # Emotion state tag
    actions_json = Column(Text, nullable=True)            # Serialized action array


class TelemetryLog(Base):
    """
    Time-series log of the robot's physical sensor state.
    Enables post-hoc analysis of navigation behaviour.
    """
    __tablename__ = "telemetry_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    front_distance_cm = Column(Float, nullable=True)      # Ultrasonic reading
    left_ir_blocked = Column(Boolean, default=False)       # Left IR edge sensor
    right_ir_blocked = Column(Boolean, default=False)      # Right IR edge sensor
    servo_angle = Column(Integer, default=90)              # Current sweep position
    battery_voltage = Column(Float, nullable=True)         # Optional ADC reading


# ---------------------------------------------------------------------------
# Lifecycle helpers
# ---------------------------------------------------------------------------
async def init_db():
    """Create all tables on startup. Safe to call multiple times."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    """Dependency-injection helper for FastAPI endpoints."""
    async with async_session() as session:
        yield session
