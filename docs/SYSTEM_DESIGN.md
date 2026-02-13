# System Design: Browser-to-LLM Voice Pipeline

## Executive Summary

The Browser-to-LLM Voice Pipeline is a real-time, full-duplex audio streaming system that enables natural voice conversations with Large Language Models (LLMs). Unlike traditional HTTP-based voice interfaces that suffer from seconds of latency, this system achieves millisecond-level response times through WebRTC-based streaming architecture.

**Why This System Exists**

Traditional voice interfaces follow a request-response pattern that feels unnatural to users. When you speak to a typical voice assistant, the system must record your complete utterance, upload it to a server, transcribe it, process it with an LLM, generate a response, synthesize speech, and finally play it back. Each step adds latency, resulting in 3-5 second delays between your last word and the AI's first response. This kills the conversational flow that makes human-to-human dialogue feel natural.

This system solves that problem by establishing a persistent, bidirectional audio stream. Audio flows continuously from browser to server and back, with the LLM processing happening in real-time. The result is a conversation that feels surprisingly human - you can interrupt the AI, and it can respond almost immediately when you pause.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Decisions](#technology-decisions)
3. [Component Deep Dive](#component-deep-dive)
4. [Data Flow](#data-flow)
5. [Communication Protocols](#communication-protocols)
6. [State Management](#state-management)
7. [Scalability Considerations](#scalability-considerations)
8. [Security Considerations](#security-considerations)
9. [Performance Optimization](#performance-optimization)
10. [Error Handling](#error-handling)
11. [Deployment Architecture](#deployment-architecture)

---

## Architecture Overview

### Why Three Separate Services?

The system is divided into three distinct services: Frontend, Signaling Server, and Audio Service. This separation wasn't arbitrary - each service has fundamentally different resource requirements and scaling characteristics.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         BROWSER-TO-LLM VOICE PIPELINE                           │
└─────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐         ┌──────────────────────┐
│                  │         │                  │         │                      │
│    BROWSER       │         │  SIGNALING       │         │   AUDIO SERVICE      │
│    (React)       │         │  SERVER          │         │   (Go)               │
│                  │         │  (Node.js)       │         │                      │
└──────────────────┘         └──────────────────┘         └──────────────────────┘
```

The Frontend is purely static content - HTML, CSS, and JavaScript that runs in users' browsers. It costs almost nothing to serve at scale via CDN, and can handle millions of users with minimal infrastructure. Putting this in the same process as the signaling server would waste resources and complicate deployments.

The Signaling Server handles ephemeral connection setup. It only needs to store state during the few seconds it takes to establish a WebRTC connection, after which the actual audio flows directly between browser and audio service. Because it's stateless between connections, it can scale horizontally with ease - just add more instances behind a load balancer.

The Audio Service is where the real work happens. It must maintain persistent WebRTC connections, decode audio, run voice activity detection, communicate with the LLM, and encode responses. This is CPU-intensive, stateful work that doesn't scale as simply. By isolating it in its own service, we can scale it independently based on actual connection count rather than total user count.

**The Alternative We Rejected**

We considered a monolithic architecture where the signaling server and audio service were combined. This would have simplified deployment but created a scaling problem: a server handling both signaling and audio would need to be scaled based on peak audio connections, wasting resources on signaling capacity. The monolith would also be harder to debug when audio processing issues don't affect signaling and vice versa.

### Why WebRTC Instead of WebSockets for Audio?

You might wonder why we use WebRTC for audio transport when WebSockets are simpler and more familiar. The answer lies in latency and audio quality.

WebRTC was designed specifically for real-time media. It includes several optimizations that matter critically for voice:

**Built-in Audio Processing**: WebRTC automatically handles echo cancellation, noise suppression, and automatic gain control. These are essential for voice quality but would require significant additional code with raw WebSockets. The browser's WebRTC implementation runs these algorithms in optimized native code, far more efficient than JavaScript could achieve.

**Opus Codec**: WebRTC mandates Opus support, which is the best codec available for voice. Opus dynamically adjusts its bitrate based on network conditions, gracefully degrading quality rather than dropping audio. It also includes Forward Error Correction (FEC) to recover from packet loss without retransmission - critical because retransmitting audio packets is pointless; by the time the retransmitted packet arrives, it's too late to play it.

**UDP Transport**: WebRTC uses UDP under the hood, meaning audio packets are sent immediately without waiting for acknowledgments. WebSocket runs over TCP, which will pause transmission when packets are lost, waiting for retransmission. For file transfers, this reliability is essential. For real-time audio, it creates unacceptable latency spikes.

**Adaptive Jitter Buffer**: WebRTC implementations include sophisticated jitter buffers that smooth out network timing variations. This means if packets arrive slightly out of order or with varying delays, the audio plays smoothly rather than stuttering.

### The Signaling Pattern

WebRTC requires a signaling mechanism to exchange connection setup information (SDP offers/answers and ICE candidates), but intentionally leaves the signaling protocol unspecified. This flexibility lets us choose the best approach for our use case.

We use WebSockets for signaling because:

1. **Low Latency**: Signaling must be fast. A slow signaling channel delays connection establishment, degrading user experience. WebSockets provide a persistent, low-latency connection ideal for this.

2. **Bidirectional**: The server needs to push messages to clients (like forwarding an SDP answer), not just respond to requests. HTTP polling would be inefficient and introduce latency.

3. **JSON-Friendly**: Our signaling messages are JSON objects, which WebSockets handle natively.

4. **Simple Protocol**: We don't need the complexity of custom protocols. JSON messages over WebSocket are easy to debug and implement.

---

## Technology Decisions

### Why React for the Frontend?

React wasn't chosen arbitrarily - several factors made it the right choice for this project.

**Component Architecture**: A voice interface naturally decomposes into components - connection status, audio visualizers, mute buttons, error messages. React's component model maps cleanly to these UI elements, each managing its own state and rendering independently.

**Hooks for State Management**: React hooks were introduced to solve exactly the kind of state management problems we face. The `useWebRTC` hook encapsulates all the complexity of managing a peer connection - the state machine, the WebSocket connection, the ICE candidate queueing - behind a simple interface. Components using this hook don't need to understand WebRTC details; they just call `connect()` and receive `status`, `localStream`, and `remoteStream`.

**Ecosystem**: The React ecosystem includes mature libraries for every need. We use Vite for fast development builds, TypeScript for type safety, and standard patterns for audio handling. We don't need to invent anything.

**Alternative Considered: Vanilla JavaScript**

We considered a vanilla JavaScript implementation to reduce bundle size. However, the complexity of managing WebRTC connections, audio streams, and UI state without a framework would lead to spaghetti code. The performance benefit of eliminating React (roughly 40KB gzipped) is negligible compared to the maintenance cost.

### Why Node.js for the Signaling Server?

The signaling server's requirements favored Node.js heavily.

**WebSocket Support**: The `ws` library is mature, performant, and simple. In benchmarks, it handles tens of thousands of concurrent connections with minimal overhead. Alternatives in other languages would require more code or less mature libraries.

**JSON Native**: JavaScript's native JSON handling means no serialization overhead or schema definitions. Messages arrive as objects, ready to use.

**Event-Driven Architecture**: Node.js's event loop model is ideal for a signaling server that's idle most of the time, only processing messages sporadically. A thread-per-connection model (like in Java) would waste memory on idle threads.

**Developer Experience**: Hot reloading with `tsx watch`, easy debugging, and the ability to share TypeScript types between frontend and signaling server reduce development friction.

**Alternative Considered: Go**

Go would provide better raw performance, but signaling isn't CPU-bound - it's I/O-bound. Node.js handles I/O-bound workloads excellently. The performance difference would be negligible in practice, while Go would add complexity with type definitions for signaling messages and more verbose WebSocket handling.

### Why Go for the Audio Service?

The audio service has fundamentally different requirements than the signaling server, which led us to choose Go.

**Performance-Critical**: Audio processing happens on every packet, potentially thousands of times per second. Go's compiled nature and efficient garbage collection provide consistent low-latency performance that Node.js's single-threaded event loop couldn't guarantee under load.

**Pion WebRTC**: The Pion WebRTC library is a pure Go implementation that's production-ready and actively maintained. It provides low-level control over WebRTC connections that's harder to achieve in Node.js libraries, which often abstract away details we need to access.

**Concurrency Model**: Go's goroutines are perfect for audio processing. Each connection spawns goroutines for reading audio, processing it, and writing responses. These lightweight threads can number in the thousands without the overhead of OS threads. The `sync` package provides straightforward primitives for protecting shared state.

**Memory Efficiency**: Go programs have a smaller memory footprint than Node.js equivalents. For a service that needs to handle many concurrent audio streams, this translates directly to cost savings in production.

**Alternative Considered: Rust**

Rust would provide even better performance and memory safety, but the learning curve is steeper and development velocity would be slower. For this project, Go provides the right balance of performance and developer productivity. Rust would be worth considering for a team with Rust expertise or for pushing performance to the absolute limit.

### Why OpenAI's API for LLM/TTS?

Using OpenAI's APIs was a pragmatic choice that let us focus on the audio pipeline rather than model deployment.

**Quality**: GPT-4o and Whisper represent state-of-the-art performance. Building equivalent quality with open-source models would require significant ML expertise and GPU infrastructure.

**Simplicity**: The API abstracts away model serving, scaling, and maintenance. We don't need to manage GPU clusters or optimize inference latency.

**Integration**: OpenAI provides both STT (Whisper) and TTS in addition to the LLM, reducing integration complexity. We don't need to stitch together multiple providers.

**Alternative Considered: Local Models**

Running local models (Ollama, llama.cpp, Whisper.cpp) would eliminate API costs and latency from network round-trips. This is planned for future enhancement, but for initial development, the API approach let us iterate faster. The architecture is designed to abstract the LLM client, making it straightforward to swap in local models later.

---

## Component Deep Dive

### 1. Frontend (React + TypeScript)

The frontend might seem simple, but it handles considerable complexity. Let's examine each piece and why it's designed this way.

#### 1.1 Audio Capture Pipeline

Capturing audio in a browser seems straightforward - call `getUserMedia()` and you have a stream. But for a production voice interface, we need to handle several concerns:

```
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

**Why AudioContext?** We need access to raw audio samples for visualization and voice activity detection. The `AudioContext` API gives us this through `AnalyserNode` and `ScriptProcessor`. Without it, the MediaStream would go directly to WebRTC for encoding and transmission, but we'd have no visibility into the audio.

**Why ScriptProcessor?** This deprecated API is still used because its replacement, `AudioWorklet`, requires more setup. For our use case (processing audio every 4096 samples), ScriptProcessor is sufficient. The audio processing is lightweight enough that it doesn't cause the main thread jank that motivated AudioWorklet's creation.

**Echo Cancellation Considerations**: We rely on the browser's built-in echo cancellation, configured in `getUserMedia()` constraints. This works well for most cases but can fail in echo-heavy environments. Server-side echo cancellation would add significant complexity and latency.

#### 1.2 Voice Activity Detection (VAD)

Client-side VAD serves a different purpose than server-side VAD. On the client, it's primarily for UI feedback - showing the user when their voice is being detected, enabling visualizations that respond to speech. On the server, VAD determines when to send audio to the LLM.

**Why Energy-Based VAD?** We chose a simple energy-based algorithm over ML-based approaches like Silero VAD for several reasons:

1. **No Model Loading**: ML-based VADs require loading a model (often 1-2MB), which adds startup time. Energy-based VAD has zero startup cost.

2. **Predictable Performance**: ML models can have variable inference times. Energy calculation is O(n) with a tiny constant factor.

3. **Good Enough**: For UI feedback, we don't need perfect accuracy. Occasional false positives/negatives don't significantly impact user experience.

4. **Hysteresis for Stability**: The key to usable energy-based VAD is hysteresis - different thresholds for entering and leaving speech state. Without this, noise near the threshold causes rapid state changes that look glitchy. Our implementation requires sustained energy above threshold for 100ms to enter speech, and silence for 500ms to leave speech.

```typescript
// The hysteresis approach prevents flickering
if (smoothedEnergy > threshold) {
  silenceStartRef.current = undefined;
  if (!speechStartRef.current) {
    speechStartRef.current = now;
  }
  if (!isSpeakingRef.current && now - speechStartRef.current >= speechDuration) {
    isSpeakingRef.current = true;
    setState((prev) => ({ ...prev, isSpeaking: true }));
    onSpeechStart?.();
  }
}
```

#### 1.3 WebRTC Connection Management

The WebRTC connection lifecycle is inherently complex. Our `useWebRTC` hook encapsulates this complexity, exposing only what components need:

```typescript
const {
  status,           // Connection state for UI
  sessionId,        // Unique ID for debugging
  error,            // Error message if something failed
  localStream,      // Audio from microphone
  remoteStream,     // Audio from AI
  connect,          // Start connection
  disconnect,       // End connection
} = useWebRTC(signalingUrl);
```

**Why This Interface?** Components shouldn't need to understand ICE candidates, SDP negotiation, or connection state machines. They care about: are we connected? What audio streams are available? Can we show an error? The hook provides exactly that.

**Connection State Machine**: WebRTC connections go through well-defined states, but mapping them to UI states requires simplification. We reduce the many WebRTC states to four UI-relevant states:

```typescript
type ConnectionState = 
  | 'disconnected'  // Initial state, show "Connect" button
  | 'connecting'    // Show loading indicator
  | 'connected'     // Show audio controls
  | 'error';        // Show error message
```

**ICE Candidate Grooming**: ICE candidates can arrive before the remote description is set, which would cause errors. The hook queues candidates and applies them after the remote description is ready:

```typescript
// Candidates queue until remote description is set
const iceCandidateQueue: RTCIceCandidateInit[] = [];

pc.onicecandidate = (event) => {
  if (event.candidate && sessionId) {
    wsRef.current?.send(JSON.stringify({
      type: 'ice-candidate',
      candidate: event.candidate.toJSON(),
      sessionId,
    }));
  }
};
```

#### 1.4 Audio Visualization

The audio visualizer might seem like a cosmetic feature, but it serves an important purpose: users need visual feedback that their audio is being captured and transmitted. Without it, they might speak louder, check their microphone settings, or assume the system isn't working.

**Why Canvas Instead of SVG?** We use Canvas for the frequency bar visualization because it needs to redraw 60 times per second. SVG would require DOM manipulation for each frame, which is slower and causes layout thrashing. Canvas lets us render directly to pixels.

**FFT Size Trade-off**: We use an FFT size of 256, which provides 128 frequency bins. Larger FFT sizes would give more frequency resolution but require more computation. For a visualizer showing general audio activity, 128 bins is plenty.

### 2. Signaling Server (Node.js + WebSocket)

The signaling server is deliberately simple. Its job is to connect peers and get out of the way.

#### 2.1 Session Management Philosophy

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

**Why In-Memory Sessions?** We store session state in memory rather than a database. This might seem limiting, but it's intentional. Session state only exists while the WebSocket connection is active. When the connection closes, the session is over - there's nothing to persist.

This design has implications: if the signaling server restarts, all active connections must reconnect. But WebRTC connections are resilient - the browser will automatically attempt reconnection. The signaling server coming back up takes seconds, after which connections are re-established. For a voice interface, this brief interruption is acceptable.

**Session Timeout Mechanism**: We implement heartbeat-based timeouts to detect zombie connections (where the TCP connection appears open but the client has actually disconnected):

```typescript
cleanupInactiveSessions(): void {
  const now = new Date();
  const timeout = this.config.connectionTimeout;
  
  for (const [id, session] of this.sessions) {
    const elapsed = now.getTime() - session.lastActivity.getTime();
    if (elapsed > timeout) {
      logger.warn({ sessionId: id, elapsed }, 'Session timed out');
      try {
        session.socket.close(1001, 'Connection timeout');
      } catch {
        // Socket may already be closed
      }
      this.sessions.delete(id);
    }
  }
}
```

#### 2.2 Room-Based Pairing

The room system pairs browser clients with the audio service. This abstraction supports future expansion to multi-party calls.

**Why Rooms Instead of Direct Pairing?** Direct pairing would require the browser to know the audio service's address, creating tight coupling. Rooms provide a level of indirection: browsers join rooms, and audio services join rooms. The signaling server handles matching.

**Current Matching Algorithm**: For this voice pipeline, we use a simple algorithm: browsers create rooms, audio services join waiting rooms:

```typescript
getOrCreateRoomForSession(sessionId: string): Room {
  // Check if session is already in a room
  const existingRoomId = this.sessionToRoom.get(sessionId);
  if (existingRoomId) {
    const existingRoom = this.rooms.get(existingRoomId);
    if (existingRoom) return existingRoom;
  }

  // Find a room with one participant (waiting)
  const waitingRoom = this.findWaitingRoom();
  if (waitingRoom) {
    this.joinRoom(waitingRoom.id, sessionId);
    return waitingRoom;
  }

  // Create new room
  const newRoom = this.createRoom();
  this.joinRoom(newRoom.id, sessionId);
  return newRoom;
}
```

This algorithm naturally pairs browsers with audio services as they connect.

#### 2.3 Message Forwarding Pattern

The signaling server doesn't understand WebRTC - it just forwards messages between paired sessions:

```typescript
private handleOffer(message: SDPMessage): void {
  const session = this.sessionManager.getSession(message.sessionId);
  if (!session) return;

  // Find partner in same room
  const roomId = this.roomManager.getSessionRoom(message.sessionId);
  if (!roomId) return;

  const participants = this.roomManager.getRoomParticipants(roomId);
  for (const participantId of participants) {
    if (participantId !== message.sessionId) {
      const partner = this.sessionManager.getSession(participantId);
      if (partner) {
        // Forward the offer to partner
        this.send(partner.socket, message);
      }
    }
  }
}
```

**Why This Simplicity Matters**: By not parsing SDP or understanding ICE, the signaling server has less code to break, fewer security vulnerabilities to worry about, and can scale more easily. It's a pure message broker.

### 3. Audio Service (Go)

The audio service is where the real-time conversation happens. Every design decision here prioritizes latency and reliability.

#### 3.1 WebRTC as Server

Unlike typical WebRTC usage where browsers connect peer-to-peer, our audio service acts as a WebRTC endpoint. This is sometimes called an "SFU-lite" pattern.

**Why Not Full SFU?** A Selective Forwarding Unit (SFU) would route audio between multiple participants. We only have two participants (browser and AI), so a full SFU is overkill. Our audio service is simpler: it receives audio, processes it, and sends back audio.

**The Peer Connection Lifecycle**:

```go
func (p *Processor) ConnectToSignaling(signalingURL string) error {
    // 1. Connect to signaling server
    conn, _, err := websocket.DefaultDialer.Dial(signalingURL, nil)
    
    // 2. Create WebRTC peer connection
    peerConnection, err := webrtc.NewPeerConnection(webrtc.Configuration{...})
    
    // 3. Create audio track for sending
    audioTrack, err := webrtc.NewTrackLocalStaticRTP(...)
    peerConnection.AddTrack(audioTrack)
    
    // 4. Handle incoming tracks
    peerConnection.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
        go p.handleIncomingTrack(track)
    })
    
    // 5. Exchange SDP
    offer, _ := peerConnection.CreateOffer(nil)
    peerConnection.SetLocalDescription(offer)
    p.sendSignalingMessage(map[string]interface{}{
        "type": "offer",
        "sdp":  offer.SDP,
    })
}
```

**Why We Create the Offer**: In typical WebRTC, the caller creates the offer. Here, the audio service acts as the "caller" because it knows its capabilities first. The browser's peer connection needs to know what codecs and parameters the audio service supports before it can start sending audio.

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

**Why 20ms Frames?** Opus typically uses 20ms frames (960 samples at 48kHz). This is a sweet spot: shorter frames add overhead (more headers relative to payload), longer frames add latency. At 20ms, we get 50 packets per second - enough granularity for responsive VAD without excessive overhead.

**Why Buffer Accumulation?** Sending every audio frame to the LLM would be inefficient and expensive. Instead, we accumulate audio while speech is detected, then send the complete utterance to Whisper for transcription. This also provides context - partial utterances are harder to transcribe accurately.

#### 3.3 Voice Activity Detection

The server-side VAD has different requirements than client-side. We need high accuracy to avoid wasting LLM API calls on silence.

**Why Energy-Based Over ML?** On the server, we could use ML-based VAD like Silero for better accuracy. We chose to keep energy-based VAD for now because:

1. **Latency**: ML VAD adds ~10ms per frame. Energy calculation is sub-millisecond.
2. **Dependency Management**: Adding a PyTorch or ONNX runtime complicates the Go build.
3. **Good Enough for Now**: Energy-based VAD works well in quiet environments. We can upgrade later.

**Rolling Average for Robustness**:

```go
func (d *Detector) addToHistory(energy float64) {
    d.energyHistory = append(d.energyHistory, energy)
    if len(d.energyHistory) > d.historySize {
        d.energyHistory = d.energyHistory[1:]
    }
}

func (d *Detector) smoothedEnergy() float64 {
    if len(d.energyHistory) == 0 {
        return 0
    }
    var sum float64
    for _, e := range d.energyHistory {
        sum += e
    }
    return sum / float64(len(d.energyHistory))
}
```

A rolling average over 10 frames smooths out momentary energy spikes that would otherwise trigger false speech detection.

#### 3.4 LLM Integration Flow

```
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

**Why Separate API Calls Instead of Realtime API?** OpenAI's Realtime API handles speech-to-speech in a single WebSocket connection. While compelling, it has limitations:

1. **Less Control**: The Realtime API manages VAD internally. We'd lose control over when speech is considered complete.
2. **Cost**: Realtime API pricing is higher than separate Whisper + GPT-4o + TTS calls.
3. **Flexibility**: Separate calls let us insert custom logic between steps (e.g., conversation history, content filtering).

We're monitoring the Realtime API's evolution and may switch when it provides more control.

**Streaming Responses**: The TTS API supports streaming output, meaning we can start playing audio before the complete response is generated. This cuts perceived latency significantly:

```go
// Streaming TTS would look like:
resp, _ := http.Post(url, "application/json", body)
reader := bufio.NewReader(resp.Body)
for {
    chunk, err := reader.ReadBytes('\n')
    if err != nil {
        break
    }
    // Send chunk to audio track immediately
    audioTrack.Write(chunk)
}
```

---

## Data Flow

### Connection Establishment Sequence

Understanding the connection sequence helps debug issues when they arise.

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

**Why Two Offer/Answer Exchanges?** You might notice the browser sends an offer first, then receives an offer from the audio service. This is because we need bidirectional audio:

1. Browser's offer establishes its capability to send audio
2. Audio service's answer acknowledges and describes its receiving capability
3. Audio service's offer establishes its capability to send audio back
4. Browser's answer acknowledges and describes its receiving capability

In a simpler setup, only one peer would offer. But we need both to be able to send, requiring this "renegotiation" pattern.

**ICE Candidate Trickle**: We use "trickle ICE" where candidates are sent as they're discovered, rather than waiting for all candidates. This speeds up connection establishment:

```typescript
// Browser side
pc.onicecandidate = (event) => {
  if (event.candidate) {
    ws.send(JSON.stringify({
      type: 'ice-candidate',
      candidate: event.candidate.toJSON(),
      sessionId,
    }));
  }
};
```

Without trickle ICE, the browser would wait until all ICE gathering completes (which can take several seconds for TURN candidates) before sending any candidates.

### Interruption Handling

Natural conversation involves interruptions. When a user speaks while the AI is responding, we should stop the AI and process the new speech.

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

**How We Detect Interruptions**: The audio service's VAD continuously monitors incoming audio. If speech is detected while streaming TTS output, the service:

1. Stops sending audio to the browser
2. Cancels the ongoing LLM/TTS request
3. Buffers the new speech for processing

This creates the natural feel of a real conversation where you can interrupt without waiting for the AI to finish.

---

## Communication Protocols

### WebSocket Signaling Protocol

All signaling messages are JSON for simplicity. In high-performance scenarios, a binary protocol might be more efficient, but JSON's debugging advantages outweigh the bandwidth cost for signaling traffic.

```json
{
  "type": "offer",
  "sdp": "v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1...",
  "sessionId": "abc-123"
}
```

**Why Include Session ID in Every Message?** The signaling server needs to know which session sent a message to route it correctly. Including session ID in each message (rather than tracking by WebSocket connection) supports future scenarios where sessions might persist across reconnections.

### WebRTC Configuration

```javascript
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'balanced'
};
```

**Why Google's STUN Servers?** STUN servers help peers discover their public IP address. Google provides free STUN servers that are reliable and well-connected. In production, you'd want your own STUN servers for reliability and to avoid depending on Google.

**When You Need TURN**: If both peers are behind symmetric NAT, direct P2P connection fails. TURN servers relay traffic in these cases. TURN servers are expensive to run (they relay all media), so they're typically only used when direct connection fails. We don't include TURN servers in the default config, but they're essential for production reliability.

### Audio Format

| Parameter | Value | Reasoning |
|-----------|-------|-----------|
| Codec | Opus | Best quality/bitrate for voice, mandatory in WebRTC |
| Sample Rate | 48000 Hz | Opus native rate, avoids resampling |
| Channels | 1 (Mono) | Voice needs no stereo, halves bandwidth |
| Frame Size | 20ms | Balance of latency and efficiency |
| Bitrate | Variable | Opus adapts to network conditions |

**Why Opus?** Opus is remarkable - it scales from low bitrate VoIP (6 kbps) to high-quality music (510 kbps) while maintaining excellent voice quality. It includes built-in FEC for packet loss recovery and can seamlessly switch between modes based on content.

---

## State Management

### Browser State

React's state model fits our needs well. The `useWebRTC` hook manages connection state, while the component manages UI state:

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

**Why Not Use a State Library?** For this application, React's built-in state management is sufficient. The state tree is shallow, updates are predictable, and we don't need time-travel debugging or complex async actions. Adding Redux or Zustand would be over-engineering.

### Signaling Server State

The signaling server maintains ephemeral state in memory:

```typescript
interface ServerState {
  sessions: Map<string, Session>;  // Session ID → Session
  rooms: Map<string, Room>;        // Room ID → Room
  sessionToRoom: Map<string, string>;  // Session ID → Room ID
}
```

**Why Maps Instead of Objects?** JavaScript Maps provide O(1) lookups and maintain insertion order. More importantly, they accept any key type (not just strings) and don't have prototype pollution risks. For storing sessions by ID, Maps are the right choice.

**Scaling This State**: For horizontal scaling, this in-memory state would need to move to Redis. The transition is straightforward - the SessionManager and RoomManager interfaces wouldn't change, just their implementation:

```typescript
// In-memory implementation
class SessionManager {
  private sessions = new Map<string, Session>();
  getSession(id: string) {
    return this.sessions.get(id);
  }
}

// Redis implementation (future)
class RedisSessionManager {
  private redis: RedisClient;
  async getSession(id: string) {
    const data = await this.redis.get(`session:${id}`);
    return data ? JSON.parse(data) : undefined;
  }
}
```

---

## Scalability Considerations

### Horizontal Scaling Architecture

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

**Why Signaling Scales Easily**: The signaling server is nearly stateless. Each WebSocket connection is independent. The only shared state is room assignments, which can move to Redis. Adding more instances behind a load balancer directly increases capacity.

**Why Audio Service Scales Differently**: The audio service maintains persistent WebRTC connections with active audio streams. Each connection uses CPU for encoding/decoding and memory for buffers. Scaling requires understanding capacity limits:

```go
// Each connection consumes resources
type Connection struct {
    peerConnection  *webrtc.PeerConnection  // ~1MB
    audioBuffer     []byte                   // ~10KB
    decoder         *OpusDecoder            // ~50KB
    encoder         *OpusEncoder            // ~50KB
}
// Total: ~1.1MB per connection
```

At 1.1MB per connection, a 4GB server handles ~3,600 concurrent connections (with headroom for LLM processing). This is a rough estimate; real capacity depends on audio activity and LLM response patterns.

**Scaling Strategy**: The audio service scales by adding instances and using a connection-aware load balancer. Unlike HTTP where any server can handle any request, WebRTC connections must stay on the same server. The load balancer needs to route new connections to the least-loaded audio service instance.

---

## Security Considerations

### Transport Security

All communication must be encrypted in production.

**WebSocket Security**: Use WSS (WebSocket Secure) which runs over TLS. This prevents man-in-the-middle attacks on the signaling channel:

```
ws://signaling.example.com  →  wss://signaling.example.com
```

**WebRTC Security**: WebRTC mandates encryption via DTLS-SRTP. Even if an attacker intercepts packets, they can't decode the audio. This is built into WebRTC - no configuration needed.

### Authentication

The current implementation doesn't include authentication, but production deployment would:

```
Browser                    Signaling Server              Auth Service
   │                              │                            │
   │──── Connect + JWT ──────────►│                            │
   │                              │──── Verify Token ─────────►│
   │                              │◄─── User Info ─────────────│
   │                              │                            │
   │◄─── Session Created ─────────│                            │
```

The JWT would be passed in the WebSocket URL or as the first message after connection.

### Input Validation

**Why Validate Everything**: Malformed input could crash the server or cause undefined behavior:

```typescript
// Always validate incoming messages
let message: SignalingMessage;
try {
  const str = data.toString();
  message = JSON.parse(str);
} catch {
  this.sendError(ws, 'PARSE_ERROR', 'Invalid JSON message');
  return;
}
```

**SDP Validation**: SDP could contain malicious patterns. At minimum, verify it's a valid SDP structure before passing to WebRTC. More thorough validation would check for:
- Reasonable media types (only audio)
- No data channels (unless intended)
- Reasonable codec parameters

---

## Performance Optimization

### Latency Budget

Every millisecond matters for natural conversation. Here's where time goes:

| Component | Typical Latency | Optimization |
|-----------|-----------------|--------------|
| Microphone to Browser | 5-10ms | Browser handles |
| WebRTC Encoding | 2-5ms | Native code |
| Network (Browser→Server) | 20-100ms | Depends on geography |
| Opus Decoding | 1-2ms | Native Go code |
| VAD | <1ms | Energy-based is fast |
| Whisper STT | 300-800ms | API latency |
| GPT-4o Generation | 500-2000ms | Streaming helps perceived |
| TTS Synthesis | 200-500ms | Streaming output |
| Opus Encoding | 1-2ms | Native Go code |
| Network (Server→Browser) | 20-100ms | Depends on geography |
| Audio Playback | 5-10ms | Browser handles |
| **Total** | **1-4 seconds** | Acceptable for AI conversation |

The LLM and TTS APIs dominate the latency budget. Network optimization and audio processing efficiency matter, but can't overcome fundamental API response times.

### Memory Management in Go

Go's garbage collector is excellent, but audio processing generates many short-lived objects. Using sync.Pool reduces allocation pressure:

```go
var audioBufferPool = sync.Pool{
    New: func() interface{} {
        return make([]byte, 4800)  // One frame
    },
}

func processAudio(incoming []byte) {
    buffer := audioBufferPool.Get().([]byte)
    defer audioBufferPool.Put(buffer)
    // Use buffer...
}
```

**Why This Matters**: Without pooling, allocating 4800 bytes 50 times per second (for 20ms frames) creates significant GC pressure. Pooling lets us reuse the same memory.

---

## Error Handling

### Error Categories and Responses

| Category | Code | Handling |
|----------|------|----------|
| Parse Error | `PARSE_ERROR` | Close connection - can't trust client |
| Invalid Message | `INVALID_MESSAGE` | Send error, continue - client might recover |
| Session Not Found | `SESSION_NOT_FOUND` | Send error, continue - might be stale client |
| Server Capacity | `SERVER_FULL` | Close with 1013 - signal to retry later |
| ICE Failure | `ICE_FAILED` | Trigger ICE restart - might be transient |

**Why Close on Parse Errors**: A client sending invalid JSON is either buggy or malicious. Continuing to process messages from an unreliable client wastes resources and could expose vulnerabilities.

### Reconnection Strategy

Network issues are inevitable. The browser should reconnect automatically:

```typescript
const reconnectConfig = {
  maxAttempts: 5,
  baseDelay: 1000,  // Start at 1 second
  maxDelay: 30000,  // Cap at 30 seconds
  backoffMultiplier: 2
};
```

**Why Exponential Backoff**: If the server is overloaded, all clients reconnecting simultaneously would make it worse. Exponential backoff spreads reconnection attempts over time, giving the server breathing room.

---

## Deployment Architecture

### Production Deployment

```
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

**Why CloudFlare?**: CloudFlare provides DDoS protection at the network layer. Voice interfaces are attractive targets for abuse (imagine flooding the LLM API), and CloudFlare absorbs volumetric attacks before they reach our infrastructure.

**Why Separate ECS Clusters?**: Signaling and audio services have different scaling characteristics. Putting them in the same cluster would mean scaling based on whichever runs out of capacity first, wasting resources. Separate clusters let us scale each appropriately.

### Health Checks

Each service exposes a health endpoint:

```go
// Audio service health check
http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
    // Could check: peer connection status, LLM API connectivity
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("OK"))
})
```

The load balancer pings this endpoint and removes unhealthy instances from rotation.

---

## Monitoring & Observability

### What to Monitor

| Metric | Why It Matters |
|--------|----------------|
| Active Connections | Capacity planning, anomaly detection |
| Connection Duration | Short durations might indicate problems |
| Audio Latency | Degradation indicates network issues |
| LLM Response Time | API problems affect user experience |
| Error Rate | Leading indicator of system health |

### Structured Logging

Structured logs enable powerful queries:

```
[INFO]  {"timestamp": "2024-01-15T10:30:00Z", "service": "signaling", "event": "session_created", "sessionId": "abc-123"}
```

With structured logging, you can query "all sessions created in the last hour where the user was in Europe" rather than grepping text logs.

---

## Future Enhancements

### What's Next

1. **Multi-party Support**: The room system already supports >2 participants. The audio service would need to become a proper SFU to mix or route multiple audio streams.

2. **Local LLM Integration**: Swapping OpenAI's API for Ollama or llama.cpp would eliminate API latency and costs. The LLM client interface is already abstracted, making this a straightforward swap.

3. **Silero VAD**: ML-based VAD would improve speech detection accuracy, especially in noisy environments. The current energy-based approach sometimes fails with background noise.

4. **TURN Server**: Self-hosted TURN would improve connection reliability for users behind restrictive NATs. The coturn project is a battle-tested option.

5. **Recording**: Optional call recording would enable use cases like meeting transcription. Privacy considerations require careful implementation.

6. **Real-time Transcription**: Streaming the Whisper output as it transcribes would show users what's being recognized, catching errors early.

---

## References

- [WebRTC API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [OpenAI Realtime API](https://platform.openai.com/docs/api-reference/realtime)
- [Pion WebRTC (Go)](https://github.com/pion/webrtc)
- [RFC 8866 - SDP](https://datatracker.ietf.org/doc/html/rfc8866)
- [RFC 8854 - WebRTC Forward Error Correction](https://datatracker.ietf.org/doc/html/rfc8854)
- [Opus Codec](https://opus-codec.org/)
