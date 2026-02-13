import React, { useEffect, useRef } from 'react';
import AudioVisualizer from './AudioVisualizer';

interface VoiceChatProps {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  isMuted: boolean;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
}

const VoiceChat: React.FC<VoiceChatProps> = ({
  status,
  isMuted,
  localStream,
  remoteStream,
  onConnect,
  onDisconnect,
  onToggleMute,
}) => {
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  return (
    <div className="voice-chat">
      <div className="visualizers">
        <AudioVisualizer
          stream={localStream}
          isPlaying={!isMuted && isConnected}
          label="Your Voice"
        />
        <AudioVisualizer
          stream={remoteStream}
          isPlaying={isConnected}
          label="AI Response"
        />
      </div>

      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="controls">
        {!isConnected ? (
          <button
            className="btn btn-primary"
            onClick={onConnect}
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Start Conversation'}
          </button>
        ) : (
          <>
            <button
              className={`btn ${isMuted ? 'btn-muted' : 'btn-active'}`}
              onClick={onToggleMute}
            >
              {isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button className="btn btn-danger" onClick={onDisconnect}>
              End Call
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default VoiceChat;
