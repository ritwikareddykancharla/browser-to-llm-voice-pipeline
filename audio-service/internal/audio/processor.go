package audio

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v3"
	"github.com/ritwikareddykancharla/browser-to-llm-voice-pipeline/audio-service/internal/llm"
	"github.com/ritwikareddykancharla/browser-to-llm-voice-pipeline/audio-service/internal/vad"
)

type Processor struct {
	peerConnection *webrtc.PeerConnection
	wsConn         *websocket.Conn
	llmClient      *llm.Client
	vadDetector    *vad.Detector
	codec          *OpusCodec

	audioTrack     *webrtc.TrackLocalStaticRTP
	incomingBuffer chan []byte

	mu       sync.Mutex
	running  bool
	lastData time.Time
}

func NewProcessor(llmClient *llm.Client) *Processor {
	return &Processor{
		llmClient:      llmClient,
		vadDetector:    vad.NewDetector(0.5, 500*time.Millisecond, 100*time.Millisecond),
		codec:          NewOpusCodec(),
		incomingBuffer: make(chan []byte, 1000),
	}
}

func (p *Processor) ConnectToSignaling(signalingURL string) error {
	conn, _, err := websocket.DefaultDialer.Dial(signalingURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to signaling server: %w", err)
	}
	p.wsConn = conn

	peerConnection, err := webrtc.NewPeerConnection(webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to create peer connection: %w", err)
	}
	p.peerConnection = peerConnection

	audioTrack, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus},
		"audio",
		"llm",
	)
	if err != nil {
		return fmt.Errorf("failed to create audio track: %w", err)
	}
	p.audioTrack = audioTrack

	_, err = peerConnection.AddTrack(audioTrack)
	if err != nil {
		return fmt.Errorf("failed to add track: %w", err)
	}

	peerConnection.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		log.Println("Received audio track from browser")
		go p.handleIncomingTrack(track)
	})

	peerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate != nil {
			p.sendSignalingMessage(map[string]interface{}{
				"type":      "ice-candidate",
				"candidate": candidate.ToJSON(),
			})
		}
	})

	peerConnection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("Peer connection state: %s", state)
		if state == webrtc.PeerConnectionStateConnected {
			p.running = true
			go p.processAudioLoop()
		} else if state == webrtc.PeerConnectionStateDisconnected ||
			state == webrtc.PeerConnectionStateFailed {
			p.running = false
		}
	})

	go p.handleSignalingMessages()

	offer, err := peerConnection.CreateOffer(nil)
	if err != nil {
		return fmt.Errorf("failed to create offer: %w", err)
	}

	if err := peerConnection.SetLocalDescription(offer); err != nil {
		return fmt.Errorf("failed to set local description: %w", err)
	}

	p.sendSignalingMessage(map[string]interface{}{
		"type": "offer",
		"sdp":  offer.SDP,
	})

	return nil
}

func (p *Processor) handleSignalingMessages() {
	for {
		_, message, err := p.wsConn.ReadMessage()
		if err != nil {
			log.Printf("Error reading signaling message: %v", err)
			return
		}

		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Error unmarshaling message: %v", err)
			continue
		}

		msgType, ok := msg["type"].(string)
		if !ok {
			continue
		}

		switch msgType {
		case "answer":
			sdp, _ := msg["sdp"].(string)
			if err := p.peerConnection.SetRemoteDescription(webrtc.SessionDescription{
				Type: webrtc.SDPTypeAnswer,
				SDP:  sdp,
			}); err != nil {
				log.Printf("Error setting remote description: %v", err)
			}

		case "ice-candidate":
			candidate, ok := msg["candidate"].(map[string]interface{})
			if ok {
				candidateJSON, _ := json.Marshal(candidate)
				var iceCandidate webrtc.ICECandidateInit
				if err := json.Unmarshal(candidateJSON, &iceCandidate); err == nil {
					if err := p.peerConnection.AddICECandidate(iceCandidate); err != nil {
						log.Printf("Error adding ICE candidate: %v", err)
					}
				}
			}

		case "join":
			log.Println("Joined signaling session")

		case "leave":
			log.Println("Peer left session")
			p.running = false
		}
	}
}

func (p *Processor) sendSignalingMessage(msg interface{}) {
	if p.wsConn == nil {
		return
	}
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Error marshaling message: %v", err)
		return
	}
	if err := p.wsConn.WriteMessage(websocket.TextMessage, data); err != nil {
		log.Printf("Error sending signaling message: %v", err)
	}
}

func (p *Processor) handleIncomingTrack(track *webrtc.TrackRemote) {
	for {
		rtp, _, err := track.ReadRTP()
		if err != nil {
			log.Printf("Error reading RTP: %v", err)
			return
		}

		p.lastData = time.Now()
		select {
		case p.incomingBuffer <- rtp.Payload:
		default:
		}
	}
}

func (p *Processor) processAudioLoop() {
	audioBuffer := make([]byte, 0, 48000)

	for p.running {
		select {
		case data := <-p.incomingBuffer:
			audioBuffer = append(audioBuffer, data...)

			if len(audioBuffer) >= 4800 {
				pcm, err := p.codec.Decode(audioBuffer[:4800])
				if err == nil {
					if p.vadDetector.IsSpeech(pcm) {
						go p.processSpeech(audioBuffer[:4800])
					}
				}
				audioBuffer = audioBuffer[4800:]
			}

		case <-time.After(100 * time.Millisecond):
			if len(audioBuffer) > 0 {
				audioBuffer = audioBuffer[:0]
			}
		}
	}
}

func (p *Processor) processSpeech(audioData []byte) {
	pcm, err := p.codec.Decode(audioData)
	if err != nil {
		log.Printf("Error decoding audio: %v", err)
		return
	}

	response, err := p.llmClient.ProcessAudio(pcm)
	if err != nil {
		log.Printf("Error processing with LLM: %v", err)
		return
	}

	if len(response) > 0 {
		opusData, err := p.codec.Encode(response)
		if err != nil {
			log.Printf("Error encoding response: %v", err)
			return
		}

		for _, chunk := range opusData {
			if _, err := p.audioTrack.Write(chunk); err != nil {
				log.Printf("Error writing to track: %v", err)
			}
		}
	}
}

func (p *Processor) StartHealthServer(port string) error {
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	return http.ListenAndServe(":"+port, nil)
}

func (p *Processor) Close() {
	p.running = false
	if p.peerConnection != nil {
		p.peerConnection.Close()
	}
	if p.wsConn != nil {
		p.wsConn.Close()
	}
}
