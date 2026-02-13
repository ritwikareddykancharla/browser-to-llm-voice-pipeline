import { useState, useCallback } from 'react';
import VoiceChat from './components/VoiceChat';
import ConnectionStatus from './components/ConnectionStatus';
import { useWebRTC } from './hooks/useWebRTC';

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:8080';

function App() {
  const {
    status,
    sessionId,
    error,
    connect,
    disconnect,
    localStream,
    remoteStream,
  } = useWebRTC(SIGNALING_URL);

  const [isMuted, setIsMuted] = useState(false);

  const handleConnect = useCallback(() => {
    connect();
  }, [connect]);

  const handleDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  const handleToggleMute = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted((prev) => !prev);
    }
  }, [localStream]);

  return (
    <div className="app">
      <h1>LLM Voice Pipeline</h1>
      <ConnectionStatus status={status} error={error} sessionId={sessionId} />
      <VoiceChat
        status={status}
        isMuted={isMuted}
        localStream={localStream}
        remoteStream={remoteStream}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onToggleMute={handleToggleMute}
      />
    </div>
  );
}

export default App;
