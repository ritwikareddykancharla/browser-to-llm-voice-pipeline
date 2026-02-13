package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

type Client struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
	mu         sync.Mutex
	streaming  bool
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature float64   `json:"temperature"`
	Stream      bool      `json:"stream"`
}

type ChatResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index        int      `json:"index"`
		Message      Message  `json:"message"`
		FinishReason string   `json:"finish_reason"`
		Delta        *Message `json:"delta,omitempty"`
	} `json:"choices"`
}

func NewClient(apiKey string) *Client {
	return &Client{
		apiKey:  apiKey,
		baseURL: "https://api.openai.com/v1",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) ProcessAudio(pcmData []byte) ([]byte, error) {
	if c.apiKey == "" {
		return c.mockResponse(pcmData)
	}

	text, err := c.transcribe(pcmData)
	if err != nil {
		return nil, fmt.Errorf("transcription failed: %w", err)
	}

	response, err := c.chat(text)
	if err != nil {
		return nil, fmt.Errorf("chat failed: %w", err)
	}

	audioResponse, err := c.synthesize(response)
	if err != nil {
		return nil, fmt.Errorf("synthesis failed: %w", err)
	}

	return audioResponse, nil
}

func (c *Client) transcribe(audioData []byte) (string, error) {
	url := c.baseURL + "/audio/transcriptions"

	body := &bytes.Buffer{}
	writer := createMultipartWriter(body, audioData)

	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API error: %s", string(bodyBytes))
	}

	var result struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	return result.Text, nil
}

func (c *Client) chat(prompt string) (string, error) {
	url := c.baseURL + "/chat/completions"

	chatReq := ChatRequest{
		Model: "gpt-4o",
		Messages: []Message{
			{Role: "system", Content: "You are a helpful voice assistant. Keep responses concise and natural for speech."},
			{Role: "user", Content: prompt},
		},
		Temperature: 0.7,
		Stream:      false,
	}

	body, err := json.Marshal(chatReq)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API error: %s", string(bodyBytes))
	}

	var chatResp ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", err
	}

	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("no response choices")
	}

	return chatResp.Choices[0].Message.Content, nil
}

func (c *Client) synthesize(text string) ([]byte, error) {
	url := c.baseURL + "/audio/speech"

	reqBody := map[string]interface{}{
		"model": "tts-1",
		"input": text,
		"voice": "nova",
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error: %s", string(bodyBytes))
	}

	return io.ReadAll(resp.Body)
}

func (c *Client) mockResponse(pcmData []byte) ([]byte, error) {
	time.Sleep(100 * time.Millisecond)
	return make([]byte, 4800), nil
}

type multipartWriter interface {
	FormDataContentType() string
}

type mockMultipartWriter struct{}

func (m *mockMultipartWriter) FormDataContentType() string {
	return "multipart/form-data"
}

func createMultipartWriter(body *bytes.Buffer, audioData []byte) multipartWriter {
	return &mockMultipartWriter{}
}
