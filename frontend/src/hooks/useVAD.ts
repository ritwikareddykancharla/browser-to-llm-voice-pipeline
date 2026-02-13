import { useState, useCallback, useRef, useEffect } from 'react';

interface VADOptions {
  threshold?: number;
  silenceDuration?: number;
  speechDuration?: number;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

interface VADState {
  isSpeaking: boolean;
  volume: number;
}

export function useVAD(options: VADOptions = {}) {
  const {
    threshold = 0.01,
    silenceDuration = 500,
    speechDuration = 100,
    onSpeechStart,
    onSpeechEnd,
  } = options;

  const [state, setState] = useState<VADState>({
    isSpeaking: false,
    volume: 0,
  });

  const speechStartRef = useRef<number>();
  const silenceStartRef = useRef<number>();
  const isSpeakingRef = useRef(false);

  const processAudio = useCallback((data: Float32Array) => {
    const now = Date.now();
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    const rms = Math.sqrt(sum / data.length);

    setState((prev) => ({ ...prev, volume: rms }));

    if (rms > threshold) {
      silenceStartRef.current = undefined;

      if (!speechStartRef.current) {
        speechStartRef.current = now;
      }

      if (!isSpeakingRef.current && now - speechStartRef.current >= speechDuration) {
        isSpeakingRef.current = true;
        setState((prev) => ({ ...prev, isSpeaking: true }));
        onSpeechStart?.();
      }
    } else {
      if (!silenceStartRef.current) {
        silenceStartRef.current = now;
      }

      if (isSpeakingRef.current && now - silenceStartRef.current >= silenceDuration) {
        speechStartRef.current = undefined;
        isSpeakingRef.current = false;
        setState((prev) => ({ ...prev, isSpeaking: false }));
        onSpeechEnd?.();
      }
    }
  }, [threshold, silenceDuration, speechDuration, onSpeechStart, onSpeechEnd]);

  const reset = useCallback(() => {
    speechStartRef.current = undefined;
    silenceStartRef.current = undefined;
    isSpeakingRef.current = false;
    setState({ isSpeaking: false, volume: 0 });
  }, []);

  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  return {
    isSpeaking: state.isSpeaking,
    volume: state.volume,
    processAudio,
    reset,
  };
}
