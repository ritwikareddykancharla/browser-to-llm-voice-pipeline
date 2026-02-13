# Browser-to-LLM Voice Pipeline

Real-time WebRTC interface for LLMs with duplex streaming capabilities.

## Overview

Traditional voice interfaces to AI rely on slow HTTP APIs:
```
Record -> Upload -> Process -> Download -> Play (seconds of latency)
```

This project implements a full-stack WebRTC pipeline for real-time duplex streaming:
```
Browser <--WebRTC--> Signaling Server <--WebSocket--> Audio Service <--Streaming--> LLM
         (milliseconds of latency)
```

## Features

- **Low Latency**: Streams audio directly from browser to inference server and back, cutting latency from seconds to milliseconds
- **Signaling**: Custom WebSocket signaling server handling SDP offer/answer exchanges and ICE candidates
- **VAD**: Voice Activity Detection for natural interruptions during AI speech
- **Duplex Streaming**: Full-duplex audio - speak and listen simultaneously

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    BROWSER-TO-LLM VOICE PIPELINE                                 │
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
│  │ Audio      │  │         │  │ Session    │  │         │  │ (Silero)      │  │
│  │ Capture    │  │         │  │ Manager    │  │         │  └───────┬────────┘  │
│  │ (Mic)      │  │         │  └────────────┘  │         │          │           │
│  └────────────┘  │         │                  │         │  ┌───────▼────────┐  │
│                  │         │  ┌────────────┐  │         │  │ LLM Client    │  │
│  ┌────────────┐  │         │  │ Room       │  │         │  │ (OpenAI/      │  │
│  │ Audio      │  │         │  │ Manager    │  │         │  │  Local)       │  │
│  │ Playback   │  │         │  └────────────┘  │         │  └───────┬────────┘  │
│  │ (Speaker)  │  │         │                  │         │          │           │
│  └────────────┘  │         └──────────────────┘         │  ┌───────▼────────┐  │
│                  │                                        │  │ TTS Engine    │  │
│  ┌────────────┐  │                                        │  │ (ElevenLabs/  │  │
│  │ UI State   │  │                                        │  │  Local)       │  │
│  │ Management │  │                                        │  └───────────────┘  │
│  └────────────┘  │                                        │                      │
│                  │                                        └──────────────────────┘
└──────────────────┘

                          ┌──────────────────────┐
                          │      LLM API         │
                          │  (OpenAI / Local)    │
                          │                      │
                          │  • GPT-4o Realtime   │
                          │  • Whisper (STT)     │
                          │  • TTS-1             │
                          └──────────────────────┘
```

## Data Flow

### 1. Connection Establishment

```
Browser                    Signaling Server              Audio Service
   │                              │                            │
   │──── WebSocket Connect ──────►│                            │
   │                              │──── Register Session ─────►│
   │                              │                            │
   │──── SDP Offer ──────────────►│                            │
   │                              │──── Forward Offer ────────►│
   │                              │◄─── SDP Answer ────────────│
   │◄─── SDP Answer ──────────────│                            │
   │                              │                            │
   │──── ICE Candidate ──────────►│──── Forward ICE ──────────►│
   │◄─── ICE Candidate ───────────│◄─── ICE Candidate ─────────│
   │                              │                            │
   │════ WebRTC Connection ═══════│════════════════════════════│
```

### 2. Audio Streaming

```
Browser                    Audio Service                   LLM API
   │                            │                              │
   │──── Audio (Opus) ─────────►│                              │
   │                            │──── Transcribe ─────────────►│
   │                            │◄─── Text ────────────────────│
   │                            │                              │
   │                            │──── Stream Text ────────────►│
   │                            │◄─── Audio Chunks ────────────│
   │◄─── Audio (Opus) ──────────│                              │
   │                            │                              │
   │  [User interrupts]         │                              │
   │──── VAD: Speech Start ────►│──── Cancel TTS ─────────────►│
   │                            │                              │
