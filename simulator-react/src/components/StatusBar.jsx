import React from 'react';

function StatusBar({
  llmProvider,
  whisperLoaded,
  isProcessing,
  actionQueueCount,
  telemRate
}) {
  return (
    <footer id="status-bar" className="depth-bg">
      <div className="status-item">
        <span className="status-label">LLM</span>
        <span id="status-llm" className="status-value">{llmProvider}</span>
      </div>
      <div className="status-item">
        <span className="status-label">Whisper</span>
        <span id="status-whisper" className="status-value">{whisperLoaded ? 'Loaded' : 'Not loaded'}</span>
      </div>
      <div className="status-item">
        <span className="status-label">Processing</span>
        <span id="status-processing" className="status-value">{isProcessing ? 'Yes' : 'No'}</span>
      </div>
      <div className="status-item">
        <span className="status-label">Actions Queued</span>
        <span id="status-actions" className="status-value">{actionQueueCount}</span>
      </div>
      <div className="status-item">
        <span className="status-label">Telemetry Rate</span>
        <span id="status-telem-rate" className="status-value">{telemRate}</span>
      </div>
    </footer>
  );
}

export default StatusBar;
