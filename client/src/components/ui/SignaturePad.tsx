import { useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  onChange: (image: string | null) => void;
  disabled?: boolean;
}

export default function SignaturePad({ onChange, disabled = false }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const pointerRef = useRef<number | null>(null);
  const [hasSignature, setHasSignature] = useState(false);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * canvas.width / bounds.width,
      y: (event.clientY - bounds.top) * canvas.height / bounds.height,
    };
  };

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || pointerRef.current !== null) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    if (!context) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = point(event);
    context.strokeStyle = '#111827';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 0.01, y + 0.01);
    context.stroke();
    context.beginPath();
    context.moveTo(x, y);
    drawingRef.current = true;
    pointerRef.current = event.pointerId;
    setHasSignature(true);
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || pointerRef.current !== event.pointerId || disabled) return;
    event.preventDefault();
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
  };

  const finish = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || pointerRef.current !== event.pointerId) return;
    drawingRef.current = false;
    pointerRef.current = null;
    event.currentTarget.getContext('2d')?.closePath();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onChange(event.currentTarget.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    drawingRef.current = false;
    pointerRef.current = null;
    setHasSignature(false);
    onChange(null);
  };

  return <div className="space-y-2">
    <p className="label-text">{t('orders.detail.signature')}</p>
    <canvas ref={canvasRef} width={600} height={180} role="img" aria-label={t('orders.detail.signatureCanvas')}
      className="w-full h-36 rounded-lg border border-gray-300 bg-white touch-none cursor-crosshair"
      onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} />
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-gray-500">{t('orders.detail.signatureHint')}</p>
      <button type="button" className="btn-secondary text-xs shrink-0" disabled={!hasSignature || disabled} onClick={clear}>{t('orders.detail.clearSignature')}</button>
    </div>
  </div>;
}