```

## Project Structure

```
browser-to-llm-voice-pipeline/
├── signaling-server/           # Node.js WebSocket signaling
│   ├── src/
│   │   ├── index.ts           # Entry point
│   │   ├── server.ts          # WebSocket server
│   │   └── types.ts           # TypeScript types
│   ├── services/
│   │   ├── sessionManager.ts  # Session state management
│   │   └── roomManager.ts     # Multi-room support
│   ├── utils/
│   │   └── logger.ts          # Logging utilities
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                   # React WebRTC client
│   ├── src/
│   │   ├── App.tsx            # Main application
│   │   ├── main.tsx           # Entry point
│   │   ├── components/
│   │   │   ├── VoiceChat.tsx  # Main voice interface
│   │   │   ├── AudioVisualizer.tsx
│   │   │   └── ConnectionStatus.tsx
│   │   ├── hooks/
│   │   │   ├── useWebRTC.ts   # WebRTC connection hook
│   │   │   ├── useAudioCapture.ts
│   │   │   └── useVAD.ts      # Client-side VAD
│   │   └── utils/
│   │       ├── audio.ts       # Audio utilities
│   │       └── webrtc.ts      # WebRTC helpers
│   ├── public/
│   │   └── index.html
│   ├── package.json
│   └── tsconfig.json
│
├── audio-service/              # Go audio processing
│   ├── cmd/
│   │   └── main.go            # Entry point
│   ├── internal/
│   │   ├── audio/
│   │   │   ├── processor.go   # Audio processing
│   │   │   └── codec.go       # Opus codec
│   │   ├── vad/
│   │   │   └── detector.go    # Voice activity detection
│   │   └── llm/
│   │       ├── client.go      # LLM API client
│   │       └── streaming.go   # Streaming response handler
│   ├── go.mod
│   └── go.sum
│
├── docker/
│   ├── Dockerfile.signaling
│   ├── Dockerfile.frontend
│   └── Dockerfile.audio
│
├── docker-compose.yml
├── .env.example
└── README.md
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 18, TypeScript, WebRTC API |
| Signaling | Node.js, ws, TypeScript |
| Audio Service | Go 1.21+, Pion WebRTC |
| VAD | Silero VAD (Go/JS ports) |
| LLM | OpenAI Realtime API / Local models |
| Containerization | Docker, Docker Compose |

## Quick Start

```bash
# Clone the repository
git clone git@github.com:ritwikareddykancharla/browser-to-llm-voice-pipeline.git
cd browser-to-llm-voice-pipeline

# Copy environment variables
cp .env.example .env

# Start all services
docker-compose up -d

# Access the application
# Frontend: http://localhost:3000
# Signaling: ws://localhost:8080
# Audio Service: http://localhost:8081
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for LLM/TTS | Required |
| `SIGNALING_PORT` | WebSocket signaling port | `8080` |
| `AUDIO_SERVICE_PORT` | Audio service port | `8081` |
| `FRONTEND_PORT` | Frontend dev server port | `3000` |
| `LOG_LEVEL` | Logging level | `info` |
| `VAD_THRESHOLD` | Voice activity threshold | `0.5` |
| `ICE_SERVERS` | STUN/TURN servers | Google STUN |

## API Endpoints

### Signaling Server (WebSocket)

```javascript
// Join session
{ type: "join", sessionId: "string" }

// SDP Offer/Answer
{ type: "offer" | "answer", sdp: "string", sessionId: "string" }
{ type: "answer", sdp: "string", sessionId: "string" }

// ICE Candidates
{ type: "ice-candidate", candidate: RTCIceCandidateInit, sessionId: "string" }

// Session management
{ type: "leave", sessionId: "string" }
```

### Audio Service (WebSocket)

```javascript
// Audio chunk (binary)
// Opus-encoded audio frame

// Control messages
{ type: "interrupt" }
{ type: "start" }
{ type: "stop" }
```

## Development

```bash
# Install frontend dependencies
cd frontend && npm install

# Install signaling server dependencies
cd signaling-server && npm install

# Install Go dependencies
cd audio-service && go mod download

# Run in development mode
npm run dev  # in each directory
```

## License

MIT License - see [LICENSE](LICENSE) for details.
