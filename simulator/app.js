/**
 * JARVIS Buddy Robot — Simulation Engine
 * ========================================
 * Complete browser-based simulation replacing ESP32 hardware.
 *
 * Modules:
 *   1. RoomSimulator   — 2D top-down room with draggable obstacles, raycasted sensors
 *   2. EmotionRenderer — Canvas-based face renderer matching firmware's 14 emotions
 *   3. NetworkBridge   — HTTP client mimicking ESP32's API calls to the backend
 *   4. AudioCapture    — Browser MediaRecorder for real microphone input
 *   5. MotorPhysics    — Simulated differential drive kinematics
 */

"use strict";

// =========================================================================
// Configuration
// =========================================================================
const CONFIG = {
    // Room dimensions (virtual centimeters)
    ROOM_WIDTH_CM: 200,
    ROOM_HEIGHT_CM: 160,

    // Robot dimensions
    ROBOT_RADIUS: 8,        // cm
    ROBOT_COLOR: "#29B6F6",
    ROBOT_TRAIL_COLOR: "rgba(41, 182, 246, 0.1)",

    // Sensor simulation
    ULTRASONIC_MAX_CM: 200,
    ULTRASONIC_FOV_DEG: 15, // Beam width
    IR_EDGE_MARGIN_CM: 5,   // Distance from wall edge where IR triggers

    // Physics
    MAX_SPEED_CM_S: 30,     // Max robot speed in cm/s
    TURN_RATE_DEG_S: 120,   // Degrees per second for turns

    // Network
    TELEMETRY_INTERVAL_MS: 500,
    COMMAND_POLL_MS: 500,

    // Emotion colors (matching firmware themes)
    EMOTION_THEMES: {
        IDLE:      { bg: "#141E30", eye: "#4FC3F7", mouth: "#4FC3F7", accent: "#296280" },
        HAPPY:     { bg: "#142819", eye: "#66BB6A", mouth: "#66BB6A", accent: "#388E3C" },
        SAD:       { bg: "#1C1430", eye: "#7E57C2", mouth: "#7E57C2", accent: "#512DA8" },
        THINKING:  { bg: "#281E0F", eye: "#FFA726", mouth: "#FFA726", accent: "#D26900" },
        ALERT:     { bg: "#320F0F", eye: "#EF5350", mouth: "#EF5350", accent: "#C62828" },
        LISTENING: { bg: "#0F2332", eye: "#29B6F6", mouth: "#29B6F6", accent: "#0277BD" },
        SLEEPING:  { bg: "#191E23", eye: "#78909C", mouth: "#78909C", accent: "#455A64" },
        EXCITED:   { bg: "#32300A", eye: "#FFEE58", mouth: "#FFEE58", accent: "#F9A825" },
        CONFUSED:  { bg: "#2D190F", eye: "#FF7043", mouth: "#FF7043", accent: "#D84315" },
        ANGRY:     { bg: "#370A0A", eye: "#F44336", mouth: "#F44336", accent: "#B71C1C" },
        SHY:       { bg: "#301923", eye: "#F48FB1", mouth: "#F48FB1", accent: "#C2185B" },
        LOVE:      { bg: "#320F1E", eye: "#EC407A", mouth: "#EC407A", accent: "#AD1457" },
        SURPRISED: { bg: "#231430", eye: "#AB47BC", mouth: "#AB47BC", accent: "#7B1FA2" },
        BORED:     { bg: "#231C16", eye: "#8D6E63", mouth: "#8D6E63", accent: "#5D4037" },
    }
};


// =========================================================================
// State
// =========================================================================
const state = {
    connected: false,
    backendUrl: "http://127.0.0.1:3000",

    // Robot state
    robot: {
        x: 100,          // cm from left
        y: 80,           // cm from top
        angle: 0,        // degrees, 0 = right, 90 = down
        speed: 0,
        trail: [],       // Array of {x, y} for trail rendering
    },

    // Sensor readings
    sensors: {
        frontDistanceCm: 200,
        leftIrBlocked: false,
        rightIrBlocked: false,
        servoAngle: 90,
        emergencyStop: false,
    },

    // Obstacles: array of {x, y, w, h} in cm
    obstacles: [
        { x: 60, y: 30, w: 20, h: 20 },
        { x: 140, y: 100, w: 15, h: 30 },
    ],

    // Emotion
    emotion: "IDLE",
    frameCount: 0,

    // Action queue
    actionQueue: [],
    currentAction: null,
    actionStartTime: 0,

    // Audio
    isRecording: false,
    mediaRecorder: null,
    audioChunks: [],

    // Network
    telemetryTimer: null,
    commandTimer: null,
    telemCount: 0,

    // Drag state for obstacles
    dragging: null,
    dragOffset: { x: 0, y: 0 },

    // Message display
    displayMessage: "",
};


// =========================================================================
// DOM References
// =========================================================================
const DOM = {};
function cacheDom() {
    DOM.roomCanvas = document.getElementById("room-canvas");
    DOM.roomCtx = DOM.roomCanvas.getContext("2d");
    DOM.emotionCanvas = document.getElementById("emotion-canvas");
    DOM.emotionCtx = DOM.emotionCanvas.getContext("2d");
    DOM.backendUrl = document.getElementById("backend-url");
    DOM.btnConnect = document.getElementById("btn-connect");
    DOM.connIndicator = document.getElementById("connection-indicator");
    DOM.connLabel = DOM.connIndicator.querySelector(".label");
    DOM.emotionLabel = document.getElementById("emotion-label");
    DOM.chatLog = document.getElementById("chat-log");
    DOM.textInput = document.getElementById("text-input");
    DOM.btnSend = document.getElementById("btn-send");
    DOM.btnMic = document.getElementById("btn-mic");
    DOM.micStatus = document.getElementById("mic-status");

    // Readouts
    DOM.readoutFront = document.getElementById("readout-front");
    DOM.readoutLeftIr = document.getElementById("readout-left-ir");
    DOM.readoutRightIr = document.getElementById("readout-right-ir");
    DOM.readoutServo = document.getElementById("readout-servo");
    DOM.readoutSpeed = document.getElementById("readout-speed");

    // Status bar
    DOM.statusLlm = document.getElementById("status-llm");
    DOM.statusWhisper = document.getElementById("status-whisper");
    DOM.statusProcessing = document.getElementById("status-processing");
    DOM.statusActions = document.getElementById("status-actions");
    DOM.statusTelemRate = document.getElementById("status-telem-rate");
}


