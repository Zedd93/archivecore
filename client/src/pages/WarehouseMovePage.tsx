import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Camera, Loader2, MapPin, MoveRight, Volume2, VolumeX, X } from 'lucide-react';
import { parseLocationQrData, parseQrData } from '@archivecore/shared';
import toast from 'react-hot-toast';
import api from '@/services/api';
import BoxPicker from '@/components/ui/BoxPicker';
import LocationPicker from '@/components/ui/LocationPicker';
import QrCameraScanner from '@/components/ui/QrCameraScanner';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import { scanFeedbackStyles, useScanFeedback } from '@/hooks/useScanFeedback';
import { getApiErrorMessage } from '@/utils/apiError';

interface MoveBox {
  id: string;
  boxNumber: string;
  title?: string;
  location?: { fullPath?: string | null } | null;
}

interface Destination {
  id: string;
  fullPath: string;
}

export default function WarehouseMovePage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const { confirm, ConfirmDialogElement } = useConfirm();
  const activeTenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const canMove = hasPermission('box.move') && hasPermission('box.read') && hasPermission('location.read');
  const [boxes, setBoxes] = useState<MoveBox[]>([]);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const { feedback: scanFeedback, soundEnabled, startCameraSound, toggleSound, showFeedback, clearFeedback } = useScanFeedback(isScanning);
  const [isResolving, setIsResolving] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const scanBusyRef = useRef(false);
  const tenantRef = useRef(activeTenantId);
  const lastCameraCodeRef = useRef({ code: '', retryAt: 0 });

  useEffect(() => {
    tenantRef.current = activeTenantId;
    setBoxes([]);
    setDestination(null);
    setIsScanning(false);
    clearFeedback();
    lastCameraCodeRef.current = { code: '', retryAt: 0 };
  }, [activeTenantId, clearFeedback]);

  const allowCameraRetry = (code: string) => {
    if (lastCameraCodeRef.current.code === code) lastCameraCodeRef.current.retryAt = Date.now() + 5000;
  };

  const processCode = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || scanBusyRef.current || !activeTenantId) return;
    scanBusyRef.current = true;
    setIsResolving(true);
    try {
      const locationQr = parseLocationQrData(code);
      if (locationQr) {
        if (!locationQr.isValid) {
          showFeedback('error', t('warehouseMove.invalidCode'));
          allowCameraRetry(code);
          return;
        }
        const { data } = await api.get(`/locations/${encodeURIComponent(locationQr.locationId)}`);
        const location = data.data;
        if (tenantRef.current !== activeTenantId) return;
        if (location?.id !== locationQr.locationId || !location.isActive || !['shelf', 'level', 'slot'].includes(location.type)) {
          showFeedback('error', t('warehouseMove.invalidDestination'));
          allowCameraRetry(code);
          return;
        }
        setDestination({ id: location.id, fullPath: location.fullPath });
        showFeedback('success', t('warehouseMove.locationScanned', { path: location.fullPath }));
        return;
      }

      const boxQr = parseQrData(code);
      if (!boxQr?.isValid) {
        showFeedback('error', t('warehouseMove.invalidCode'));
        allowCameraRetry(code);
        return;
      }
      const { data } = await api.get('/boxes', { params: { search: code, limit: 10 } });
      if (tenantRef.current !== activeTenantId) return;
      const box = (data.data as Array<MoveBox & { qrCode: string }> | undefined)?.find((item) => item.qrCode === code);
      if (!box) {
        showFeedback('error', t('warehouseMove.boxNotFound'));
        allowCameraRetry(code);
        return;
      }
      if (boxes.some((item) => item.id === box.id)) {
        showFeedback('duplicate', t('warehouseMove.alreadyAdded'));
        return;
      }
      setBoxes((current) => current.some((item) => item.id === box.id) ? current : [...current, box]);
      showFeedback('success', t('warehouseMove.boxAdded', { number: box.boxNumber }));
    } catch (error) {
      if (tenantRef.current === activeTenantId) {
        showFeedback('error', getApiErrorMessage(error, t('common.genericError')));
        allowCameraRetry(code);
      }
    } finally {
      scanBusyRef.current = false;
      setIsResolving(false);
    }
  };

  const handleCameraCode = (rawCode: string) => {
    const code = rawCode.trim();
    if (scanBusyRef.current || !code || (lastCameraCodeRef.current.code === code && Date.now() < lastCameraCodeRef.current.retryAt)) return;
    lastCameraCodeRef.current = { code, retryAt: Number.POSITIVE_INFINITY };
    void processCode(code);
  };

  const handleMove = async () => {
    if (!destination || boxes.length === 0 || isMoving) return;
    scanBusyRef.current = true;
    setIsScanning(false);
    const ids = boxes.map((box) => box.id);
    const approved = await confirm({
      title: t('warehouseMove.confirmTitle'),
      message: t('warehouseMove.confirmMessage', { count: ids.length, location: destination.fullPath }),
      confirmLabel: t('warehouseMove.move'),
      variant: 'warning',
    });
    if (!approved) {
      scanBusyRef.current = false;
      return;
    }

    setIsMoving(true);
    try {
      const { data } = await api.post('/boxes/bulk-move', { ids, locationId: destination.id });
      if (data.data?.updated !== ids.length) throw new Error(t('warehouseMove.incompleteMove'));
      toast.success(data.data.moved === 0
        ? t('warehouseMove.alreadyThere')
        : t('warehouseMove.moveSuccess', { count: data.data.moved }));
      setBoxes([]);
      setDestination(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['boxes'] }),
        queryClient.invalidateQueries({ queryKey: ['locations-tree'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('warehouseMove.moveError')));
    } finally {
      setIsMoving(false);
      scanBusyRef.current = false;
    }
  };

  if (!canMove) return <div className="card text-sm text-gray-600">{t('warehouseMove.noPermission')}</div>;
  if (!activeTenantId) return <div className="card text-sm text-gray-600">{t('warehouseMove.chooseTenant')}</div>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('warehouseMove.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('warehouseMove.subtitle')}</p>
      </div>

      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Camera size={20} />{t('warehouseMove.scanner')}</h2>
          {isResolving && <Loader2 size={18} className="animate-spin text-primary-600" aria-label={t('common.loading')} />}
        </div>
        {!isScanning ? (
          <button type="button" className="btn-primary w-full flex items-center justify-center gap-2" onClick={() => { startCameraSound(); lastCameraCodeRef.current = { code: '', retryAt: 0 }; setIsScanning(true); }}>
            <Camera size={17} />{t('labels.startCamera')}
          </button>
        ) : (
          <>
            <QrCameraScanner
              id="archivecore-warehouse-scanner"
              onCode={handleCameraCode}
              onError={() => { showFeedback('error', t('labels.cameraError')); setIsScanning(false); }}
            />
            <button type="button" className="btn-secondary w-full" onClick={() => setIsScanning(false)}>{t('labels.stopCamera')}</button>
          </>
        )}
        <button type="button" className="btn-secondary w-full sm:w-auto" aria-pressed={soundEnabled} onClick={toggleSound}>
          {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}{t(soundEnabled ? 'inventory.muteSound' : 'inventory.unmuteSound')}
        </button>
        {scanFeedback && <div role="status" aria-live="polite" className={`rounded-lg border px-4 py-3 text-sm font-semibold break-words ${scanFeedbackStyles[scanFeedback.kind]}`}>
          {t(`warehouseMove.scanResult.${scanFeedback.kind}`)}: {scanFeedback.message}
        </div>}
        <form onSubmit={(event) => { event.preventDefault(); if (isResolving) return; void processCode(manualCode); setManualCode(''); }}>
          <label htmlFor="warehouse-code" className="label-text">{t('warehouseMove.manualCode')}</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input id="warehouse-code" className="input-field font-mono" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="AC:... / ACLOC:..." />
            <button type="submit" className="btn-secondary shrink-0" disabled={!manualCode.trim() || isResolving}>{t('warehouseMove.addCode')}</button>
          </div>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">{t('warehouseMove.boxes', { count: boxes.length })}</h2>
        <BoxPicker value={boxes} onChange={setBoxes} tenantId={activeTenantId} placeholder={t('warehouseMove.findBox')} showLocation showSelectedChips={false} />
        {boxes.length === 0 ? <p className="text-sm text-gray-500">{t('warehouseMove.noBoxes')}</p> : (
          <ul className="divide-y divide-gray-100">
            {boxes.map((box) => (
              <li key={box.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/boxes/${box.id}`} className="font-medium text-primary-700 hover:underline">{box.boxNumber}</Link>
                  {box.title && <p className="text-sm text-gray-800 break-words">{box.title}</p>}
                  <p className="text-xs text-gray-500 break-words">{box.location?.fullPath || t('warehouseMove.noLocation')}</p>
                </div>
                <button type="button" className="p-2 text-gray-500 hover:text-red-600" onClick={() => setBoxes((current) => current.filter((item) => item.id !== box.id))} aria-label={`${t('common.remove')} ${box.boxNumber}`}><X size={18} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><MapPin size={20} />{t('warehouseMove.destination')}</h2>
        <LocationPicker
          value={destination?.id || ''}
          onChange={(id) => { if (!id) setDestination(null); }}
          onLocationChange={(location) => setDestination(location ? { id: location.id, fullPath: location.fullPath } : null)}
          excludeTypes={['warehouse', 'zone', 'rack']}
          placeholder={t('warehouseMove.findDestination')}
          tenantId={activeTenantId}
        />
        <p className="text-sm text-gray-600 break-words">{destination?.fullPath || t('warehouseMove.noDestination')}</p>
      </section>

      <button type="button" className="btn-primary w-full flex items-center justify-center gap-2" disabled={boxes.length === 0 || !destination || isMoving || isResolving} onClick={() => { void handleMove(); }}>
        {isMoving ? <Loader2 size={18} className="animate-spin" /> : <MoveRight size={18} />}
        {t('warehouseMove.moveCount', { count: boxes.length })}
      </button>
      {ConfirmDialogElement}
    </div>
  );
}
