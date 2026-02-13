import { useState, useEffect, useCallback, useRef } from 'react';
import {
  SignalingMessage,
  createPeerConnection,
  createOffer,
  createAnswer,
  setRemoteDescription,
  addIceCandidate,
  defaultWebRTCConfig,
} from '../utils/webrtc';
import { getAudioStream, stopStream } from '../utils/audio';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useWebRTC(signalingUrl: string) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [sessionId, setSessionId] = useState<string>();
  const [error, setError] = useState<string>();
  const [localStream, setLocalStream] = useState<MediaStream>();
  const [remoteStream, setRemoteStream] = useState<MediaStream>();

  const wsRef = useRef<WebSocket>();
  const pcRef = useRef<RTCPeerConnection>();
  const localStreamRef = useRef<MediaStream>();

  const handleSignalingMessage = useCallback(async (message: SignalingMessage) => {
    const pc = pcRef.current;
    if (!pc) return;

    switch (message.type) {
      case 'join':
        if (message.sessionId) {
          setSessionId(message.sessionId);
        }
        break;

      case 'offer':
        if (message.sdp) {
          await setRemoteDescription(pc, { type: 'offer', sdp: message.sdp });
          const answer = await createAnswer(pc);
          wsRef.current?.send(JSON.stringify({
            type: 'answer',
            sdp: answer.sdp,
            sessionId: message.sessionId,
          }));
        }
        break;

      case 'answer':
        if (message.sdp) {
          await setRemoteDescription(pc, { type: 'answer', sdp: message.sdp });
        }
        break;

      case 'ice-candidate':
        if (message.candidate) {
          await addIceCandidate(pc, message.candidate);
        }
        break;

      case 'leave':
        setStatus('disconnected');
        break;

      case 'error':
        setError(message.message || 'Unknown error');
        setStatus('error');
        break;
    }
  }, []);

  const connect = useCallback(async () => {
    try {
      setStatus('connecting');
      setError(undefined);

      const audioStream = await getAudioStream();
      localStreamRef.current = audioStream;
      setLocalStream(audioStream);

      const pc = createPeerConnection(defaultWebRTCConfig);
      pcRef.current = pc;

      const remote = new MediaStream();
      setRemoteStream(remote);

      pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
          remote.addTrack(track);
        });
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && sessionId) {
          wsRef.current?.send(JSON.stringify({
            type: 'ice-candidate',
            candidate: event.candidate.toJSON(),
            sessionId,
          }));
        }
      };

      pc.onconnectionstatechange = () => {
        switch (pc.connectionState) {
          case 'connected':
            setStatus('connected');
            break;
          case 'disconnected':
          case 'failed':
          case 'closed':
            setStatus('disconnected');
            break;
        }
      };

      audioStream.getTracks().forEach((track) => {
        pc.addTrack(track, audioStream);
      });

      const ws = new WebSocket(signalingUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        ws.send(JSON.stringify({ type: 'join' }));

        const offer = await createOffer(pc);
        ws.send(JSON.stringify({
          type: 'offer',
          sdp: offer.sdp,
          sessionId,
        }));
      };

      ws.onmessage = (event) => {
        const message: SignalingMessage = JSON.parse(event.data);
        handleSignalingMessage(message);
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
        setStatus('error');
      };

      ws.onclose = () => {
        setStatus('disconnected');
      };

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStatus('error');
    }
  }, [signalingUrl, sessionId, handleSignalingMessage]);

  const disconnect = useCallback(() => {
    if (sessionId) {
      wsRef.current?.send(JSON.stringify({ type: 'leave', sessionId }));
    }

    wsRef.current?.close();
    pcRef.current?.close();

    stopStream(localStreamRef.current);

    wsRef.current = undefined;
    pcRef.current = undefined;
    localStreamRef.current = undefined;

    setLocalStream(undefined);
    setRemoteStream(undefined);
    setSessionId(undefined);
    setStatus('disconnected');
  }, [sessionId]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    sessionId,
    error,
    localStream,
    remoteStream,
    connect,
    disconnect,
  };
}