// =========================================================================
// Utility Helpers
// =========================================================================
function degToRad(deg) { return deg * Math.PI / 180; }
function radToDeg(rad) { return rad * 180 / Math.PI; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function now() {
    const d = new Date();
    return d.toTimeString().slice(0, 5);
}

function addChatEntry(type, message) {
    const entry = document.createElement("div");
    entry.className = `chat-entry ${type}`;
    entry.innerHTML = `<span class="chat-time">${now()}</span><span class="chat-msg">${message}</span>`;
    DOM.chatLog.appendChild(entry);
    DOM.chatLog.scrollTop = DOM.chatLog.scrollHeight;
}


// =========================================================================
// Room Simulator — 2D top-down view with obstacle raycasting
// =========================================================================
const RoomSim = {
    // Convert cm to canvas pixels
    cmToPixel(cm, axis) {
        const canvas = DOM.roomCanvas;
        const rect = canvas.getBoundingClientRect();
        // We want to map ROOM_WIDTH_CM to canvas width and ROOM_HEIGHT_CM to canvas height
        // Use actual canvas pixel dimensions
        if (axis === "x") return (cm / CONFIG.ROOM_WIDTH_CM) * canvas.width;
        return (cm / CONFIG.ROOM_HEIGHT_CM) * canvas.height;
    },

    pixelToCm(px, axis) {
        const canvas = DOM.roomCanvas;
        if (axis === "x") return (px / canvas.width) * CONFIG.ROOM_WIDTH_CM;
        return (px / canvas.height) * CONFIG.ROOM_HEIGHT_CM;
    },

    // Raycast from robot in a given direction, return distance to nearest obstacle or wall
    raycast(originX, originY, angleDeg) {
        const step = 1; // 1 cm steps
        const maxDist = CONFIG.ULTRASONIC_MAX_CM;
        const rad = degToRad(angleDeg);
        const dx = Math.cos(rad) * step;
        const dy = Math.sin(rad) * step;

        let x = originX, y = originY;
        for (let d = 0; d < maxDist; d += step) {
            x += dx;
            y += dy;

            // Check walls
            if (x < 0 || x > CONFIG.ROOM_WIDTH_CM || y < 0 || y > CONFIG.ROOM_HEIGHT_CM) {
                return d;
            }

            // Check obstacles
            for (const obs of state.obstacles) {
                if (x >= obs.x && x <= obs.x + obs.w && y >= obs.y && y <= obs.y + obs.h) {
                    return d;
                }
            }
        }
        return maxDist;
    },

    // Update simulated sensor readings
    updateSensors() {
        const r = state.robot;

        // Front ultrasonic — raycast in facing direction
        state.sensors.frontDistanceCm = this.raycast(r.x, r.y, r.angle);

        // Left IR — check if robot is near left edge of room/table
        const leftAngle = r.angle - 90;
        const leftDist = this.raycast(r.x, r.y, leftAngle);
        state.sensors.leftIrBlocked = leftDist < CONFIG.IR_EDGE_MARGIN_CM ||
            r.x < CONFIG.IR_EDGE_MARGIN_CM || r.y < CONFIG.IR_EDGE_MARGIN_CM;

        // Right IR — check if robot is near right edge
        const rightAngle = r.angle + 90;
        const rightDist = this.raycast(r.x, r.y, rightAngle);
        state.sensors.rightIrBlocked = rightDist < CONFIG.IR_EDGE_MARGIN_CM ||
            r.x > CONFIG.ROOM_WIDTH_CM - CONFIG.IR_EDGE_MARGIN_CM ||
            r.y > CONFIG.ROOM_HEIGHT_CM - CONFIG.IR_EDGE_MARGIN_CM;

        // Emergency stop check
        if (state.sensors.frontDistanceCm < 15 ||
            state.sensors.leftIrBlocked ||
            state.sensors.rightIrBlocked) {
            if (!state.sensors.emergencyStop) {
                state.sensors.emergencyStop = true;
                state.robot.speed = 0;
                state.currentAction = null;
                state.actionQueue = [];
                addChatEntry("error", "⚠️ Emergency stop — obstacle or edge detected!");
            }
        } else {
            state.sensors.emergencyStop = false;
        }

        // Update readout DOM
        DOM.readoutFront.textContent = state.sensors.frontDistanceCm.toFixed(1);
        DOM.readoutFront.className = `readout-value ${state.sensors.frontDistanceCm < 15 ? "danger" : ""}`;

        DOM.readoutLeftIr.textContent = state.sensors.leftIrBlocked ? "BLOCKED" : "CLEAR";
        DOM.readoutLeftIr.className = `readout-value ${state.sensors.leftIrBlocked ? "danger" : "safe"}`;

        DOM.readoutRightIr.textContent = state.sensors.rightIrBlocked ? "BLOCKED" : "CLEAR";
        DOM.readoutRightIr.className = `readout-value ${state.sensors.rightIrBlocked ? "danger" : "safe"}`;

        DOM.readoutServo.textContent = state.sensors.servoAngle + "°";
        DOM.readoutSpeed.textContent = Math.abs(state.robot.speed).toFixed(0);
    },

    // Render the room
    render() {
        const ctx = DOM.roomCtx;
        const W = DOM.roomCanvas.width;
        const H = DOM.roomCanvas.height;

        ctx.clearRect(0, 0, W, H);

        // Background — dark grid
        ctx.fillStyle = "hsl(225, 25%, 8%)";
        ctx.fillRect(0, 0, W, H);

        // Grid lines
        ctx.strokeStyle = "hsla(215, 15%, 25%, 0.3)";
        ctx.lineWidth = 0.5;
        const gridSpacingCm = 20;
        for (let x = 0; x <= CONFIG.ROOM_WIDTH_CM; x += gridSpacingCm) {
            const px = this.cmToPixel(x, "x");
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, H);
            ctx.stroke();
        }
        for (let y = 0; y <= CONFIG.ROOM_HEIGHT_CM; y += gridSpacingCm) {
            const py = this.cmToPixel(y, "y");
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(W, py);
            ctx.stroke();
        }

        // Room boundary (the "table edge")
        ctx.strokeStyle = "hsla(0, 72%, 55%, 0.5)";
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(2, 2, W - 4, H - 4);
        ctx.setLineDash([]);

        // Robot trail
        if (state.robot.trail.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = CONFIG.ROBOT_TRAIL_COLOR;
            ctx.lineWidth = this.cmToPixel(CONFIG.ROBOT_RADIUS * 0.6, "x");
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            const t0 = state.robot.trail[0];
            ctx.moveTo(this.cmToPixel(t0.x, "x"), this.cmToPixel(t0.y, "y"));
            for (let i = 1; i < state.robot.trail.length; i++) {
                const t = state.robot.trail[i];
                ctx.lineTo(this.cmToPixel(t.x, "x"), this.cmToPixel(t.y, "y"));
            }
            ctx.stroke();
        }

        // Obstacles
        for (const obs of state.obstacles) {
            const ox = this.cmToPixel(obs.x, "x");
            const oy = this.cmToPixel(obs.y, "y");
            const ow = this.cmToPixel(obs.w, "x");
            const oh = this.cmToPixel(obs.h, "y");

            // Shadow
            ctx.fillStyle = "hsla(0, 0%, 0%, 0.3)";
            ctx.fillRect(ox + 3, oy + 3, ow, oh);

            // Obstacle body
            const gradient = ctx.createLinearGradient(ox, oy, ox + ow, oy + oh);
            gradient.addColorStop(0, "hsl(225, 15%, 25%)");
            gradient.addColorStop(1, "hsl(225, 15%, 18%)");
            ctx.fillStyle = gradient;
            ctx.fillRect(ox, oy, ow, oh);
            ctx.strokeStyle = "hsla(215, 15%, 40%, 0.5)";
            ctx.lineWidth = 1;
            ctx.strokeRect(ox, oy, ow, oh);
        }

        // Ultrasonic beam visualization
        const r = state.robot;
        const rPx = this.cmToPixel(r.x, "x");
        const rPy = this.cmToPixel(r.y, "y");
        const beamDist = state.sensors.frontDistanceCm;
        const beamAngle = degToRad(r.angle);
        const beamEndX = rPx + Math.cos(beamAngle) * this.cmToPixel(beamDist, "x");
        const beamEndY = rPy + Math.sin(beamAngle) * this.cmToPixel(beamDist, "y");

        // Beam cone
        const fovRad = degToRad(CONFIG.ULTRASONIC_FOV_DEG);
        ctx.beginPath();
        ctx.moveTo(rPx, rPy);
        ctx.lineTo(
            rPx + Math.cos(beamAngle - fovRad) * this.cmToPixel(beamDist, "x"),
            rPy + Math.sin(beamAngle - fovRad) * this.cmToPixel(beamDist, "y")
        );
        ctx.lineTo(beamEndX, beamEndY);
        ctx.lineTo(
            rPx + Math.cos(beamAngle + fovRad) * this.cmToPixel(beamDist, "x"),
            rPy + Math.sin(beamAngle + fovRad) * this.cmToPixel(beamDist, "y")
        );
        ctx.closePath();
        const beamColor = beamDist < 15 ? "hsla(0, 72%, 55%, 0.08)" : "hsla(195, 100%, 55%, 0.06)";
        ctx.fillStyle = beamColor;
        ctx.fill();

        // Beam center line
        ctx.beginPath();
        ctx.moveTo(rPx, rPy);
        ctx.lineTo(beamEndX, beamEndY);
        ctx.strokeStyle = beamDist < 15 ? "hsla(0, 72%, 55%, 0.4)" : "hsla(195, 100%, 55%, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Robot body
        const bodyR = this.cmToPixel(CONFIG.ROBOT_RADIUS, "x");

        // Glow
        const glow = ctx.createRadialGradient(rPx, rPy, 0, rPx, rPy, bodyR * 2.5);
        glow.addColorStop(0, state.sensors.emergencyStop ? "hsla(0, 72%, 55%, 0.15)" : "hsla(195, 100%, 55%, 0.12)");
        glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow;
        ctx.fillRect(rPx - bodyR * 3, rPy - bodyR * 3, bodyR * 6, bodyR * 6);

        // Body circle
        ctx.beginPath();
        ctx.arc(rPx, rPy, bodyR, 0, Math.PI * 2);
        ctx.fillStyle = state.sensors.emergencyStop ? "#EF5350" : CONFIG.ROBOT_COLOR;
        ctx.fill();
        ctx.strokeStyle = "hsla(0, 0%, 100%, 0.3)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Direction indicator (nose)
        const noseX = rPx + Math.cos(beamAngle) * bodyR * 0.8;
        const noseY = rPy + Math.sin(beamAngle) * bodyR * 0.8;
        ctx.beginPath();
        ctx.arc(noseX, noseY, bodyR * 0.25, 0, Math.PI * 2);
        ctx.fillStyle = "white";
        ctx.fill();

        // Distance text at beam endpoint
        if (beamDist < CONFIG.ULTRASONIC_MAX_CM) {
            ctx.fillStyle = beamDist < 15 ? "#EF5350" : "#29B6F6";
            ctx.font = "bold 11px 'Inter', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(`${beamDist.toFixed(0)}cm`, beamEndX, beamEndY - 8);
        }
    }
};


