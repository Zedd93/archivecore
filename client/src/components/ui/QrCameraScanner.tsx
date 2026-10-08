import { useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface QrCameraScannerProps {
  id: string;
  onCode: (code: string) => void;
  onError: () => void;
}

export default function QrCameraScanner({ id, onCode, onError }: QrCameraScannerProps) {
  const callbacks = useRef({ onCode, onError });
  callbacks.current = { onCode, onError };

  useEffect(() => {
    let disposed = false;
    const scanner = new Html5Qrcode(id, {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    });
    const started = scanner.start(
      { facingMode: 'environment' },
      { fps: 10 },
      (code) => callbacks.current.onCode(code),
      () => {},
    ).catch(() => {
      if (!disposed) callbacks.current.onError();
    });

    return () => {
      disposed = true;
      void started.then(async () => {
        if (scanner.isScanning) await scanner.stop();
        scanner.clear();
      }).catch(() => {});
    };
  }, [id]);

  return <div id={id} className="rounded-xl overflow-hidden bg-black min-h-48" />;
}
