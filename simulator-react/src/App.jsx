import React, { useState, useEffect, useRef, useCallback } from 'react';
import RoomSimulator from './components/RoomSimulator';
import EmotionDisplay from './components/EmotionDisplay';
import ConsoleChat from './components/ConsoleChat';
import StatusBar from './components/StatusBar';

function App() {
  // UI and Connection state
  const [connected, setConnected] = useState(false);
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:3000');
  const [llmProvider, setLlmProvider] = useState('--');
  const [whisperLoaded, setWhisperLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionQueueCount, setActionQueueCount] = useState(0);
  const [telemRate, setTelemRate] = useState('-- Hz');
  
  // 3D Depth Mode State
  const [mode3d, setMode3d] = useState(false);

  // Robot emotion and display text
  const [emotion, setEmotion] = useState('IDLE');
  const [displayMessage, setDisplayMessage] = useState('');

  // Chat log state
  const [chatLog, setChatLog] = useState([
    {
      time: getCurrentTime(),
      type: 'system',
      message: 'JARVIS Simulation Console ready. Connect to backend to begin.'
    }
  ]);

  // Microphone recording state
  const [isRecording, setIsRecording] = useState(false);

  // High-frequency physics states managed via refs to avoid React re-rendering overhead (60fps)
  const robotRef = useRef({
    x: 100,          // cm
    y: 80,           // cm
    angle: 0,        // degrees
    speed: 0,        // cm/s
    trail: []        // Array of {x, y}
  });

  const sensorsRef = useRef({
    frontDistanceCm: 200,
    leftIrBlocked: false,
    rightIrBlocked: false,
    servoAngle: 90,
    emergencyStop: false
  });

  const obstaclesRef = useRef([
    { x: 60, y: 30, w: 20, h: 20 },
    { x: 140, y: 100, w: 15, h: 30 }
  ]);

  const actionQueueRef = useRef([]);
  const currentActionRef = useRef(null);
  const actionStartTimeRef = useRef(0);

  // React state mirroring of sensors to update readouts on screen
  const [sensorReadouts, setSensorReadouts] = useState({
    frontDistanceCm: 200,
    leftIrBlocked: false,
    rightIrBlocked: false,
    servoAngle: 90,
    speed: 0,
    emergencyStop: false
  });

  function getCurrentTime() {
    const d = new Date();
    return d.toTimeString().slice(0, 5);
  }

  function addChatEntry(type, message) {
    setChatLog((prev) => [
      ...prev,
      {
        time: getCurrentTime(),
        type,
        message
      }
    ]);
  }

  // Action helpers — stable references via useCallback
  const pushAction = useCallback((action) => {
    actionQueueRef.current.push(action);
    setActionQueueCount(actionQueueRef.current.length + (currentActionRef.current ? 1 : 0));
  }, []);

  const clearActions = useCallback(() => {
    actionQueueRef.current.length = 0; // mutate in-place
    currentActionRef.current = null;
    robotRef.current.speed = 0;
    setActionQueueCount(0);
  }, []);

  const resetRobot = () => {
    robotRef.current = {
      x: 100,
      y: 80,
      angle: 0,
      speed: 0,
      trail: []
    };
    actionQueueRef.current = [];
    currentActionRef.current = null;
    sensorsRef.current.emergencyStop = false;
    setActionQueueCount(0);
    setEmotion('IDLE');
    setDisplayMessage('');
    addChatEntry('system', 'Robot position and simulation state reset.');
  };

  // Keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept when user is typing in inputs
      if (document.activeElement && (
        document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA'
      )) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'w':
          pushAction({ type: 'FORWARD', duration_ms: 200, speed: 150 });
          break;
        case 's':
          pushAction({ type: 'BACKWARD', duration_ms: 200, speed: 150 });
          break;
        case 'a':
          pushAction({ type: 'TURN_LEFT', duration_ms: 200, speed: 150 });
          break;
        case 'd':
          pushAction({ type: 'TURN_RIGHT', duration_ms: 200, speed: 150 });
          break;
        case ' ':
          clearActions();
          e.preventDefault();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pushAction, clearActions]);

  // Network Bridge Actions
  const handleConnect = async (url) => {
    const cleanedUrl = url.replace(/\/$/, '');
    setBackendUrl(cleanedUrl);
    
    try {
      addChatEntry('system', `Connecting to ${cleanedUrl}...`);
      const resp = await fetch(`${cleanedUrl}/api/health`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      setConnected(true);
      setLlmProvider(data.llm_provider || '--');
      setWhisperLoaded(!!data.whisper_loaded);
      addChatEntry('system', `✅ Connected to backend (LLM: ${data.llm_provider || 'Unknown'})`);
    } catch (e) {
      setConnected(false);
      addChatEntry('error', `❌ Connection failed: ${e.message}`);
    }
  };

  // Auto connect to FastAPI backend on mount
  useEffect(() => {
    handleConnect(backendUrl);
  }, []);

  const handleSendText = async (text) => {
    if (!connected) {
      addChatEntry('error', 'Not connected to backend');
      return;
    }
    addChatEntry('user', text);
    setEmotion('THINKING');

    try {
      const resp = await fetch(`${backendUrl}/api/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      if (data.response) {
        addChatEntry('thought', `💭 ${data.response.thought_process}`);
        addChatEntry('jarvis', data.response.speech_reply);
        setEmotion(data.response.emotion);
        setDisplayMessage(data.response.speech_reply);

        if (data.response.actions) {
          actionQueueRef.current.push(...data.response.actions);
          setActionQueueCount(actionQueueRef.current.length + (currentActionRef.current ? 1 : 0));
        }
      }
    } catch (e) {
      addChatEntry('error', `Failed: ${e.message}`);
      setEmotion('CONFUSED');
    }
  };

  const handleSendAudio = async (blob) => {
    if (!connected) {
      addChatEntry('error', 'Not connected to backend');
      return;
    }

    const formData = new FormData();
    formData.append('audio', blob, 'recording.wav');

    setEmotion('LISTENING');
    addChatEntry('system', '🎤 Sending audio to Whisper...');

    try {
      const resp = await fetch(`${backendUrl}/api/audio`, {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      if (data.status === 'silence') {
        addChatEntry('system', '🔇 No speech detected');
        setEmotion('IDLE');
      } else if (data.status === 'busy') {
        addChatEntry('system', '⏳ Backend is processing...');
      } else if (data.transcript) {
        addChatEntry('user', `🎤 "${data.transcript}"`);
        if (data.response) {
          addChatEntry('thought', `💭 ${data.response.thought_process}`);
          addChatEntry('jarvis', data.response.speech_reply);
          setEmotion(data.response.emotion);
          setDisplayMessage(data.response.speech_reply);
          
          if (data.response.actions) {
            actionQueueRef.current.push(...data.response.actions);
            setActionQueueCount(actionQueueRef.current.length + (currentActionRef.current ? 1 : 0));
          }
        }
      }
    } catch (e) {
      addChatEntry('error', `Audio failed: ${e.message}`);
      setEmotion('CONFUSED');
    }
  };

  // Background Telemetry and Command Polling Loops
  useEffect(() => {
    if (!connected) {
      setTelemRate('-- Hz');
      return;
    }

    let telemetryTimer = null;
    let commandTimer = null;

    const postTelemetry = async () => {
      try {
        await fetch(`${backendUrl}/api/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            front_distance_cm: sensorsRef.current.frontDistanceCm,
            left_ir_blocked: sensorsRef.current.leftIrBlocked,
            right_ir_blocked: sensorsRef.current.rightIrBlocked,
            servo_angle: sensorsRef.current.servoAngle,
          }),
        });
        setTelemRate('2 Hz'); // 500ms intervals = 2Hz
      } catch (e) {
        // Silent fail
      }
    };

    const getCommand = async () => {
      try {
        const resp = await fetch(`${backendUrl}/api/command`);
        if (!resp.ok) throw new Error();
        const cmd = await resp.json();

        // Update emotion
        if (cmd.emotion && cmd.emotion !== emotion) {
          setEmotion(cmd.emotion);
        }

        // Queue actions
        if (cmd.actions && cmd.actions.length > 0) {
          actionQueueRef.current.push(...cmd.actions);
          setActionQueueCount(actionQueueRef.current.length + (currentActionRef.current ? 1 : 0));
          addChatEntry('system', `⚙️ Received ${cmd.actions.length} action(s)`);

          // Clear commands
          fetch(`${backendUrl}/api/command/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }).catch(() => {});
        }

        // Speech Text
        if (cmd.speech_text) {
          setDisplayMessage(cmd.speech_text);
          addChatEntry('jarvis', cmd.speech_text);
        }

        // Processing status
        const statusResp = await fetch(`${backendUrl}/api/status`);
        if (statusResp.ok) {
          const statusData = await statusResp.json();
          setIsProcessing(statusData.is_processing);
        }
      } catch (e) {
        // Silent fail
      }
    };

    // Telemetry rate: 500ms
    telemetryTimer = setInterval(postTelemetry, 500);
    // Command polling: 500ms
    commandTimer = setInterval(getCommand, 500);

    return () => {
      clearInterval(telemetryTimer);
      clearInterval(commandTimer);
    };
  }, [connected, backendUrl, emotion]);

  return (
    <div className={`app-viewport ${mode3d ? 'mode-3d-active' : ''}`}>
      {/* ====== Top Bar ====== */}
      <header id="top-bar" className="depth-bg">
        <div className="top-bar-left">
          <div className="logo-mark">J</div>
          <h1>JARVIS <span className="text-accent">Simulation Console</span></h1>
        </div>
        <div className="top-bar-right">
          {/* 3D Depth Toggle */}
          <button 
            id="btn-toggle-3d" 
            className={`toggle-3d-btn depth-interactive ${mode3d ? 'active' : ''}`}
            onClick={() => setMode3d(!mode3d)}
            title="Toggle 3D perspective depth mode"
          >
            {mode3d ? '3D Active' : 'Enable 3D'}
          </button>
          
          <div id="connection-indicator" className={`indicator ${connected ? 'online' : 'offline'}`}>
            <span className="dot"></span>
            <span className="label">{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div id="backend-url-group">
            <input 
              type="text" 
              id="backend-url" 
              value={backendUrl} 
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="Backend URL" 
              spellcheck="false"
            />
            <button 
              id="btn-connect" 
              className="btn-primary depth-interactive"
              onClick={() => handleConnect(backendUrl)}
            >
              Connect
            </button>
          </div>
        </div>
      </header>

      {/* ====== Main Panel Layout ====== */}
      <main id="app-main">
        {/* Room Panel */}
        <RoomSimulator 
          robotRef={robotRef}
          sensorsRef={sensorsRef}
          obstaclesRef={obstaclesRef}
          actionQueueRef={actionQueueRef}
          currentActionRef={currentActionRef}
          actionStartTimeRef={actionStartTimeRef}
          sensorReadouts={sensorReadouts}
          setSensorReadouts={setSensorReadouts}
          setActionQueueCount={setActionQueueCount}
          addChatEntry={addChatEntry}
          setEmotion={setEmotion}
          mode3d={mode3d}
        />

        {/* Emotion Display Panel */}
        <EmotionDisplay 
          emotion={emotion}
          setEmotion={setEmotion}
          displayMessage={displayMessage}
        />

        {/* Chat / Control Panel */}
        <ConsoleChat 
          chatLog={chatLog}
          setChatLog={setChatLog}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
          onSendText={handleSendText}
          onSendAudio={handleSendAudio}
          pushAction={pushAction}
          clearActions={clearActions}
          addChatEntry={addChatEntry}
        />
      </main>

      {/* ====== Status Bar ====== */}
      <StatusBar 
        llmProvider={llmProvider}
        whisperLoaded={whisperLoaded}
        isProcessing={isProcessing}
        actionQueueCount={actionQueueCount}
        telemRate={telemRate}
      />
    </div>
  );
}

export default App;
