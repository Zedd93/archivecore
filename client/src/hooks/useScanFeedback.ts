import { useEffect, useRef, useState } from 'react';

export type ScanFeedbackKind = 'success' | 'warning' | 'duplicate' | 'error';

export const scanFeedbackStyles: Record<ScanFeedbackKind, string> = {
  success: 'border-green-300 bg-green-50 text-green-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  duplicate: 'border-blue-300 bg-blue-50 text-blue-900',
  error: 'border-red-300 bg-red-50 text-red-900',
};

const scanTones: Record<ScanFeedbackKind, number[]> = {
  success: [880],
  warning: [440, 440],
  duplicate: [660, 660],
  error: [220, 220],
};

export function useScanFeedback(isScanning: boolean) {
  const [feedback, setFeedback] = useState<{ kind: ScanFeedbackKind; message: string } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => () => {
    if (audioContextRef.current) void audioContextRef.current.close();
  }, []);

  const unlockSound = () => {
    if (!window.AudioContext) return;
    try {
      audioContextRef.current ??= new AudioContext();
      void audioContextRef.current.resume().catch(() => {});
    } catch {
      // The visual result remains available when audio is blocked.
    }
  };

  const startCameraSound = () => {
    if (soundEnabled) unlockSound();
  };

  const toggleSound = () => {
    if (!soundEnabled) unlockSound();
    setSoundEnabled((enabled) => !enabled);
  };

  const showFeedback = (kind: ScanFeedbackKind, message: string) => {
    setFeedback({ kind, message });
    if (!isScanning) return;
    try {
      if ('vibrate' in navigator) navigator.vibrate(kind === 'success' ? 60 : [100, 80, 100]);
    } catch {
      // Vibration support varies by device and browser.
    }
    const context = audioContextRef.current;
    if (!soundEnabled || !context || context.state !== 'running') return;
    try {
      scanTones[kind].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * 0.16;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
        oscillator.connect(gain).connect(context.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + 0.13);
      });
    } catch {
      // Audio is optional; never interrupt a scan because of device support.
    }
  };

  return {
    feedback,
    soundEnabled,
    startCameraSound,
    toggleSound,
    showFeedback,
    clearFeedback: () => setFeedback(null),
  };
}
