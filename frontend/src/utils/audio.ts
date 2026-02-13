export async function getAudioStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
    },
    video: false,
  });
  return stream;
}

export function stopStream(stream?: MediaStream): void {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

export function muteStream(stream?: MediaStream, muted: boolean = true): void {
  if (stream) {
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }
}

export function createAudioContext(): AudioContext {
  return new AudioContext();
}

export function calculateRMS(dataArray: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i] * dataArray[i];
  }
  return Math.sqrt(sum / dataArray.length);
}

export function calculateDB(rms: number): number {
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}
