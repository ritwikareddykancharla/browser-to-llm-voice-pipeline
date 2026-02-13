package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/ritwikareddykancharla/browser-to-llm-voice-pipeline/audio-service/internal/audio"
	"github.com/ritwikareddykancharla/browser-to-llm-voice-pipeline/audio-service/internal/llm"
)

func main() {
	signalingURL := getEnv("SIGNALING_URL", "ws://localhost:8080")
	openAIKey := getEnv("OPENAI_API_KEY", "")
	port := getEnv("AUDIO_SERVICE_PORT", "8081")

	if openAIKey == "" {
		log.Println("Warning: OPENAI_API_KEY not set, using mock LLM client")
	}

	llmClient := llm.NewClient(openAIKey)
	audioProcessor := audio.NewProcessor(llmClient)

	go func() {
		if err := audioProcessor.ConnectToSignaling(signalingURL); err != nil {
			log.Fatalf("Failed to connect to signaling server: %v", err)
		}
	}()

	go func() {
		if err := audioProcessor.StartHealthServer(port); err != nil {
			log.Fatalf("Health server error: %v", err)
		}
	}()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("Shutting down audio service...")
	audioProcessor.Close()
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
