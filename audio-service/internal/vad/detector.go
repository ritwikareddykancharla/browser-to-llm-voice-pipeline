package vad

import (
	"math"
	"sync"
	"time"
)

type Detector struct {
	threshold      float64
	silencePeriod  time.Duration
	speechPeriod   time.Duration
	mu             sync.Mutex
	isSpeaking     bool
	speechStart    *time.Time
	silenceStart   *time.Time
	energyHistory  []float64
	historySize    int
}

func NewDetector(threshold float64, silencePeriod, speechPeriod time.Duration) *Detector {
	return &Detector{
		threshold:     threshold,
		silencePeriod: silencePeriod,
		speechPeriod:  speechPeriod,
		historySize:   10,
		energyHistory: make([]float64, 0, 10),
	}
}

func (d *Detector) IsSpeech(audioData []byte) bool {
	d.mu.Lock()
	defer d.mu.Unlock()

	energy := d.calculateEnergy(audioData)
	d.addToHistory(energy)
	smoothedEnergy := d.smoothedEnergy()

	now := time.Now()

	if smoothedEnergy > d.threshold {
		d.silenceStart = nil

		if d.speechStart == nil {
			d.speechStart = &now
		}

		if !d.isSpeaking && now.Sub(*d.speechStart) >= d.speechPeriod {
			d.isSpeaking = true
		}
	} else {
		if d.speechStart != nil && d.silenceStart == nil {
			d.silenceStart = &now
		}

		if d.isSpeaking && d.silenceStart != nil && now.Sub(*d.silenceStart) >= d.silencePeriod {
			d.isSpeaking = false
			d.speechStart = nil
		}
	}

	return d.isSpeaking
}

func (d *Detector) calculateEnergy(audioData []byte) float64 {
	if len(audioData) < 2 {
		return 0
	}

	var sum float64
	sampleCount := len(audioData) / 2

	for i := 0; i < len(audioData)-1; i += 2 {
		sample := float64(int16(audioData[i]) | int16(audioData[i+1])<<8)
		normalized := sample / 32768.0
		sum += normalized * normalized
	}

	if sampleCount == 0 {
		return 0
	}

	return math.Sqrt(sum / float64(sampleCount))
}

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

func (d *Detector) Reset() {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.isSpeaking = false
	d.speechStart = nil
	d.silenceStart = nil
	d.energyHistory = d.energyHistory[:0]
}

func (d *Detector) SetThreshold(threshold float64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.threshold = threshold
}

func (d *Detector) Speaking() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.isSpeaking
}
