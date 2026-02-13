package llm

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
)

type StreamingClient struct {
	*Client
	onToken     func(string)
	onComplete  func()
	onError     func(error)
	mu          sync.Mutex
	cancelChan  chan struct{}
}

func NewStreamingClient(apiKey string) *StreamingClient {
	return &StreamingClient{
		Client:     NewClient(apiKey),
		cancelChan: make(chan struct{}),
	}
}

type StreamChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index        int     `json:"index"`
		Delta        Message `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

func (s *StreamingClient) StreamChat(prompt string) error {
	s.mu.Lock()
	s.streaming = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.streaming = false
		s.mu.Unlock()
	}()

	url := s.baseURL + "/chat/completions"

	chatReq := ChatRequest{
		Model: "gpt-4o",
		Messages: []Message{
			{Role: "system", Content: "You are a helpful voice assistant. Keep responses concise and natural for speech."},
			{Role: "user", Content: prompt},
		},
		Temperature: 0.7,
		Stream:      true,
	}

	body, err := json.Marshal(chatReq)
	if err != nil {
		if s.onError != nil {
			s.onError(err)
		}
		return err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		if s.onError != nil {
			s.onError(err)
		}
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		if s.onError != nil {
			s.onError(err)
		}
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		err := fmt.Errorf("API error: %s", string(bodyBytes))
		if s.onError != nil {
			s.onError(err)
		}
		return err
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		select {
		case <-s.cancelChan:
			return fmt.Errorf("streaming cancelled")
		default:
		}

		line := scanner.Text()
		if line == "" || line == "data: [DONE]" {
			continue
		}

		if len(line) > 6 && line[:6] == "data: " {
			data := line[6:]
			var chunk StreamChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				continue
			}

			if len(chunk.Choices) > 0 {
				content := chunk.Choices[0].Delta.Content
				if content != "" && s.onToken != nil {
					s.onToken(content)
				}

				if chunk.Choices[0].FinishReason != nil && s.onComplete != nil {
					s.onComplete()
				}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		if s.onError != nil {
			s.onError(err)
		}
		return err
	}

	return nil
}

func (s *StreamingClient) Cancel() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.streaming {
		select {
		case <-s.cancelChan:
		default:
			close(s.cancelChan)
			s.cancelChan = make(chan struct{})
		}
	}
}

func (s *StreamingClient) OnToken(callback func(string)) {
	s.onToken = callback
}

func (s *StreamingClient) OnComplete(callback func()) {
	s.onComplete = callback
}

func (s *StreamingClient) OnError(callback func(error)) {
	s.onError = callback
}

func (s *StreamingClient) IsStreaming() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.streaming
}
