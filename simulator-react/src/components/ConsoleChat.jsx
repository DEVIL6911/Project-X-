import React, { useEffect, useRef, useState } from 'react';

function ConsoleChat({
  chatLog,
  setChatLog,
  isRecording,
  setIsRecording,
  onSendText,
  onSendAudio,
  pushAction,
  clearActions,
  addChatEntry
}) {
  const [textInput, setTextInput] = useState('');
  const [micStatus, setMicStatus] = useState('Click mic or type below');
  const chatLogEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Auto scroll to bottom
  useEffect(() => {
    if (chatLogEndRef.current) {
      chatLogEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatLog]);

  const handleSend = () => {
    const text = textInput.trim();
    if (text) {
      onSendText(text);
      setTextInput('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  // Mic recording logic
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true }
      });

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        onSendAudio(blob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setMicStatus('Recording... click to stop');
    } catch (e) {
      addChatEntry('error', `Microphone error: ${e.message}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setMicStatus('Processing...');
      setTimeout(() => {
        setMicStatus('Click mic or type below');
      }, 3000);
    }
  };

  const handleMicClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleClearLog = () => {
    setChatLog([
      {
        time: new Date().toTimeString().slice(0, 5),
        type: 'system',
        message: 'Chat log cleared.'
      }
    ]);
  };

  return (
    <section id="panel-chat" className="panel depth-bg">
      <div className="panel-header">
        <h2>Interaction Console</h2>
        <button id="btn-clear-chat" className="btn-ghost depth-interactive" onClick={handleClearLog}>
          Clear Log
        </button>
      </div>

      {/* Chat Logs */}
      <div id="chat-log">
        {chatLog.map((entry, idx) => (
          <div key={idx} className={`chat-entry ${entry.type}`}>
            <span className="chat-time">{entry.time}</span>
            <span className="chat-msg">{entry.message}</span>
          </div>
        ))}
        <div ref={chatLogEndRef} />
      </div>

      {/* Input controls */}
      <div id="chat-input-area" className="depth-interactive">
        <div id="mic-controls">
          <button 
            id="btn-mic" 
            className={`btn-mic ${isRecording ? 'recording' : ''}`} 
            onClick={handleMicClick}
            title={isRecording ? 'Click to stop recording' : 'Hold to record audio'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          <span id="mic-status">{micStatus}</span>
        </div>
        <div id="text-input-row">
          <input
            type="text"
            id="text-input"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message to JARVIS..."
            spellCheck="false"
          />
          <button id="btn-send" className="btn-primary" onClick={handleSend}>
            Send
          </button>
        </div>
      </div>

      {/* Motor Controls */}
      <div id="motor-controls" className="depth-interactive">
        <h3>Manual Motor Control</h3>
        <div className="dpad">
          <button 
            id="btn-forward" 
            className="dpad-btn dpad-up" 
            onClick={() => pushAction({ type: 'FORWARD', duration_ms: 500, speed: 150 })}
            title="Forward"
          >
            ▲
          </button>
          <button 
            id="btn-left" 
            className="dpad-btn dpad-left" 
            onClick={() => pushAction({ type: 'TURN_LEFT', duration_ms: 400, speed: 150 })}
            title="Turn Left"
          >
            ◄
          </button>
          <button 
            id="btn-stop" 
            className="dpad-btn dpad-center" 
            onClick={clearActions}
            title="Stop"
          >
            ■
          </button>
          <button 
            id="btn-right" 
            className="dpad-btn dpad-right" 
            onClick={() => pushAction({ type: 'TURN_RIGHT', duration_ms: 400, speed: 150 })}
            title="Turn Right"
          >
            ►
          </button>
          <button 
            id="btn-backward" 
            className="dpad-btn dpad-down" 
            onClick={() => pushAction({ type: 'BACKWARD', duration_ms: 500, speed: 150 })}
            title="Backward"
          >
            ▼
          </button>
        </div>
      </div>
    </section>
  );
}

export default ConsoleChat;
