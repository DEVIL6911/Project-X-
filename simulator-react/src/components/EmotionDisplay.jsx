import React, { useEffect, useRef } from 'react';

const EMOTION_THEMES = {
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
};

function EmotionDisplay({ emotion, setEmotion, displayMessage }) {
  const canvasRef = useRef(null);
  const frameCountRef = useRef(0);

  // Helper render shapes
  const drawCircleEyes = (ctx, lx, rx, y, r) => {
    ctx.beginPath(); ctx.arc(lx, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(rx, y, r, 0, Math.PI * 2); ctx.fill();
  };

  const drawSleepyEyes = (ctx, lx, rx, y) => {
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(lx, y + 2, 10, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(rx, y + 2, 10, 0.2, Math.PI - 0.2); ctx.stroke();
  };

  const drawDiamondEyes = (ctx, lx, rx, y) => {
    for (const ex of [lx, rx]) {
      ctx.beginPath();
      ctx.moveTo(ex, y - 12); ctx.lineTo(ex + 9, y);
      ctx.lineTo(ex, y + 12); ctx.lineTo(ex - 9, y);
      ctx.closePath(); ctx.fill();
    }
  };

  const drawAngryEyes = (ctx, lx, rx, y) => {
    ctx.beginPath(); ctx.arc(lx, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(rx, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(lx - 14, y - 16); ctx.lineTo(lx + 8, y - 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx + 14, y - 16); ctx.lineTo(rx - 8, y - 8); ctx.stroke();
  };

  const drawHeartEyes = (ctx, lx, rx, y) => {
    for (const ex of [lx, rx]) {
      ctx.beginPath(); ctx.arc(ex - 6, y - 5, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + 6, y - 5, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(ex - 13, y - 2); ctx.lineTo(ex, y + 12); ctx.lineTo(ex + 13, y - 2);
      ctx.fill();
    }
  };

  const drawBigEyes = (ctx, lx, rx, y, theme) => {
    ctx.beginPath(); ctx.arc(lx, y, 15, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(rx, y, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = theme.bg;
    ctx.beginPath(); ctx.arc(lx, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(rx, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = theme.eye;
  };

  const drawHalfLidEyes = (ctx, lx, rx, y, theme) => {
    ctx.beginPath(); ctx.arc(lx, y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(rx, y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = theme.bg;
    ctx.fillRect(lx - 12, y - 12, 24, 12);
    ctx.fillRect(rx - 12, y - 12, 24, 12);
    ctx.fillStyle = theme.eye;
  };

  const drawSmile = (ctx, cx, y) => {
    ctx.beginPath();
    ctx.arc(cx, y - 5, 20, 0.3, Math.PI - 0.3);
    ctx.stroke();
  };

  const drawFrown = (ctx, cx, y) => {
    ctx.beginPath();
    ctx.arc(cx, y + 15, 20, Math.PI + 0.3, -0.3);
    ctx.stroke();
  };

  const drawOpenMouth = (ctx, cx, y, theme) => {
    ctx.beginPath(); ctx.arc(cx, y + 5, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = theme.bg;
    ctx.beginPath(); ctx.arc(cx, y + 5, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = theme.mouth;
  };

  const drawJaggedMouth = (ctx, cx, y) => {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 22, y);
    for (let i = 0; i < 5; i++) {
      ctx.lineTo(cx - 22 + i * 11 + 5, y + (i % 2 === 0 ? 8 : -4));
    }
    ctx.stroke();
  };

  const drawSquiggle = (ctx, cx, y, f) => {
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = -20; i <= 20; i++) {
      const sy = y + Math.sin((i + f) * 0.4) * 4;
      if (i === -20) ctx.moveTo(cx + i, sy);
      else ctx.lineTo(cx + i, sy);
    }
    ctx.stroke();
  };

  const drawThinkingDots = (ctx, cx, y, f, theme) => {
    const numDots = Math.floor(f / 5) % 4;
    ctx.fillStyle = theme.accent;
    for (let i = 0; i < numDots && i < 3; i++) {
      ctx.beginPath(); ctx.arc(cx - 15 + i * 15, y, 5, 0, Math.PI * 2); ctx.fill();
    }
  };

  const drawListeningRings = (ctx, cx, y, f, theme) => {
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    const r = ((f * 3) % 40) + 8;
    ctx.globalAlpha = 1 - r / 48;
    ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.stroke();
    if (r > 15) {
      ctx.beginPath(); ctx.arc(cx, y, r - 15, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const drawFloatingZ = (ctx, cx, y, f, theme) => {
    ctx.fillStyle = theme.accent;
    ctx.font = "bold 18px 'Inter', sans-serif";
    const yOff = -(f * 2) % 30;
    ctx.globalAlpha = 1 - Math.abs(yOff) / 30;
    ctx.fillText('Z', cx + 25, y - 20 + yOff);
    ctx.font = "bold 14px 'Inter', sans-serif";
    ctx.fillText('z', cx + 35, y - 35 + yOff);
    ctx.globalAlpha = 1;
  };

  const drawFloatingHearts = (ctx, cx, y, f, theme) => {
    ctx.fillStyle = theme.accent;
    ctx.font = '16px sans-serif';
    const yOff = -(f * 3) % 35;
    const xOff = Math.sin(f * 0.3) * 10;
    ctx.globalAlpha = 1 - Math.abs(yOff) / 35;
    ctx.fillText('♥', cx + 30 + xOff, y - 25 + yOff);
    ctx.globalAlpha = 1;
  };

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 256;
    const H = 320;

    let animId = null;

    const renderFace = () => {
      const activeEmotion = emotion;
      const theme = EMOTION_THEMES[activeEmotion] || EMOTION_THEMES.IDLE;
      const f = frameCountRef.current;

      // Background fill
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, W, H);

      // Coordinates
      const cx = W / 2;
      const eyeY = H * 0.34;
      const eyeLX = cx - 35;
      const eyeRX = cx + 35;
      const mouthY = H * 0.56;

      // Displacement animations
      let bounceY = 0;
      let shakeX = 0;
      if (activeEmotion === 'EXCITED') bounceY = Math.sin(f * 0.8) * 4;
      if (activeEmotion === 'ANGRY') shakeX = f % 4 < 2 ? 3 : -3;
      if (activeEmotion === 'HAPPY') bounceY = Math.sin(f * 0.3) * 2;

      ctx.save();
      ctx.translate(shakeX, bounceY);

      // Blink checking
      const isBlinking = (f % 30 < 2) && activeEmotion !== 'SLEEPING' && activeEmotion !== 'ANGRY';

      // --- Draw Eyes ---
      ctx.fillStyle = theme.eye;
      ctx.strokeStyle = theme.eye;

      if (isBlinking) {
        ctx.fillRect(eyeLX - 12, eyeY - 2, 24, 4);
        ctx.fillRect(eyeRX - 12, eyeY - 2, 24, 4);
      } else {
        switch (activeEmotion) {
          case 'IDLE':
          case 'LISTENING':
            drawCircleEyes(ctx, eyeLX, eyeRX, eyeY, 10);
            break;
          case 'HAPPY':
          case 'EXCITED':
            drawCircleEyes(ctx, eyeLX, eyeRX, eyeY, 12);
            break;
          case 'SAD':
          case 'SLEEPING':
            drawSleepyEyes(ctx, eyeLX, eyeRX, eyeY);
            break;
          case 'THINKING':
            ctx.beginPath(); ctx.arc(eyeLX, eyeY, 10, 0, Math.PI * 2); ctx.fill();
            ctx.fillRect(eyeRX - 12, eyeY - 2, 24, 4);
            break;
          case 'ALERT':
            drawDiamondEyes(ctx, eyeLX, eyeRX, eyeY);
            break;
          case 'CONFUSED':
            ctx.beginPath(); ctx.arc(eyeLX, eyeY, 12, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(eyeRX, eyeY, 7, 0, Math.PI * 2); ctx.fill();
            break;
          case 'ANGRY':
            drawAngryEyes(ctx, eyeLX, eyeRX, eyeY);
            break;
          case 'SHY':
            ctx.beginPath(); ctx.arc(eyeLX + 4, eyeY + 3, 7, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(eyeRX + 4, eyeY + 3, 7, 0, Math.PI * 2); ctx.fill();
            break;
          case 'LOVE':
            drawHeartEyes(ctx, eyeLX, eyeRX, eyeY);
            break;
          case 'SURPRISED':
            drawBigEyes(ctx, eyeLX, eyeRX, eyeY, theme);
            break;
          case 'BORED':
            drawHalfLidEyes(ctx, eyeLX, eyeRX, eyeY, theme);
            break;
          default:
            drawCircleEyes(ctx, eyeLX, eyeRX, eyeY, 10);
        }
      }

      // --- Draw Mouth ---
      ctx.fillStyle = theme.mouth;
      ctx.strokeStyle = theme.mouth;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';

      switch (activeEmotion) {
        case 'IDLE':
        case 'LISTENING':
        case 'SLEEPING':
          ctx.fillRect(cx - 18, mouthY, 36, 3);
          break;
        case 'HAPPY':
        case 'SHY':
        case 'LOVE':
          drawSmile(ctx, cx, mouthY);
          break;
        case 'SAD':
          drawFrown(ctx, cx, mouthY);
          break;
        case 'THINKING':
        case 'CONFUSED':
          drawSquiggle(ctx, cx, mouthY, f);
          break;
        case 'ALERT':
        case 'SURPRISED':
          drawOpenMouth(ctx, cx, mouthY, theme);
          break;
        case 'EXCITED':
          drawSmile(ctx, cx, mouthY);
          ctx.fillRect(cx - 15, mouthY - 2, 30, 3);
          break;
        case 'ANGRY':
          drawJaggedMouth(ctx, cx, mouthY);
          break;
        case 'BORED':
          drawOpenMouth(ctx, cx, mouthY + 5, theme);
          break;
        default:
          ctx.fillRect(cx - 18, mouthY, 36, 3);
      }

      // --- Floating details ---
      switch (activeEmotion) {
        case 'THINKING':
          drawThinkingDots(ctx, cx, mouthY + 30, f, theme);
          break;
        case 'LISTENING':
          drawListeningRings(ctx, cx, mouthY + 20, f, theme);
          break;
        case 'SLEEPING':
          drawFloatingZ(ctx, cx, eyeY, f, theme);
          break;
        case 'LOVE':
          drawFloatingHearts(ctx, cx, eyeY, f, theme);
          break;
        case 'ALERT':
          if (f % 6 < 3) {
            ctx.strokeStyle = theme.eye;
            ctx.lineWidth = 3;
            ctx.strokeRect(4, 4, W - 8, H - 8);
          }
          break;
        default:
          break;
      }

      ctx.restore();

      // Display overlay speech text bubble
      if (displayMessage) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, H - 40, W, 40);
        ctx.fillStyle = '#CCC';
        ctx.font = "13px 'Inter', sans-serif";
        ctx.textAlign = 'center';
        let msg = displayMessage;
        if (msg.length > 30) msg = msg.slice(0, 28) + '...';
        ctx.fillText(msg, cx, H - 16);
      }

      frameCountRef.current++;
      animId = requestAnimationFrame(renderFace);
    };

    renderFace();

    return () => cancelAnimationFrame(animId);
  }, [emotion, displayMessage]);

  return (
    <section id="panel-emotion" className="panel depth-bg">
      <div className="panel-header">
        <h2>Emotion Display</h2>
        <span id="emotion-label" className="emotion-tag">{emotion}</span>
      </div>
      <div id="emotion-screen">
        <canvas id="emotion-canvas" ref={canvasRef} width="256" height="320" />
      </div>
      
      {/* Selector Grid */}
      <div id="emotion-grid" className="depth-interactive">
        {Object.keys(EMOTION_THEMES).map((emo) => {
          let emoIcon = '😐';
          switch (emo) {
            case 'HAPPY': emoIcon = '😊'; break;
            case 'SAD': emoIcon = '😢'; break;
            case 'THINKING': emoIcon = '🤔'; break;
            case 'ALERT': emoIcon = '⚠️'; break;
            case 'LISTENING': emoIcon = '🎤'; break;
            case 'SLEEPING': emoIcon = '😴'; break;
            case 'EXCITED': emoIcon = '🤩'; break;
            case 'CONFUSED': emoIcon = '😕'; break;
            case 'ANGRY': emoIcon = '😡'; break;
            case 'SHY': emoIcon = '🙈'; break;
            case 'LOVE': emoIcon = '❤️'; break;
            case 'SURPRISED': emoIcon = '😲'; break;
            case 'BORED': emoIcon = '😒'; break;
            default: emoIcon = '😐'; break;
          }
          return (
            <button
              key={emo}
              className={`emo-btn ${emotion === emo ? 'active' : ''}`}
              onClick={() => setEmotion(emo)}
            >
              {emoIcon} {emo.charAt(0) + emo.slice(1).toLowerCase()}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default EmotionDisplay;
