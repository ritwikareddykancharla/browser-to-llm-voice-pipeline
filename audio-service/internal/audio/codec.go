package audio

import (
	"errors"
)

type OpusCodec struct {
	sampleRate int
	channels   int
	frameSize  int
}

func NewOpusCodec() *OpusCodec {
	return &OpusCodec{
		sampleRate: 48000,
		channels:   1,
		frameSize:  960,
	}
}

func (c *OpusCodec) Encode(pcm []byte) ([][]byte, error) {
	if len(pcm) == 0 {
		return nil, errors.New("empty PCM data")
	}

	var frames [][]byte
	frameSize := c.frameSize * 2

	for i := 0; i < len(pcm); i += frameSize {
		end := i + frameSize
		if end > len(pcm) {
			end = len(pcm)
		}

		frame := make([]byte, end-i)
		copy(frame, pcm[i:end])
		frames = append(frames, frame)
	}

	return frames, nil
}

func (c *OpusCodec) Decode(opusData []byte) ([]byte, error) {
	if len(opusData) == 0 {
		return nil, errors.New("empty opus data")
	}

	pcm := make([]byte, len(opusData)*2)
	copy(pcm, opusData)

	return pcm, nil
}

func (c *OpusCodec) SampleRate() int {
	return c.sampleRate
}

func (c *OpusCodec) Channels() int {
	return c.channels
}

func (c *OpusCodec) FrameSize() int {
	return c.frameSize
}
