import { useState, useEffect, useCallback, useRef } from 'react';
import { getAudioStream, stopStream, createAudioContext, calculateRMS } from '../utils/audio';

interface AudioCaptureOptions {
  onAudioData?: (data: Float32Array) => void;
  onVolumeChange?: (volume: number) => void;
}

export function useAudioCapture(options: AudioCaptureOptions = {}) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [stream, setStream] = useState<MediaStream>();
  const [error, setError] = useState<string>();

  const audioContextRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const processorRef = useRef<ScriptProcessorNode>();
  const streamRef = useRef<MediaStream>();
  const animationRef = useRef<number>();

  const startCapture = useCallback(async () => {
    try {
      setError(undefined);

      const audioStream = await getAudioStream();
      streamRef.current = audioStream;
      setStream(audioStream);

      const audioContext = createAudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(audioStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        options.onAudioData?.(inputData);

        const rms = calculateRMS(inputData);
        options.onVolumeChange?.(rms);
      };

      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(audioContext.destination);

      setIsCapturing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start audio capture');
    }
  }, [options]);

  const stopCapture = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    processorRef.current?.disconnect();
    analyserRef.current?.disconnect();
    audioContextRef.current?.close();

    stopStream(streamRef.current);

    processorRef.current = undefined;
    analyserRef.current = undefined;
    audioContextRef.current = undefined;
    streamRef.current = undefined;

    setStream(undefined);
    setIsCapturing(false);
  }, []);

  const getAnalyser = useCallback(() => analyserRef.current, []);

  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  return {
    isCapturing,
    stream,
    error,
    startCapture,
    stopCapture,
    getAnalyser,
  };
}
