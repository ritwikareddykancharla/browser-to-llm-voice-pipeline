# System Design: Browser-to-LLM Voice Pipeline

## Executive Summary

The Browser-to-LLM Voice Pipeline is a real-time, full-duplex audio streaming system that enables natural voice conversations with Large Language Models (LLMs). Unlike traditional HTTP-based voice interfaces that suffer from seconds of latency, this system achieves millisecond-level response times through WebRTC-based streaming architecture.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Component Deep Dive](#component-deep-dive)
3. [Data Flow](#data-flow)
4. [Communication Protocols](#communication-protocols)
5. [State Management](#state-management)
6. [Scalability Considerations](#scalability-considerations)
7. [Security Considerations](#security-considerations)
8. [Performance Optimization](#performance-optimization)
9. [Error Handling](#error-handling)
10. [Deployment Architecture](#deployment-architecture)

---

## Architecture Overview

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         BROWSER-TO-LLM VOICE PIPELINE                           │
└─────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐         ┌──────────────────────┐
│                  │         │                  │         │                      │
│    BROWSER       │         │  SIGNALING       │         │   AUDIO SERVICE      │
│    (React)       │         │  SERVER          │         │   (Go)               │
│                  │         │  (Node.js)       │         │                      │
│  ┌────────────┐  │         │                  │         │  ┌────────────────┐  │
│  │ WebRTC     │  │  WebRTC │  ┌────────────┐  │  WebSocket │ │ Audio Ingest  │  │
│  │ Peer       │◄─┼─────────┼─►│ SDP/ICE    │◄─┼──────────┼─►│ (Opus/PCM)    │  │
│  │ Connection │  │         │  │ Handler    │  │         │  └───────┬────────┘  │
│  └─────┬──────┘  │         │  └────────────┘  │         │          │           │
│        │         │         │                  │         │  ┌───────▼────────┐  │
│  ┌─────▼──────┐  │         │  ┌────────────┐  │         │  │ VAD Engine    │  │
│  │ Audio      │  │         │  │ Session    │  │         │  │ (Energy-based)│  │
│  │ Capture    │  │         │  │ Manager    │  │         │  └───────┬────────┘  │
│  │ (Mic)      │  │         │  └────────────┘  │         │          │           │
│  └────────────┘  │         │                  │         │  ┌───────▼────────┐  │
│                  │         │  ┌────────────┐  │         │  │ LLM Client    │  │
│  ┌────────────┐  │         │  │ Room       │  │         │  │ (OpenAI API)  │  │
│  │ Audio      │  │         │  │ Manager    │  │         │  └───────┬────────┘  │
│  │ Playback   │  │         │  └────────────┘  │         │          │           │
│  │ (Speaker)  │  │         │                  │         │  ┌───────▼────────┐  │
│  └────────────┘  │         └──────────────────┘         │  │ TTS Engine    │  │
│                  │                                        │  │ (OpenAI TTS)  │  │
│  ┌────────────┐  │                                        │  └───────────────┘  │
│  │ UI State   │  │                                        │                      │
│  │ Management │  │                                        └──────────────────────┘
│  └────────────┘  │
│                  │
└──────────────────┘

                           ┌──────────────────────┐
                           │      LLM API         │
                           │  (OpenAI / Local)    │
                           │                      │
                           │  • GPT-4o            │
                           │  • Whisper (STT)     │
                           │  • TTS-1             │
                           └──────────────────────┘
```

### Design Principles

1. **Low Latency**: All audio flows through WebRTC data channels with minimal processing overhead
2. **Separation of Concerns**: Each service has a single, well-defined responsibility
3. **Horizontal Scalability**: Stateless services can be scaled independently
4. **Graceful Degradation**: System continues to function with degraded features if components fail

---

## Component Deep Dive

### 1. Frontend (React + TypeScript)

The frontend is a single-page application built with React 18 and TypeScript, responsible for:

#### 1.1 Audio Capture Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                     AUDIO CAPTURE PIPELINE                      │
└─────────────────────────────────────────────────────────────────┘

Microphone → MediaStream → AudioContext → AnalyserNode → ScriptProcessor
                                                              │
                                                              ▼
                                                    Float32Array (PCM)
                                                              │
                    ┌─────────────────────────────────────────┤
                    │                                         │
                    ▼                                         ▼
            Volume Analysis                            WebRTC Track
            (RMS Calculation)                          (Opus Encoding)
```

**Key Components:**

- **`useAudioCapture` Hook**: Manages microphone access and audio stream lifecycle
- **`useVAD` Hook**: Implements client-side Voice Activity Detection
- **`useWebRTC` Hook**: Handles WebRTC peer connection and signaling

#### 1.2 WebRTC Connection Management

```typescript
// Connection State Machine
type ConnectionState = 
  | 'disconnected'  // Initial state, no connection
  | 'connecting'    // WebSocket connected, negotiating WebRTC
  | 'connected'     // WebRTC peer connection established
  | 'error';        // Connection failed

// State Transitions
disconnected → connecting → connected
                   ↓              ↓
                 error ← error ← error
```

#### 1.3 Audio Visualization

The `AudioVisualizer` component uses Canvas API to render real-time frequency bars:

```
AudioStream → AnalyserNode → FrequencyData → Canvas Rendering
                    │
                    └── fftSize: 256
                        smoothingTimeConstant: 0.8
```

---

### 2. Signaling Server (Node.js + WebSocket)

The signaling server is a lightweight WebSocket server that facilitates WebRTC connection establishment.

#### 2.1 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      SIGNALING SERVER                            │
└─────────────────────────────────────────────────────────────────┘

                         ┌──────────────┐
                         │   HTTP       │
                         │   Server     │
                         └──────┬───────┘
                                │
                    ┌───────────▼───────────┐
                    │   WebSocket Server    │
                    │   (ws library)        │
                    └───────────┬───────────┘
                                │
            ┌───────────────────┼───────────────────┐
            │                   │                   │
    ┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
    │ Session       │   │ Room          │   │ Message       │
    │ Manager       │   │ Manager       │   │ Handler       │
    └───────────────┘   └───────────────┘   └───────────────┘
```

#### 2.2 Session Management

```typescript
interface Session {
  id: string;              // Unique session identifier (UUID v4)
  socket: WebSocket;       // WebSocket connection reference
  createdAt: Date;         // Session creation timestamp
  lastActivity: Date;      // Last activity timestamp (for timeout)
  metadata?: Record<string, unknown>;  // Optional metadata
  partnerId?: string;      // Paired session ID for P2P communication
}
```

**Session Lifecycle:**

```
1. Client connects → Create session with UUID
2. Heartbeat (ping/pong) → Update lastActivity
3. Session timeout → Close connection, cleanup
4. Client disconnects → Remove session, notify partner
```

#### 2.3 Room Management

Rooms enable pairing users for P2P communication:

```typescript
interface Room {
  id: string;                    // Room identifier
  participants: Set<string>;     // Session IDs of participants
  createdAt: Date;               // Room creation timestamp
}
```

**Room Matching Algorithm:**

```
1. New session requests to join
2. Check for existing rooms with 1 participant (waiting)
3. If found → Join existing room (now has 2 participants)
4. If not found → Create new room
5. When room has 2 participants → Pair them for WebRTC negotiation
```

#### 2.4 Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `join` | Client → Server | Register session, get assigned to room |
| `offer` | Bidirectional | WebRTC SDP offer |
| `answer` | Bidirectional | WebRTC SDP answer |
| `ice-candidate` | Bidirectional | ICE candidate exchange |
| `leave` | Bidirectional | Session termination |
| `error` | Server → Client | Error notification |

---

### 3. Audio Service (Go)

The audio service is the core processing engine, handling audio ingestion, speech detection, and LLM integration.

#### 3.1 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AUDIO SERVICE                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Signaling     │     │   WebRTC        │     │   Audio         │
│   Client        │────►│   Peer          │────►│   Processor     │
│   (WebSocket)   │     │   Connection    │     │                 │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                        ┌────────────────────────────────┤
                        │                                │
                ┌───────▼───────┐                ┌───────▼───────┐
                │   Opus        │                │   VAD         │
                │   Codec       │                │   Detector    │
                └───────┬───────┘                └───────┬───────┘
                        │                                │
                        └────────────────┬───────────────┘
                                         │
                                ┌────────▼────────┐
                                │   LLM Client    │
                                │   (OpenAI API)  │
                                └────────┬────────┘
                                         │
                                ┌────────▼────────┐
                                │   TTS Engine    │
                                │   (OpenAI TTS)  │
                                └─────────────────┘
```

#### 3.2 Audio Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUDIO PROCESSING PIPELINE                     │
└─────────────────────────────────────────────────────────────────┘

Incoming RTP Packets
        │
        ▼
┌───────────────┐
│ Opus Decode   │  48kHz, mono, 20ms frames (960 samples)
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ VAD Analysis  │  Energy-based speech detection
└───────┬───────┘
        │
        ├─── Silence ───► Discard (or buffer for context)
        │
        ▼ (Speech detected)
┌───────────────┐
│ Buffer        │  Accumulate audio until speech end
│ Accumulation  │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ LLM Request   │  Speech → Text → LLM → Text → TTS
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ Opus Encode   │  Convert PCM back to Opus
└───────┬───────┘
        │
        ▼
Outgoing RTP Packets
```

#### 3.3 Voice Activity Detection (VAD)

The VAD engine uses energy-based detection with hysteresis:

```go
type Detector struct {
    threshold      float64       // Energy threshold (default: 0.5)
    silencePeriod  time.Duration // Silence duration to end speech (default: 500ms)
    speechPeriod   time.Duration // Speech duration to start speech (default: 100ms)
    energyHistory  []float64     // Rolling average for smoothing
}
```

**Algorithm:**

```
1. Calculate RMS energy of audio frame
2. Add to rolling average (10 frames)
3. If smoothed_energy > threshold:
   - Start speech timer
   - If speech timer > speech_period → mark as speaking
4. If smoothed_energy <= threshold:
   - Start silence timer
   - If silence timer > silence_period → mark as not speaking
```

#### 3.4 LLM Integration

```
┌─────────────────────────────────────────────────────────────────┐
│                      LLM INTEGRATION FLOW                        │
└─────────────────────────────────────────────────────────────────┘

Audio Buffer
      │
      ▼
┌─────────────┐     POST /audio/transcriptions
│ Whisper API │────────────────────────────────►
│ (STT)       │◄───────────────────────────────
└─────┬───────┘     {"text": "Hello, how are you?"}
      │
      ▼
┌─────────────┐     POST /chat/completions
│ GPT-4o API  │────────────────────────────────►
│             │◄───────────────────────────────
└─────┬───────┘     {"choices": [{"message": {...}}]}
      │
      ▼
┌─────────────┐     POST /audio/speech
│ TTS-1 API   │────────────────────────────────►
│             │◄───────────────────────────────
└─────┬───────┘     Binary audio (MP3/Opus)
      │
      ▼
Audio Response
```

---

## Data Flow

### 1. Connection Establishment

```
Browser                    Signaling Server              Audio Service
   │                              │                            │
   │──── WebSocket Connect ──────►│                            │
   │                              │                            │
   │◄─── Session ID (join) ───────│                            │
   │                              │                            │
   │──── SDP Offer ──────────────►│                            │
   │                              │──── Forward Offer ────────►│
   │                              │                            │
   │                              │◄─── SDP Answer ────────────│
   │◄─── SDP Answer ──────────────│                            │
   │                              │                            │
   │──── ICE Candidate ──────────►│──── Forward ICE ──────────►│
   │◄─── ICE Candidate ───────────│◄─── ICE Candidate ─────────│
   │                              │                            │
   │════════════ WebRTC Connection Established ════════════════│
   │                              │                            │
```

### 2. Audio Streaming

```
Browser                    Audio Service                   LLM API
   │                            │                              │
   │──── Audio (Opus) ─────────►│                              │
   │                            │                              │
   │                            │──── Transcribe ─────────────►│
   │                            │◄─── Text ────────────────────│
   │                            │                              │
   │                            │──── Generate Response ──────►│
   │                            │◄─── Text ────────────────────│
   │                            │                              │
   │                            │──── Synthesize ─────────────►│
   │                            │◄─── Audio ───────────────────│
   │                            │                              │
   │◄─── Audio (Opus) ──────────│                              │
   │                            │                              │
```

### 3. Interruption Handling

```
Browser                    Audio Service                   LLM API
   │                            │                              │
   │  [AI speaking...]          │  [streaming TTS...]          │
   │◄─── Audio chunk ───────────│                              │
   │                            │                              │
   │  [User interrupts]         │                              │
   │──── VAD: Speech Start ────►│                              │
   │                            │──── Cancel Stream ──────────►│
   │                            │                              │
   │◄─── Stop Audio ────────────│                              │
   │                            │                              │
   │  [Process new speech...]   │                              │
```

---

## Communication Protocols

### WebSocket Signaling Protocol

All signaling messages are JSON-encoded:

```json
// Join session
{
  "type": "join",
  "sessionId": "optional-existing-id",
  "metadata": {}
}

// SDP Offer
{
  "type": "offer",
  "sdp": "v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1...",
  "sessionId": "abc-123"
}

// SDP Answer
{
  "type": "answer",
  "sdp": "v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1...",
  "sessionId": "abc-123"
}

// ICE Candidate
{
  "type": "ice-candidate",
  "candidate": {
    "candidate": "candidate:842163049 1 udp...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  },
  "sessionId": "abc-123"
}

// Leave session
{
  "type": "leave",
  "sessionId": "abc-123"
}

// Error
{
  "type": "error",
  "code": "PARSE_ERROR",
  "message": "Invalid JSON message"
}
```

### WebRTC Configuration

```javascript
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // TURN servers for NAT traversal (production)
    // { urls: 'turn:turn.example.com:3478', username: '...', credential: '...' }
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'balanced'
};
```

### Audio Format

| Parameter | Value |
|-----------|-------|
| Codec | Opus |
| Sample Rate | 48000 Hz |
| Channels | 1 (Mono) |
| Frame Size | 20ms (960 samples) |
| Bitrate | Variable (6-510 kbps) |

---

## State Management

### Browser State

```typescript
interface AppState {
  connection: {
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
    sessionId: string | null;
    error: string | null;
  };
  audio: {
    isCapturing: boolean;
    isMuted: boolean;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
  };
  vad: {
    isSpeaking: boolean;
    volume: number;
  };
}
```

### Signaling Server State

```typescript
interface ServerState {
  sessions: Map<string, Session>;  // Session ID → Session
  rooms: Map<string, Room>;        // Room ID → Room
  sessionToRoom: Map<string, string>;  // Session ID → Room ID
}
```

### Audio Service State

```go
type ServiceState struct {
    mu              sync.Mutex
    running         bool
    peerConnection  *webrtc.PeerConnection
    wsConnection    *websocket.Conn
    lastAudioData   time.Time
}
```

---

## Scalability Considerations

### Horizontal Scaling

```
                    ┌─────────────────┐
                    │   Load Balancer │
                    │   (nginx/HAProxy)│
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
    ┌───────▼───────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │ Signaling     │ │ Signaling   │ │ Signaling   │
    │ Instance 1    │ │ Instance 2  │ │ Instance N  │
    └───────┬───────┘ └──────┬──────┘ └──────┬──────┘
            │                │                │
            └────────────────┼────────────────┘
                             │
                    ┌────────▼────────┐
                    │   Redis (for    │
                    │   session sync) │
                    └─────────────────┘
```

### Scaling Strategies

1. **Signaling Server**: Stateless with Redis for session sync
2. **Audio Service**: One instance per WebRTC connection (stateful)
3. **Frontend**: CDN + static hosting

### Connection Limits

| Component | Default Limit | Configurable Via |
|-----------|---------------|------------------|
| Signaling Server | 1000 connections | `MAX_CONNECTIONS` |
| Audio Service | Limited by CPU/memory | Horizontal scaling |
| WebRTC | Browser dependent | N/A |

---

## Security Considerations

### Transport Security

- **WebSocket**: WSS (TLS) required in production
- **WebRTC**: DTLS-SRTP encryption by default
- **API Keys**: Environment variables, never committed

### Authentication

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION FLOW                           │
└─────────────────────────────────────────────────────────────────┘

Browser                    Signaling Server              Auth Service
   │                              │                            │
   │──── Connect + JWT ──────────►│                            │
   │                              │──── Verify Token ─────────►│
   │                              │◄─── User Info ─────────────│
   │                              │                            │
   │◄─── Session Created ─────────│                            │
   │                              │                            │
```

### Input Validation

1. **Signaling Messages**: JSON schema validation
2. **SDP/ICE**: Sanitization before processing
3. **Audio Data**: Size limits, format validation

---

## Performance Optimization

### Latency Optimization

| Component | Optimization | Impact |
|-----------|-------------|--------|
| WebRTC | Direct P2P after signaling | -50-100ms |
| Audio | 20ms frame size | -10-20ms |
| VAD | Energy-based (lightweight) | -5-10ms |
| LLM | Streaming responses | -100-500ms |

### Memory Management

```go
// Audio buffer pooling
var audioBufferPool = sync.Pool{
    New: func() interface{} {
        return make([]byte, 4800)
    },
}

// Reuse buffers
buffer := audioBufferPool.Get().([]byte)
defer audioBufferPool.Put(buffer)
```

### Network Optimization

- **Jitter Buffer**: WebRTC handles automatically
- **Packet Loss**: Opus FEC (Forward Error Correction)
- **Bandwidth**: Adaptive bitrate via WebRTC

---

## Error Handling

### Error Categories

| Category | Code | Handling |
|----------|------|----------|
| Parse Error | `PARSE_ERROR` | Close connection |
| Invalid Message | `INVALID_MESSAGE` | Send error, continue |
| Session Not Found | `SESSION_NOT_FOUND` | Send error, continue |
| Server Capacity | `SERVER_FULL` | Close with 1013 |
| ICE Failure | `ICE_FAILED` | Trigger ICE restart |

### Reconnection Strategy

```typescript
const reconnectConfig = {
  maxAttempts: 5,
  baseDelay: 1000,  // 1 second
  maxDelay: 30000,  // 30 seconds
  backoffMultiplier: 2
};

// Exponential backoff
delay = min(maxDelay, baseDelay * Math.pow(backoffMultiplier, attempt));
```

---

## Deployment Architecture

### Production Deployment

```
┌─────────────────────────────────────────────────────────────────┐
│                        AWS / GCP / Azure                         │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Route53 /  │     │   CloudFlare │     │   CDN        │
│   Cloud DNS  │     │   (DDoS)     │     │   (Static)   │
└──────┬───────┘     └──────────────┘     └──────────────┘
       │
       ▼
┌──────────────┐
│   ALB /      │
│   Load       │
│   Balancer   │
└──────┬───────┘
       │
       ├─────────────────────────────────┐
       │                                 │
       ▼                                 ▼
┌──────────────┐                  ┌──────────────┐
│   ECS /      │                  │   ECS /      │
│   Kubernetes │                  │   Kubernetes │
│   (Signaling)│                  │   (Audio)    │
└──────┬───────┘                  └──────┬───────┘
       │                                 │
       ▼                                 ▼
┌──────────────┐                  ┌──────────────┐
│   ElastiCache│                  │   OpenAI API │
│   (Redis)    │                  │   (External) │
└──────────────┘                  └──────────────┘
```

### Docker Compose (Development)

```yaml
services:
  frontend:
    build: ./frontend
    ports: ["3000:80"]
    depends_on: [signaling]
    
  signaling:
    build: ./signaling-server
    ports: ["8080:8080"]
    
  audio-service:
    build: ./audio-service
    ports: ["8081:8081"]
    depends_on: [signaling]
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
```

---

## Monitoring & Observability

### Metrics to Track

| Metric | Component | Alert Threshold |
|--------|-----------|-----------------|
| Active Connections | Signaling | > 80% capacity |
| Connection Duration | Signaling | < 5s (failed) |
| Audio Latency | Audio Service | > 500ms |
| LLM Response Time | Audio Service | > 3s |
| Error Rate | All | > 1% |

### Logging Strategy

```
[INFO]  {"timestamp": "2024-01-15T10:30:00Z", "service": "signaling", "event": "session_created", "sessionId": "abc-123"}
[DEBUG] {"timestamp": "2024-01-15T10:30:01Z", "service": "audio", "event": "audio_frame", "size": 4800, "energy": 0.15}
[ERROR] {"timestamp": "2024-01-15T10:30:02Z", "service": "audio", "event": "llm_error", "error": "rate limit exceeded"}
```

---

## Future Enhancements

1. **Multi-party Support**: Extend room manager for > 2 participants
2. **Local LLM Integration**: Support for Ollama/llama.cpp
3. **Custom VAD Models**: Silero VAD for better accuracy
4. **TURN Server**: Self-hosted for NAT traversal
5. **Recording**: Optional call recording functionality
6. **Real-time Transcription**: Live captions during conversation

---

## References

- [WebRTC API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [OpenAI Realtime API](https://platform.openai.com/docs/api-reference/realtime)
- [Pion WebRTC (Go)](https://github.com/pion/webrtc)
- [RFC 8866 - SDP](https://datatracker.ietf.org/doc/html/rfc8866)
- [RFC 8854 - WebRTC Forward Error Correction](https://datatracker.ietf.org/doc/html/rfc8854)
