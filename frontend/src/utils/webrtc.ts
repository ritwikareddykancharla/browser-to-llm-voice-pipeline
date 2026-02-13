export interface SignalingMessage {
  type: 'join' | 'offer' | 'answer' | 'ice-candidate' | 'leave' | 'error';
  sessionId?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  code?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
}

export const defaultWebRTCConfig: WebRTCConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function createPeerConnection(
  config: WebRTCConfig = defaultWebRTCConfig
): RTCPeerConnection {
  return new RTCPeerConnection(config);
}

export async function createOffer(
  peerConnection: RTCPeerConnection
): Promise<RTCSessionDescriptionInit> {
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  return offer;
}

export async function createAnswer(
  peerConnection: RTCPeerConnection
): Promise<RTCSessionDescriptionInit> {
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  return answer;
}

export async function setRemoteDescription(
  peerConnection: RTCPeerConnection,
  sdp: RTCSessionDescriptionInit
): Promise<void> {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
}

export async function addIceCandidate(
  peerConnection: RTCPeerConnection,
  candidate: RTCIceCandidateInit
): Promise<void> {
  await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
}
