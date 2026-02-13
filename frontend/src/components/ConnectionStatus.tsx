import React from 'react';

interface ConnectionStatusProps {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
  sessionId?: string;
}

const statusColors = {
  disconnected: '#6b7280',
  connecting: '#f59e0b',
  connected: '#10b981',
  error: '#ef4444',
};

const statusLabels = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  connected: 'Connected',
  error: 'Error',
};

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  status,
  error,
  sessionId,
}) => {
  return (
    <div className="connection-status">
      <div className="status-indicator">
        <span
          className="status-dot"
          style={{ backgroundColor: statusColors[status] }}
        />
        <span className="status-label">{statusLabels[status]}</span>
      </div>
      {sessionId && (
        <div className="session-info">
          <span className="session-id">Session: {sessionId.slice(0, 8)}...</span>
        </div>
      )}
      {error && <div className="error-message">{error}</div>}
    </div>
  );
};

export default ConnectionStatus;
