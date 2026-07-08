import React, { useEffect, useRef, useState, useCallback } from 'react';

const CONFIG = {
  ROOM_WIDTH_CM: 200,
  ROOM_HEIGHT_CM: 160,
  ROBOT_RADIUS: 8, // cm
  ROBOT_COLOR: '#29B6F6',
  ROBOT_TRAIL_COLOR: 'rgba(41, 182, 246, 0.1)',
  ULTRASONIC_MAX_CM: 200,
  ULTRASONIC_FOV_DEG: 15,
  IR_EDGE_MARGIN_CM: 5,
  MAX_SPEED_CM_S: 30,
  TURN_RATE_DEG_S: 120
};

function RoomSimulator({
  robotRef,
  sensorsRef,
  obstaclesRef,
  actionQueueRef,
  currentActionRef,
  actionStartTimeRef,
  sensorReadouts,
  setSensorReadouts,
  setActionQueueCount,
  addChatEntry,
  setEmotion,
  mode3d
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [dragState, setDragState] = useState(null);

  // ─── Store latest prop callbacks in refs so the animation loop never goes stale ───
  const addChatEntryRef = useRef(addChatEntry);
  const setEmotionRef = useRef(setEmotion);
  const setSensorReadoutsRef = useRef(setSensorReadouts);
  const setActionQueueCountRef = useRef(setActionQueueCount);

  useEffect(() => { addChatEntryRef.current = addChatEntry; }, [addChatEntry]);
  useEffect(() => { setEmotionRef.current = setEmotion; }, [setEmotion]);
  useEffect(() => { setSensorReadoutsRef.current = setSensorReadouts; }, [setSensorReadouts]);
  useEffect(() => { setActionQueueCountRef.current = setActionQueueCount; }, [setActionQueueCount]);

  // Throttle sensor readout updates to 4Hz instead of 20Hz to reduce re-renders
  const lastSensorUpdateRef = useRef(0);

  // ─── Pure helper functions (no closures needed) ───
  const degToRad = (deg) => (deg * Math.PI) / 180;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const cmToPixel = (cm, axis, canvas) => {
    if (!canvas) return 0;
    if (axis === 'x') return (cm / CONFIG.ROOM_WIDTH_CM) * canvas.width;
    return (cm / CONFIG.ROOM_HEIGHT_CM) * canvas.height;
  };

  const pixelToCm = (px, axis, canvas) => {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return 0;
    if (axis === 'x') return (px / canvas.width) * CONFIG.ROOM_WIDTH_CM;
    return (px / canvas.height) * CONFIG.ROOM_HEIGHT_CM;
  };

  // ─── Raycasting ───
  const raycast = (originX, originY, angleDeg) => {
    const step = 1;
    const maxDist = CONFIG.ULTRASONIC_MAX_CM;
    const rad = degToRad(angleDeg);
    const dx = Math.cos(rad) * step;
    const dy = Math.sin(rad) * step;

    let x = originX;
    let y = originY;

    for (let d = 0; d < maxDist; d += step) {
      x += dx;
      y += dy;

      if (x < 0 || x > CONFIG.ROOM_WIDTH_CM || y < 0 || y > CONFIG.ROOM_HEIGHT_CM) {
        return d;
      }

      for (const obs of obstaclesRef.current) {
        if (x >= obs.x && x <= obs.x + obs.w && y >= obs.y && y <= obs.y + obs.h) {
          return d;
        }
      }
    }
    return maxDist;
  };

  // ─── Main animation loop (uses only refs, never stale) ───
  useEffect(() => {
    let animationFrameId = null;
    let lastTime = performance.now();
    let physicsAccumulator = 0;
    const PHYSICS_STEP = 1 / 20; // 20Hz physics
    let isRunning = true;

    const loop = (timestamp) => {
      if (!isRunning) return;

      try {
        let dt = (timestamp - lastTime) / 1000;
        // Clamp dt to prevent "spiral of death" when tab loses focus
        if (dt > 0.1) dt = 0.05;
        if (dt < 0) dt = 0; // guard against negative dt
        lastTime = timestamp;

        physicsAccumulator += dt;
        let shouldUpdateSensors = false;

        while (physicsAccumulator >= PHYSICS_STEP) {
          // ── Physics Update ──
          const robot = robotRef.current;
          const sensors = sensorsRef.current;

          // Process current action completion
          if (currentActionRef.current) {
            const elapsed = Date.now() - actionStartTimeRef.current;
            if (elapsed >= currentActionRef.current.duration_ms) {
              currentActionRef.current = null;
              robot.speed = 0;
              setActionQueueCountRef.current(actionQueueRef.current.length);
            }
          }

          // Pop next action from queue
          if (!currentActionRef.current && actionQueueRef.current.length > 0) {
            currentActionRef.current = actionQueueRef.current.shift();
            actionStartTimeRef.current = Date.now();
            setActionQueueCountRef.current(actionQueueRef.current.length + 1);

            const action = currentActionRef.current;
            const speedValue = (action.speed || 150) / 255 * CONFIG.MAX_SPEED_CM_S;

            switch (action.type) {
              case 'FORWARD':
                robot.speed = speedValue;
                break;
              case 'BACKWARD':
                robot.speed = -speedValue;
                break;
              case 'TURN_LEFT':
                robot.angle -= CONFIG.TURN_RATE_DEG_S * (action.duration_ms / 1000);
                robot.speed = 0;
                break;
              case 'TURN_RIGHT':
                robot.angle += CONFIG.TURN_RATE_DEG_S * (action.duration_ms / 1000);
                robot.speed = 0;
                break;
              case 'STOP':
                robot.speed = 0;
                actionQueueRef.current = [];
                currentActionRef.current = null;
                setActionQueueCountRef.current(0);
                break;
              case 'SCAN':
                robot.speed = 0;
                addChatEntryRef.current('system', '🔍 Performing spatial scan...');
                break;
              default:
                break;
            }
          }

          // Kinematic movement
          if (Math.abs(robot.speed) > 0.1 && !sensors.emergencyStop) {
            const rad = degToRad(robot.angle);
            const dx = Math.cos(rad) * robot.speed * PHYSICS_STEP;
            const dy = Math.sin(rad) * robot.speed * PHYSICS_STEP;

            robot.x = clamp(robot.x + dx, CONFIG.ROBOT_RADIUS, CONFIG.ROOM_WIDTH_CM - CONFIG.ROBOT_RADIUS);
            robot.y = clamp(robot.y + dy, CONFIG.ROBOT_RADIUS, CONFIG.ROOM_HEIGHT_CM - CONFIG.ROBOT_RADIUS);

            // Obstacle collisions
            for (const obs of obstaclesRef.current) {
              const closestX = clamp(robot.x, obs.x, obs.x + obs.w);
              const closestY = clamp(robot.y, obs.y, obs.y + obs.h);
              const distSq = (robot.x - closestX) ** 2 + (robot.y - closestY) ** 2;

              if (distSq < CONFIG.ROBOT_RADIUS ** 2) {
                const dist = Math.sqrt(distSq);
                if (dist > 0) {
                  robot.x += ((robot.x - closestX) / dist) * (CONFIG.ROBOT_RADIUS - dist + 0.5);
                  robot.y += ((robot.y - closestY) / dist) * (CONFIG.ROBOT_RADIUS - dist + 0.5);
                }
                robot.speed = 0;
              }
            }

            // Trail
            robot.trail.push({ x: robot.x, y: robot.y });
            if (robot.trail.length > 200) robot.trail.shift();
          }

          shouldUpdateSensors = true;
          physicsAccumulator -= PHYSICS_STEP;
        }

        // ── Sensor Update (after physics) ──
        if (shouldUpdateSensors) {
          const robot = robotRef.current;
          const sensors = sensorsRef.current;

          sensors.frontDistanceCm = raycast(robot.x, robot.y, robot.angle);

          const leftAngle = robot.angle - 90;
          const leftDist = raycast(robot.x, robot.y, leftAngle);
          sensors.leftIrBlocked = leftDist < CONFIG.IR_EDGE_MARGIN_CM ||
            robot.x < CONFIG.IR_EDGE_MARGIN_CM || robot.y < CONFIG.IR_EDGE_MARGIN_CM;

          const rightAngle = robot.angle + 90;
          const rightDist = raycast(robot.x, robot.y, rightAngle);
          sensors.rightIrBlocked = rightDist < CONFIG.IR_EDGE_MARGIN_CM ||
            robot.x > CONFIG.ROOM_WIDTH_CM - CONFIG.IR_EDGE_MARGIN_CM ||
            robot.y > CONFIG.ROOM_HEIGHT_CM - CONFIG.IR_EDGE_MARGIN_CM;

          // Emergency Stop
          if (sensors.frontDistanceCm < 15 || sensors.leftIrBlocked || sensors.rightIrBlocked) {
            if (!sensors.emergencyStop) {
              sensors.emergencyStop = true;
              robot.speed = 0;
              currentActionRef.current = null;
              actionQueueRef.current = [];
              setActionQueueCountRef.current(0);
              addChatEntryRef.current('error', '⚠️ Emergency stop — obstacle or table edge detected!');
              setEmotionRef.current('ALERT');
            }
          } else {
            sensors.emergencyStop = false;
          }

          // Throttle React state updates to ~4Hz
          const now = performance.now();
          if (now - lastSensorUpdateRef.current > 250) {
            lastSensorUpdateRef.current = now;
            setSensorReadoutsRef.current({
              frontDistanceCm: sensors.frontDistanceCm,
              leftIrBlocked: sensors.leftIrBlocked,
              rightIrBlocked: sensors.rightIrBlocked,
              servoAngle: sensors.servoAngle,
              speed: robot.speed,
              emergencyStop: sensors.emergencyStop
            });
          }
        }

        // ── Render ──
        const canvas = canvasRef.current;
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          const ctx = canvas.getContext('2d');
          const W = canvas.width;
          const H = canvas.height;
          const robot = robotRef.current;

          ctx.clearRect(0, 0, W, H);

          // Background
          ctx.fillStyle = 'hsl(225, 25%, 8%)';
          ctx.fillRect(0, 0, W, H);

          // Grid
          ctx.strokeStyle = 'hsla(215, 15%, 25%, 0.3)';
          ctx.lineWidth = 0.5;
          const gridSpacingCm = 20;

          for (let x = 0; x <= CONFIG.ROOM_WIDTH_CM; x += gridSpacingCm) {
            const px = cmToPixel(x, 'x', canvas);
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, H);
            ctx.stroke();
          }
          for (let y = 0; y <= CONFIG.ROOM_HEIGHT_CM; y += gridSpacingCm) {
            const py = cmToPixel(y, 'y', canvas);
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(W, py);
            ctx.stroke();
          }

          // Boundary
          ctx.strokeStyle = 'hsla(0, 72%, 55%, 0.5)';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 4]);
          ctx.strokeRect(2, 2, W - 4, H - 4);
          ctx.setLineDash([]);

          // Robot Trail
          if (robot.trail.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = CONFIG.ROBOT_TRAIL_COLOR;
            ctx.lineWidth = cmToPixel(CONFIG.ROBOT_RADIUS * 0.6, 'x', canvas);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            const t0 = robot.trail[0];
            ctx.moveTo(cmToPixel(t0.x, 'x', canvas), cmToPixel(t0.y, 'y', canvas));
            for (let i = 1; i < robot.trail.length; i++) {
              const t = robot.trail[i];
              ctx.lineTo(cmToPixel(t.x, 'x', canvas), cmToPixel(t.y, 'y', canvas));
            }
            ctx.stroke();
          }

          // Obstacles
          for (const obs of obstaclesRef.current) {
            const ox = cmToPixel(obs.x, 'x', canvas);
            const oy = cmToPixel(obs.y, 'y', canvas);
            const ow = cmToPixel(obs.w, 'x', canvas);
            const oh = cmToPixel(obs.h, 'y', canvas);

            ctx.fillStyle = 'hsla(0, 0%, 0%, 0.3)';
            ctx.fillRect(ox + 3, oy + 3, ow, oh);

            const gradient = ctx.createLinearGradient(ox, oy, ox + ow, oy + oh);
            gradient.addColorStop(0, 'hsl(225, 15%, 25%)');
            gradient.addColorStop(1, 'hsl(225, 15%, 18%)');
            ctx.fillStyle = gradient;
            ctx.fillRect(ox, oy, ow, oh);
            ctx.strokeStyle = 'hsla(215, 15%, 40%, 0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(ox, oy, ow, oh);
          }

          // Front sensor cone
          const rPx = cmToPixel(robot.x, 'x', canvas);
          const rPy = cmToPixel(robot.y, 'y', canvas);
          const beamDist = sensorsRef.current.frontDistanceCm;
          const beamAngle = degToRad(robot.angle);
          const beamEndX = rPx + Math.cos(beamAngle) * cmToPixel(beamDist, 'x', canvas);
          const beamEndY = rPy + Math.sin(beamAngle) * cmToPixel(beamDist, 'y', canvas);

          const fovRad = degToRad(CONFIG.ULTRASONIC_FOV_DEG);
          ctx.beginPath();
          ctx.moveTo(rPx, rPy);
          ctx.lineTo(
            rPx + Math.cos(beamAngle - fovRad) * cmToPixel(beamDist, 'x', canvas),
            rPy + Math.sin(beamAngle - fovRad) * cmToPixel(beamDist, 'y', canvas)
          );
          ctx.lineTo(beamEndX, beamEndY);
          ctx.lineTo(
            rPx + Math.cos(beamAngle + fovRad) * cmToPixel(beamDist, 'x', canvas),
            rPy + Math.sin(beamAngle + fovRad) * cmToPixel(beamDist, 'y', canvas)
          );
          ctx.closePath();
          const beamColor = beamDist < 15 ? 'hsla(0, 72%, 55%, 0.08)' : 'hsla(195, 100%, 55%, 0.06)';
          ctx.fillStyle = beamColor;
          ctx.fill();

          // Center ray line
          ctx.beginPath();
          ctx.moveTo(rPx, rPy);
          ctx.lineTo(beamEndX, beamEndY);
          ctx.strokeStyle = beamDist < 15 ? 'hsla(0, 72%, 55%, 0.4)' : 'hsla(195, 100%, 55%, 0.3)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Robot body
          const bodyR = cmToPixel(CONFIG.ROBOT_RADIUS, 'x', canvas);

          // Glow ring
          const glow = ctx.createRadialGradient(rPx, rPy, 0, rPx, rPy, bodyR * 2.5);
          glow.addColorStop(0, sensorsRef.current.emergencyStop ? 'hsla(0, 72%, 55%, 0.15)' : 'hsla(195, 100%, 55%, 0.12)');
          glow.addColorStop(1, 'transparent');
          ctx.fillStyle = glow;
          ctx.fillRect(rPx - bodyR * 3, rPy - bodyR * 3, bodyR * 6, bodyR * 6);

          // Main body circle
          ctx.beginPath();
          ctx.arc(rPx, rPy, bodyR, 0, Math.PI * 2);
          ctx.fillStyle = sensorsRef.current.emergencyStop ? '#EF5350' : CONFIG.ROBOT_COLOR;
          ctx.fill();
          ctx.strokeStyle = 'hsla(0, 0%, 100%, 0.3)';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Direction nose
          const noseX = rPx + Math.cos(beamAngle) * bodyR * 0.8;
          const noseY = rPy + Math.sin(beamAngle) * bodyR * 0.8;
          ctx.beginPath();
          ctx.arc(noseX, noseY, bodyR * 0.25, 0, Math.PI * 2);
          ctx.fillStyle = 'white';
          ctx.fill();

          // Distance readout
          if (beamDist < CONFIG.ULTRASONIC_MAX_CM) {
            ctx.fillStyle = beamDist < 15 ? '#EF5350' : '#29B6F6';
            ctx.font = "bold 11px 'Inter', sans-serif";
            ctx.textAlign = 'center';
            ctx.fillText(`${beamDist.toFixed(0)}cm`, beamEndX, beamEndY - 8);
          }
        }
      } catch (err) {
        console.error('[RoomSimulator] Animation loop error:', err);
      }

      // Always schedule next frame, even if there was an error
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      isRunning = false;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, []); // Empty deps: runs once, uses refs for everything

  // ─── Canvas resize ───
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rw = container.clientWidth - 32;
      const rh = container.clientHeight - 16;
      const aspect = CONFIG.ROOM_WIDTH_CM / CONFIG.ROOM_HEIGHT_CM;

      let cw = rw;
      let ch = rw / aspect;

      if (ch > rh) {
        ch = rh;
        cw = ch * aspect;
      }

      canvas.width = Math.max(1, Math.floor(cw));
      canvas.height = Math.max(1, Math.floor(ch));
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    // Retry after layout settles
    const timer = setTimeout(handleResize, 150);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, []);

  // ─── Canvas Mouse Interaction ───
  const handleMouseDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const my = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const cmX = pixelToCm(mx, 'x', canvas);
    const cmY = pixelToCm(my, 'y', canvas);

    for (let i = obstaclesRef.current.length - 1; i >= 0; i--) {
      const obs = obstaclesRef.current[i];
      if (cmX >= obs.x && cmX <= obs.x + obs.w && cmY >= obs.y && cmY <= obs.y + obs.h) {
        setDragState({
          index: i,
          offsetX: cmX - obs.x,
          offsetY: cmY - obs.y
        });
        return;
      }
    }
  }, []);

  const handleMouseMove = useCallback((e) => {
    setDragState((currentDrag) => {
      if (currentDrag === null) return null;
      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return currentDrag;
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const my = ((e.clientY - rect.top) / rect.height) * canvas.height;
      const cmX = pixelToCm(mx, 'x', canvas);
      const cmY = pixelToCm(my, 'y', canvas);

      const obs = obstaclesRef.current[currentDrag.index];
      if (obs) {
        obs.x = clamp(cmX - currentDrag.offsetX, 0, CONFIG.ROOM_WIDTH_CM - obs.w);
        obs.y = clamp(cmY - currentDrag.offsetY, 0, CONFIG.ROOM_HEIGHT_CM - obs.h);
      }
      return currentDrag; // Don't trigger unnecessary state change
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    setDragState(null);
  }, []);

  const handleDoubleClick = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const my = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const cmX = pixelToCm(mx, 'x', canvas);
    const cmY = pixelToCm(my, 'y', canvas);

    for (let i = obstaclesRef.current.length - 1; i >= 0; i--) {
      const obs = obstaclesRef.current[i];
      if (cmX >= obs.x && cmX <= obs.x + obs.w && cmY >= obs.y && cmY <= obs.y + obs.h) {
        obstaclesRef.current.splice(i, 1);
        return;
      }
    }
  }, []);

  const handleAddObstacle = useCallback(() => {
    const x = 20 + Math.random() * (CONFIG.ROOM_WIDTH_CM - 60);
    const y = 20 + Math.random() * (CONFIG.ROOM_HEIGHT_CM - 60);
    const w = 10 + Math.random() * 20;
    const h = 10 + Math.random() * 20;
    obstaclesRef.current.push({ x, y, w, h });
  }, []);

  const handleClearObstacles = useCallback(() => {
    obstaclesRef.current.length = 0; // mutate in-place instead of reassigning
  }, []);

  const handleResetRobot = useCallback(() => {
    const robot = robotRef.current;
    robot.x = 100;
    robot.y = 80;
    robot.angle = 0;
    robot.speed = 0;
    robot.trail = [];
    actionQueueRef.current.length = 0;
    currentActionRef.current = null;
    sensorsRef.current.emergencyStop = false;
    setActionQueueCountRef.current(0);
    setEmotionRef.current('IDLE');
    addChatEntryRef.current('system', 'Robot position reset.');
  }, []);

  return (
    <section id="panel-room" className="panel depth-bg">
      <div className="panel-header">
        <h2>Simulation Room</h2>
        <div className="panel-controls">
          <button 
            id="btn-add-obstacle" 
            className="btn-ghost depth-interactive" 
            onClick={handleAddObstacle}
            title="Add Obstacle"
          >
            + Obstacle
          </button>
          <button 
            id="btn-clear-obstacles" 
            className="btn-ghost depth-interactive" 
            onClick={handleClearObstacles}
            title="Clear All"
          >
            Clear
          </button>
          <button 
            id="btn-reset-robot" 
            className="btn-ghost depth-interactive" 
            onClick={handleResetRobot}
            title="Reset Robot Position"
          >
            Reset
          </button>
        </div>
      </div>
      <div id="room-container" ref={containerRef}>
        <canvas 
          id="room-canvas" 
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
        />
        <div id="room-overlay">
          <span className="hint">Click to place obstacles • Drag to move them • Double click to delete</span>
        </div>
      </div>
      
      {/* Sensor Readouts */}
      <div id="sensor-readout" className="depth-interactive" style={{ margin: '0 var(--gap-md) var(--gap-md)' }}>
        <div className="readout-item">
          <span className="readout-label">Front</span>
          <span id="readout-front" className={`readout-value ${sensorReadouts.frontDistanceCm < 15 ? 'danger' : ''}`}>
            {sensorReadouts.frontDistanceCm.toFixed(1)}
          </span>
          <span className="readout-unit">cm</span>
        </div>
        <div className="readout-item">
          <span className="readout-label">Left IR</span>
          <span id="readout-left-ir" className={`readout-value ${sensorReadouts.leftIrBlocked ? 'danger' : 'safe'}`}>
            {sensorReadouts.leftIrBlocked ? 'BLOCKED' : 'CLEAR'}
          </span>
        </div>
        <div className="readout-item">
          <span className="readout-label">Right IR</span>
          <span id="readout-right-ir" className={`readout-value ${sensorReadouts.rightIrBlocked ? 'danger' : 'safe'}`}>
            {sensorReadouts.rightIrBlocked ? 'BLOCKED' : 'CLEAR'}
          </span>
        </div>
        <div className="readout-item">
          <span className="readout-label">Servo</span>
          <span id="readout-servo" className="readout-value">{sensorReadouts.servoAngle}°</span>
        </div>
        <div className="readout-item">
          <span className="readout-label">Speed</span>
          <span id="readout-speed" className="readout-value">{Math.abs(sensorReadouts.speed).toFixed(0)}</span>
        </div>
      </div>
    </section>
  );
}

export default RoomSimulator;