// =========================================================================
// Emotion Renderer — Canvas face matching firmware display.cpp
// =========================================================================
const EmotionRenderer = {
    render() {
        const ctx = DOM.emotionCtx;
        const W = 256;
        const H = 320;
        const theme = CONFIG.EMOTION_THEMES[state.emotion] || CONFIG.EMOTION_THEMES.IDLE;
        const f = state.frameCount;

        // Background
        ctx.fillStyle = theme.bg;
        ctx.fillRect(0, 0, W, H);

        // Face geometry
        const cx = W / 2;
        const eyeY = H * 0.34;
        const eyeLX = cx - 35;
        const eyeRX = cx + 35;
        const mouthY = H * 0.56;

        // Animation offsets
        let bounceY = 0, shakeX = 0;
        if (state.emotion === "EXCITED") bounceY = Math.sin(f * 0.8) * 4;
        if (state.emotion === "ANGRY") shakeX = (f % 4 < 2) ? 3 : -3;
        if (state.emotion === "HAPPY") bounceY = Math.sin(f * 0.3) * 2;

        ctx.save();
        ctx.translate(shakeX, bounceY);

        // Blink: every ~30 frames, blink for 2 frames
        const isBlinking = (f % 30 < 2) && state.emotion !== "SLEEPING" && state.emotion !== "ANGRY";

        // ---- Eyes ----
        ctx.fillStyle = theme.eye;
        ctx.strokeStyle = theme.eye;

        if (isBlinking) {
            // Blink — horizontal lines
            ctx.fillRect(eyeLX - 12, eyeY - 2, 24, 4);
            ctx.fillRect(eyeRX - 12, eyeY - 2, 24, 4);
        } else {
            switch (state.emotion) {
                case "IDLE":
                case "LISTENING":
                    this.drawCircleEyes(ctx, eyeLX, eyeRX, eyeY, 10);
                    break;
                case "HAPPY":
                case "EXCITED":
                    this.drawCircleEyes(ctx, eyeLX, eyeRX, eyeY, 12);
                    break;
                case "SAD":
                case "SLEEPING":
                    this.drawSleepyEyes(ctx, eyeLX, eyeRX, eyeY);
                    break;
                case "THINKING":
                    ctx.beginPath(); ctx.arc(eyeLX, eyeY, 10, 0, Math.PI * 2); ctx.fill();
                    ctx.fillRect(eyeRX - 12, eyeY - 2, 24, 4); // Squinted right
                    break;
                case "ALERT":
                    this.drawDiamondEyes(ctx, eyeLX, eyeRX, eyeY);
                    break;
                case "CONFUSED":
                    ctx.beginPath(); ctx.arc(eyeLX, eyeY, 12, 0, Math.PI * 2); ctx.fill();
                    ctx.beginPath(); ctx.arc(eyeRX, eyeY, 7, 0, Math.PI * 2); ctx.fill();
                    break;
                case "ANGRY":
                    this.drawAngryEyes(ctx, eyeLX, eyeRX, eyeY, theme);
                    break;
                case "SHY":
                    ctx.beginPath(); ctx.arc(eyeLX + 4, eyeY + 3, 7, 0, Math.PI * 2); ctx.fill();
                    ctx.beginPath(); ctx.arc(eyeRX + 4, eyeY + 3, 7, 0, Math.PI * 2); ctx.fill();
                    break;
                case "LOVE":
                    this.drawHeartEyes(ctx, eyeLX, eyeRX, eyeY);
                    break;
                case "SURPRISED":
                    this.drawBigEyes(ctx, eyeLX, eyeRX, eyeY, theme);
                    break;
                case "BORED":
                    this.drawHalfLidEyes(ctx, eyeLX, eyeRX, eyeY, theme);
                    break;
                default:
                    this.drawCircleEyes(ctx, eyeLX, eyeRX, eyeY, 10);
            }
        }

        // ---- Mouth ----
        ctx.fillStyle = theme.mouth;
        ctx.strokeStyle = theme.mouth;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";

        switch (state.emotion) {
            case "IDLE":
            case "LISTENING":
            case "SLEEPING":
                ctx.fillRect(cx - 18, mouthY, 36, 3);
                break;
            case "HAPPY":
            case "SHY":
            case "LOVE":
                this.drawSmile(ctx, cx, mouthY);
                break;
            case "SAD":
                this.drawFrown(ctx, cx, mouthY);
                break;
            case "THINKING":
            case "CONFUSED":
                this.drawSquiggle(ctx, cx, mouthY, f);
                break;
            case "ALERT":
            case "SURPRISED":
                this.drawOpenMouth(ctx, cx, mouthY, theme);
                break;
            case "EXCITED":
                this.drawSmile(ctx, cx, mouthY);
                ctx.fillRect(cx - 15, mouthY - 2, 30, 3);
                break;
            case "ANGRY":
                this.drawJaggedMouth(ctx, cx, mouthY);
                break;
            case "BORED":
                this.drawOpenMouth(ctx, cx, mouthY + 5, theme);
                break;
            default:
                ctx.fillRect(cx - 18, mouthY, 36, 3);
        }

        // ---- Special Animations ----
        switch (state.emotion) {
            case "THINKING":
                this.drawThinkingDots(ctx, cx, mouthY + 30, f, theme);
                break;
            case "LISTENING":
                this.drawListeningRings(ctx, cx, mouthY + 20, f, theme);
                break;
            case "SLEEPING":
                this.drawFloatingZ(ctx, cx, eyeY, f, theme);
                break;
            case "LOVE":
                this.drawFloatingHearts(ctx, cx, eyeY, f, theme);
                break;
            case "ALERT":
                if (f % 6 < 3) {
                    ctx.strokeStyle = theme.eye;
                    ctx.lineWidth = 3;
                    ctx.strokeRect(4, 4, W - 8, H - 8);
                }
                break;
        }

        ctx.restore();

        // Message text at bottom
        if (state.displayMessage) {
            ctx.fillStyle = "rgba(0,0,0,0.7)";
            ctx.fillRect(0, H - 40, W, 40);
            ctx.fillStyle = "#CCC";
            ctx.font = "13px 'Inter', sans-serif";
            ctx.textAlign = "center";
            // Truncate long messages
            let msg = state.displayMessage;
            if (msg.length > 30) msg = msg.slice(0, 28) + "...";
            ctx.fillText(msg, cx, H - 16);
        }

        state.frameCount++;
    },

    // Eye helpers
    drawCircleEyes(ctx, lx, rx, y, r) {
        ctx.beginPath(); ctx.arc(lx, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(rx, y, r, 0, Math.PI * 2); ctx.fill();
    },
    drawSleepyEyes(ctx, lx, rx, y) {
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(lx, y + 2, 10, 0.2, Math.PI - 0.2); ctx.stroke();
        ctx.beginPath(); ctx.arc(rx, y + 2, 10, 0.2, Math.PI - 0.2); ctx.stroke();
    },
    drawDiamondEyes(ctx, lx, rx, y) {
        for (const ex of [lx, rx]) {
            ctx.beginPath();
            ctx.moveTo(ex, y - 12); ctx.lineTo(ex + 9, y);
            ctx.lineTo(ex, y + 12); ctx.lineTo(ex - 9, y);
            ctx.closePath(); ctx.fill();
        }
    },
    drawAngryEyes(ctx, lx, rx, y, theme) {
        ctx.beginPath(); ctx.arc(lx, y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(rx, y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(lx - 14, y - 16); ctx.lineTo(lx + 8, y - 8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rx + 14, y - 16); ctx.lineTo(rx - 8, y - 8); ctx.stroke();
    },
    drawHeartEyes(ctx, lx, rx, y) {
        for (const ex of [lx, rx]) {
            ctx.beginPath(); ctx.arc(ex - 6, y - 5, 7, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(ex + 6, y - 5, 7, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(ex - 13, y - 2); ctx.lineTo(ex, y + 12); ctx.lineTo(ex + 13, y - 2);
            ctx.fill();
        }
    },
    drawBigEyes(ctx, lx, rx, y, theme) {
        ctx.beginPath(); ctx.arc(lx, y, 15, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(rx, y, 15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = theme.bg;
        ctx.beginPath(); ctx.arc(lx, y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(rx, y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = theme.eye;
    },
    drawHalfLidEyes(ctx, lx, rx, y, theme) {
        ctx.beginPath(); ctx.arc(lx, y, 10, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(rx, y, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = theme.bg;
        ctx.fillRect(lx - 12, y - 12, 24, 12);
        ctx.fillRect(rx - 12, y - 12, 24, 12);
        ctx.fillStyle = theme.eye;
    },

    // Mouth helpers
    drawSmile(ctx, cx, y) {
        ctx.beginPath();
        ctx.arc(cx, y - 5, 20, 0.3, Math.PI - 0.3);
        ctx.stroke();
    },
    drawFrown(ctx, cx, y) {
        ctx.beginPath();
        ctx.arc(cx, y + 15, 20, Math.PI + 0.3, -0.3);
        ctx.stroke();
    },
    drawOpenMouth(ctx, cx, y, theme) {
        ctx.beginPath(); ctx.arc(cx, y + 5, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = theme.bg;
        ctx.beginPath(); ctx.arc(cx, y + 5, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = theme.mouth;
    },
    drawJaggedMouth(ctx, cx, y) {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 22, y);
        for (let i = 0; i < 5; i++) {
            ctx.lineTo(cx - 22 + i * 11 + 5, y + (i % 2 === 0 ? 8 : -4));
        }
        ctx.stroke();
    },
    drawSquiggle(ctx, cx, y, f) {
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = -20; i <= 20; i++) {
            const sy = y + Math.sin((i + f) * 0.4) * 4;
            if (i === -20) ctx.moveTo(cx + i, sy);
            else ctx.lineTo(cx + i, sy);
        }
        ctx.stroke();
    },

    // Animation helpers
    drawThinkingDots(ctx, cx, y, f, theme) {
        const numDots = (Math.floor(f / 5) % 4);
        ctx.fillStyle = theme.accent;
        for (let i = 0; i < numDots && i < 3; i++) {
            ctx.beginPath(); ctx.arc(cx - 15 + i * 15, y, 5, 0, Math.PI * 2); ctx.fill();
        }
    },
    drawListeningRings(ctx, cx, y, f, theme) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        const r = (f * 3) % 40 + 8;
        ctx.globalAlpha = 1 - r / 48;
        ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.stroke();
        if (r > 15) {
            ctx.beginPath(); ctx.arc(cx, y, r - 15, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
    },
    drawFloatingZ(ctx, cx, y, f, theme) {
        ctx.fillStyle = theme.accent;
        ctx.font = "bold 18px 'Inter', sans-serif";
        const yOff = -(f * 2) % 30;
        ctx.globalAlpha = 1 - Math.abs(yOff) / 30;
        ctx.fillText("Z", cx + 25, y - 20 + yOff);
        ctx.font = "bold 14px 'Inter', sans-serif";
        ctx.fillText("z", cx + 35, y - 35 + yOff);
        ctx.globalAlpha = 1;
    },
    drawFloatingHearts(ctx, cx, y, f, theme) {
        ctx.fillStyle = theme.accent;
        ctx.font = "16px sans-serif";
        const yOff = -(f * 3) % 35;
        const xOff = Math.sin(f * 0.3) * 10;
        ctx.globalAlpha = 1 - Math.abs(yOff) / 35;
        ctx.fillText("♥", cx + 30 + xOff, y - 25 + yOff);
        ctx.globalAlpha = 1;
    },
};


// =========================================================================
// Motor Physics — Simulated differential drive
// =========================================================================
const MotorPhysics = {
    update(dt) {
        const r = state.robot;

        // Process action queue
        if (state.currentAction) {
            const elapsed = Date.now() - state.actionStartTime;
            if (elapsed >= state.currentAction.duration_ms) {
                state.currentAction = null;
                r.speed = 0;
            }
        }

        if (!state.currentAction && state.actionQueue.length > 0) {
            state.currentAction = state.actionQueue.shift();
            state.actionStartTime = Date.now();
            this.applyAction(state.currentAction);
        }

        // Update position based on current speed and angle
        if (Math.abs(r.speed) > 0.1 && !state.sensors.emergencyStop) {
            const rad = degToRad(r.angle);
            const dx = Math.cos(rad) * r.speed * dt;
            const dy = Math.sin(rad) * r.speed * dt;

            r.x = clamp(r.x + dx, CONFIG.ROBOT_RADIUS, CONFIG.ROOM_WIDTH_CM - CONFIG.ROBOT_RADIUS);
            r.y = clamp(r.y + dy, CONFIG.ROBOT_RADIUS, CONFIG.ROOM_HEIGHT_CM - CONFIG.ROBOT_RADIUS);

            // Collision check with obstacles
            for (const obs of state.obstacles) {
                const closestX = clamp(r.x, obs.x, obs.x + obs.w);
                const closestY = clamp(r.y, obs.y, obs.y + obs.h);
                const distSq = (r.x - closestX) ** 2 + (r.y - closestY) ** 2;
                if (distSq < CONFIG.ROBOT_RADIUS ** 2) {
                    // Push robot out of obstacle
                    const dist = Math.sqrt(distSq);
                    if (dist > 0) {
                        r.x += (r.x - closestX) / dist * (CONFIG.ROBOT_RADIUS - dist + 1);
                        r.y += (r.y - closestY) / dist * (CONFIG.ROBOT_RADIUS - dist + 1);
                    }
                    r.speed = 0;
                }
            }

            // Add trail point
            r.trail.push({ x: r.x, y: r.y });
            if (r.trail.length > 200) r.trail.shift();
        }

        // Update status
        DOM.statusActions.textContent = state.actionQueue.length + (state.currentAction ? 1 : 0);
    },

    applyAction(action) {
        const speed = (action.speed || 150) / 255 * CONFIG.MAX_SPEED_CM_S;
        switch (action.type) {
            case "FORWARD":
                state.robot.speed = speed;
                break;
            case "BACKWARD":
                state.robot.speed = -speed;
                break;
            case "TURN_LEFT":
                state.robot.angle -= CONFIG.TURN_RATE_DEG_S * (action.duration_ms / 1000);
                state.robot.speed = 0;
                break;
            case "TURN_RIGHT":
                state.robot.angle += CONFIG.TURN_RATE_DEG_S * (action.duration_ms / 1000);
                state.robot.speed = 0;
                break;
            case "STOP":
                state.robot.speed = 0;
                break;
            case "SCAN":
                state.robot.speed = 0;
                // Simulate servo sweep
                addChatEntry("system", "🔍 Performing spatial scan...");
                break;
        }
    }
};


// =========================================================================
// Network Bridge — HTTP client mimicking ESP32
// =========================================================================
const NetworkBridge = {
    async connect(url) {
        state.backendUrl = url.replace(/\/$/, "");
        try {
            const resp = await fetch(`${state.backendUrl}/api/health`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            state.connected = true;
            DOM.connIndicator.className = "indicator online";
            DOM.connLabel.textContent = "Connected";
            DOM.statusLlm.textContent = data.llm_provider || "--";
            DOM.statusWhisper.textContent = data.whisper_loaded ? "Loaded" : "Not loaded";

            addChatEntry("system", `✅ Connected to backend (LLM: ${data.llm_provider})`);

            // Start polling loops
            this.startPolling();
        } catch (e) {
            state.connected = false;
            DOM.connIndicator.className = "indicator offline";
            DOM.connLabel.textContent = "Disconnected";
            addChatEntry("error", `❌ Connection failed: ${e.message}`);
        }
    },

    startPolling() {
        // Clear existing timers
        if (state.telemetryTimer) clearInterval(state.telemetryTimer);
        if (state.commandTimer) clearInterval(state.commandTimer);

        // Telemetry POST every 500ms
        state.telemetryTimer = setInterval(() => this.postTelemetry(), CONFIG.TELEMETRY_INTERVAL_MS);

        // Command GET every 500ms
        state.commandTimer = setInterval(() => this.getCommand(), CONFIG.COMMAND_POLL_MS);
    },

    async postTelemetry() {
        if (!state.connected) return;
        try {
            const resp = await fetch(`${state.backendUrl}/api/telemetry`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    front_distance_cm: state.sensors.frontDistanceCm,
                    left_ir_blocked: state.sensors.leftIrBlocked,
                    right_ir_blocked: state.sensors.rightIrBlocked,
                    servo_angle: state.sensors.servoAngle,
                }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            state.telemCount++;
            DOM.statusTelemRate.textContent = `${(1000 / CONFIG.TELEMETRY_INTERVAL_MS).toFixed(0)} Hz`;
        } catch (e) {
            // Silent fail for telemetry — it's high frequency
        }
    },

    async getCommand() {
        if (!state.connected) return;
        try {
            const resp = await fetch(`${state.backendUrl}/api/command`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const cmd = await resp.json();

            // Update emotion
            if (cmd.emotion && cmd.emotion !== state.emotion) {
                setEmotion(cmd.emotion);
            }

            // Queue actions
            if (cmd.actions && cmd.actions.length > 0) {
                state.actionQueue.push(...cmd.actions);
                addChatEntry("system", `⚙️ Received ${cmd.actions.length} action(s)`);

                // Clear command on backend
                fetch(`${state.backendUrl}/api/command/clear`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                }).catch(() => {});
            }

            // Display speech
            if (cmd.speech_text) {
                state.displayMessage = cmd.speech_text;
                addChatEntry("jarvis", cmd.speech_text);
            }

            // Update processing status
            const statusResp = await fetch(`${state.backendUrl}/api/status`);
            if (statusResp.ok) {
                const statusData = await statusResp.json();
                DOM.statusProcessing.textContent = statusData.is_processing ? "Yes" : "No";
            }
        } catch (e) {
            // Silent fail
        }
    },

    async sendText(text) {
        if (!state.connected) {
            addChatEntry("error", "Not connected to backend");
            return;
        }
        addChatEntry("user", text);
        setEmotion("THINKING");

        try {
            const resp = await fetch(`${state.backendUrl}/api/text`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            if (data.response) {
                addChatEntry("thought", `💭 ${data.response.thought_process}`);
                addChatEntry("jarvis", data.response.speech_reply);
                setEmotion(data.response.emotion);
                state.displayMessage = data.response.speech_reply;

                if (data.response.actions) {
                    state.actionQueue.push(...data.response.actions);
                }
            }
        } catch (e) {
            addChatEntry("error", `Failed: ${e.message}`);
            setEmotion("CONFUSED");
        }
    },

    async sendAudio(blob) {
        if (!state.connected) {
            addChatEntry("error", "Not connected to backend");
            return;
        }

        const formData = new FormData();
        formData.append("audio", blob, "recording.wav");

        setEmotion("LISTENING");
        addChatEntry("system", "🎤 Sending audio to Whisper...");

        try {
            const resp = await fetch(`${state.backendUrl}/api/audio`, {
                method: "POST",
                body: formData,
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            if (data.status === "silence") {
                addChatEntry("system", "🔇 No speech detected");
                setEmotion("IDLE");
            } else if (data.status === "busy") {
                addChatEntry("system", "⏳ Backend is processing...");
            } else if (data.transcript) {
                addChatEntry("user", `🎤 "${data.transcript}"`);
                if (data.response) {
                    addChatEntry("thought", `💭 ${data.response.thought_process}`);
                    addChatEntry("jarvis", data.response.speech_reply);
                    setEmotion(data.response.emotion);
                    state.displayMessage = data.response.speech_reply;
                }
            }
        } catch (e) {
            addChatEntry("error", `Audio failed: ${e.message}`);
            setEmotion("CONFUSED");
        }
    }
};


// =========================================================================
// Audio Capture — Browser microphone via MediaRecorder
// =========================================================================
const AudioCapture = {
    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true }
            });

            state.mediaRecorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg"
            });

            state.audioChunks = [];
            state.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) state.audioChunks.push(e.data);
            };
            state.mediaRecorder.onstop = () => {
                const blob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType });
                NetworkBridge.sendAudio(blob);
                stream.getTracks().forEach(t => t.stop());
            };

            state.mediaRecorder.start();
            state.isRecording = true;
            DOM.btnMic.classList.add("recording");
            DOM.micStatus.textContent = "Recording... click to stop";
            setEmotion("LISTENING");
        } catch (e) {
            addChatEntry("error", `Microphone error: ${e.message}`);
        }
    },

    stopRecording() {
        if (state.mediaRecorder && state.isRecording) {
            state.mediaRecorder.stop();
            state.isRecording = false;
            DOM.btnMic.classList.remove("recording");
            DOM.micStatus.textContent = "Processing...";
            setTimeout(() => { DOM.micStatus.textContent = "Click mic or type below"; }, 3000);
        }
    }
};


// =========================================================================
// Emotion Setter
// =========================================================================
function setEmotion(emotion) {
    state.emotion = emotion;
    DOM.emotionLabel.textContent = emotion;

    // Update emotion grid buttons
    document.querySelectorAll(".emo-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.emotion === emotion);
    });
}


// =========================================================================
// Event Handlers
// =========================================================================
function setupEvents() {
    // Connect button
    DOM.btnConnect.addEventListener("click", () => {
        NetworkBridge.connect(DOM.backendUrl.value);
    });

    // Text input
    DOM.btnSend.addEventListener("click", () => {
        const text = DOM.textInput.value.trim();
        if (text) {
            NetworkBridge.sendText(text);
            DOM.textInput.value = "";
        }
    });

    DOM.textInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") DOM.btnSend.click();
    });

    // Microphone
    DOM.btnMic.addEventListener("click", () => {
        if (state.isRecording) {
            AudioCapture.stopRecording();
        } else {
            AudioCapture.startRecording();
        }
    });

    // Emotion buttons
    document.querySelectorAll(".emo-btn").forEach(btn => {
        btn.addEventListener("click", () => setEmotion(btn.dataset.emotion));
    });

    // Motor D-pad
    document.getElementById("btn-forward").addEventListener("click", () => {
        state.actionQueue.push({ type: "FORWARD", duration_ms: 500, speed: 150 });
    });
    document.getElementById("btn-backward").addEventListener("click", () => {
        state.actionQueue.push({ type: "BACKWARD", duration_ms: 500, speed: 150 });
    });
    document.getElementById("btn-left").addEventListener("click", () => {
        state.actionQueue.push({ type: "TURN_LEFT", duration_ms: 400, speed: 150 });
    });
    document.getElementById("btn-right").addEventListener("click", () => {
        state.actionQueue.push({ type: "TURN_RIGHT", duration_ms: 400, speed: 150 });
    });
    document.getElementById("btn-stop").addEventListener("click", () => {
        state.actionQueue = [];
        state.currentAction = null;
        state.robot.speed = 0;
    });

    // Keyboard controls (WASD)
    document.addEventListener("keydown", (e) => {
        if (document.activeElement === DOM.textInput || document.activeElement === DOM.backendUrl) return;
        switch (e.key.toLowerCase()) {
            case "w": state.actionQueue.push({ type: "FORWARD", duration_ms: 200, speed: 150 }); break;
            case "s": state.actionQueue.push({ type: "BACKWARD", duration_ms: 200, speed: 150 }); break;
            case "a": state.actionQueue.push({ type: "TURN_LEFT", duration_ms: 200, speed: 150 }); break;
            case "d": state.actionQueue.push({ type: "TURN_RIGHT", duration_ms: 200, speed: 150 }); break;
            case " ": state.actionQueue = []; state.currentAction = null; state.robot.speed = 0; e.preventDefault(); break;
        }
    });

    // Room canvas — obstacle placement and dragging
    const canvas = DOM.roomCanvas;

    canvas.addEventListener("mousedown", (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width * canvas.width;
        const my = (e.clientY - rect.top) / rect.height * canvas.height;
        const cmX = RoomSim.pixelToCm(mx, "x");
        const cmY = RoomSim.pixelToCm(my, "y");

        // Check if clicking on existing obstacle
        for (let i = state.obstacles.length - 1; i >= 0; i--) {
            const obs = state.obstacles[i];
            if (cmX >= obs.x && cmX <= obs.x + obs.w && cmY >= obs.y && cmY <= obs.y + obs.h) {
                state.dragging = i;
                state.dragOffset = { x: cmX - obs.x, y: cmY - obs.y };
                return;
            }
        }
    });

    canvas.addEventListener("mousemove", (e) => {
        if (state.dragging === null) return;
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width * canvas.width;
        const my = (e.clientY - rect.top) / rect.height * canvas.height;
        const cmX = RoomSim.pixelToCm(mx, "x");
        const cmY = RoomSim.pixelToCm(my, "y");

        const obs = state.obstacles[state.dragging];
        obs.x = clamp(cmX - state.dragOffset.x, 0, CONFIG.ROOM_WIDTH_CM - obs.w);
        obs.y = clamp(cmY - state.dragOffset.y, 0, CONFIG.ROOM_HEIGHT_CM - obs.h);
    });

    canvas.addEventListener("mouseup", () => {
        state.dragging = null;
    });

    canvas.addEventListener("dblclick", (e) => {
        // Double-click to delete obstacle
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width * canvas.width;
        const my = (e.clientY - rect.top) / rect.height * canvas.height;
        const cmX = RoomSim.pixelToCm(mx, "x");
        const cmY = RoomSim.pixelToCm(my, "y");

        for (let i = state.obstacles.length - 1; i >= 0; i--) {
            const obs = state.obstacles[i];
            if (cmX >= obs.x && cmX <= obs.x + obs.w && cmY >= obs.y && cmY <= obs.y + obs.h) {
                state.obstacles.splice(i, 1);
                return;
            }
        }
    });

    // Add/Clear/Reset buttons
    document.getElementById("btn-add-obstacle").addEventListener("click", () => {
        const x = 20 + Math.random() * (CONFIG.ROOM_WIDTH_CM - 60);
        const y = 20 + Math.random() * (CONFIG.ROOM_HEIGHT_CM - 60);
        const w = 10 + Math.random() * 20;
        const h = 10 + Math.random() * 20;
        state.obstacles.push({ x, y, w, h });
    });

    document.getElementById("btn-clear-obstacles").addEventListener("click", () => {
        state.obstacles = [];
    });

    document.getElementById("btn-reset-robot").addEventListener("click", () => {
        state.robot.x = 100;
        state.robot.y = 80;
        state.robot.angle = 0;
        state.robot.speed = 0;
        state.robot.trail = [];
        state.actionQueue = [];
        state.currentAction = null;
        state.sensors.emergencyStop = false;
        setEmotion("IDLE");
        state.displayMessage = "";
    });

    document.getElementById("btn-clear-chat").addEventListener("click", () => {
        DOM.chatLog.innerHTML = "";
        addChatEntry("system", "Chat log cleared.");
    });

    // Resize handler — update canvas dimensions
    function resizeCanvases() {
        const roomContainer = document.getElementById("room-container");
        const rw = roomContainer.clientWidth - 32;
        const rh = roomContainer.clientHeight - 16;
        // Maintain aspect ratio
        const aspect = CONFIG.ROOM_WIDTH_CM / CONFIG.ROOM_HEIGHT_CM;
        let cw = rw, ch = rw / aspect;
        if (ch > rh) { ch = rh; cw = ch * aspect; }
        DOM.roomCanvas.width = Math.floor(cw);
        DOM.roomCanvas.height = Math.floor(ch);
    }

    window.addEventListener("resize", resizeCanvases);
    setTimeout(resizeCanvases, 100);
}


// =========================================================================
// Main Loop — 60fps rendering, 20Hz physics
// =========================================================================
let lastTime = 0;
let physicsAccumulator = 0;
const PHYSICS_STEP = 1 / 20; // 20Hz physics

function mainLoop(timestamp) {
    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    // Physics update at fixed 20Hz
    physicsAccumulator += dt;
    while (physicsAccumulator >= PHYSICS_STEP) {
        RoomSim.updateSensors();
        MotorPhysics.update(PHYSICS_STEP);
        physicsAccumulator -= PHYSICS_STEP;
    }

    // Render at display refresh rate
    RoomSim.render();
    EmotionRenderer.render();

    requestAnimationFrame(mainLoop);
}


// =========================================================================
// Initialization
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
    cacheDom();
    setupEvents();
    addChatEntry("system", "🤖 JARVIS Simulation Console initialized");
    addChatEntry("system", "Use WASD keys or D-pad for manual control. Space to stop.");
    addChatEntry("system", "Connect to the FastAPI backend to enable AI features.");
    requestAnimationFrame(mainLoop);
});
