import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Camera, Loader2, MapPin, MoveRight, Volume2, VolumeX, X } from 'lucide-react';
import { parseLocationQrData, parseQrData } from '@archivecore/shared';
import toast from 'react-hot-toast';
import axios from 'axios';
import api from '@/services/api';
import BoxPicker from '@/components/ui/BoxPicker';
import LocationPicker from '@/components/ui/LocationPicker';
import QrCameraScanner from '@/components/ui/QrCameraScanner';
import OfflineScanPanel from '@/components/ui/OfflineScanPanel';
import PendingWarehouseSubmission from '@/components/ui/PendingWarehouseSubmission';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import { scanFeedbackStyles, useScanFeedback } from '@/hooks/useScanFeedback';
import { getApiErrorMessage } from '@/utils/apiError';
import { SerialScanQueue } from '@/utils/serialScanQueue';
import { useOfflineWarehouseScans } from '@/hooks/useOfflineWarehouseScans';
import { useWarehouseSubmission } from '@/hooks/useWarehouseSubmission';
import type { WarehouseSubmission } from '@/utils/warehouseSubmission';

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
  const offlineScans = useOfflineWarehouseScans(user?.id || '', activeTenantId, 'move');
  const submission = useWarehouseSubmission(user?.id || '', activeTenantId, 'move');
  const canMove = hasPermission('box.move') && hasPermission('box.read') && hasPermission('location.read');
  const [boxes, setBoxes] = useState<MoveBox[]>([]);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const { feedback: scanFeedback, soundEnabled, startCameraSound, toggleSound, showFeedback, clearFeedback } = useScanFeedback(isScanning);
  const [isResolving, setIsResolving] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const scanBusyRef = useRef(false);
  const selectedBoxIdsRef = useRef(new Set<string>());
  const tenantRef = useRef(activeTenantId);
  const lastCameraCodeRef = useRef({ code: '', retryAt: 0 });
  const processCodeRef = useRef<(code: string) => Promise<boolean>>(async () => false);
  const scanErrorRef = useRef<(error: unknown) => void>(() => {});
  const scanQueueRef = useRef<SerialScanQueue | null>(null);
  scanQueueRef.current ??= new SerialScanQueue(
    async (code) => { await processCodeRef.current(code); },
    (error) => scanErrorRef.current(error),
  );
  scanErrorRef.current = (error) => showFeedback('error', getApiErrorMessage(error, t('common.genericError')));

  useEffect(() => {
    tenantRef.current = activeTenantId;
    scanQueueRef.current?.clear();
    selectedBoxIdsRef.current.clear();
    setBoxes([]);
    setDestination(null);
    setIsScanning(false);
    clearFeedback();
    lastCameraCodeRef.current = { code: '', retryAt: 0 };
  }, [activeTenantId, clearFeedback]);

  const allowCameraRetry = (code: string) => {
    if (lastCameraCodeRef.current.code === code) lastCameraCodeRef.current.retryAt = Date.now() + 5000;
  };

  const stageCode = (code: string): boolean => {
    if (!parseLocationQrData(code)?.isValid && !parseQrData(code)?.isValid) {
      showFeedback('error', t('warehouseMove.invalidCode'));
      allowCameraRetry(code);
      return false;
    }
    const result = offlineScans.stage(code);
    showFeedback(result === 'unavailable' ? 'error' : 'warning', t(`offlineScans.${result}`));
    if (result === 'unavailable') allowCameraRetry(code);
    return result !== 'unavailable';
  };

  const processCode = async (rawCode: string): Promise<boolean> => {
    const code = rawCode.trim();
    if (!code || scanBusyRef.current || !activeTenantId) return false;
    if (!navigator.onLine) {
      stageCode(code);
      return false;
    }
    scanBusyRef.current = true;
    setIsResolving(true);
    try {
      const locationQr = parseLocationQrData(code);
      if (locationQr) {
        if (!locationQr.isValid) {
          showFeedback('error', t('warehouseMove.invalidCode'));
          allowCameraRetry(code);
          return false;
        }
        const { data } = await api.get(`/locations/${encodeURIComponent(locationQr.locationId)}`);
        const location = data.data;
        if (tenantRef.current !== activeTenantId) return false;
        if (location?.id !== locationQr.locationId || !location.isActive || !['shelf', 'level', 'slot'].includes(location.type)) {
          showFeedback('error', t('warehouseMove.invalidDestination'));
          allowCameraRetry(code);
          return false;
        }
        setDestination({ id: location.id, fullPath: location.fullPath });
        showFeedback('success', t('warehouseMove.locationScanned', { path: location.fullPath }));
        return true;
      }

      const boxQr = parseQrData(code);
      if (!boxQr?.isValid) {
        showFeedback('error', t('warehouseMove.invalidCode'));
        allowCameraRetry(code);
        return false;
      }
      const { data } = await api.get('/boxes', { params: { search: code, limit: 10 } });
      if (tenantRef.current !== activeTenantId) return false;
      const box = (data.data as Array<MoveBox & { qrCode: string }> | undefined)?.find((item) => item.qrCode === code);
      if (!box) {
        showFeedback('error', t('warehouseMove.boxNotFound'));
        allowCameraRetry(code);
        return false;
      }
      if (selectedBoxIdsRef.current.has(box.id)) {
        showFeedback('duplicate', t('warehouseMove.alreadyAdded'));
        return true;
      }
      selectedBoxIdsRef.current.add(box.id);
      setBoxes((current) => current.some((item) => item.id === box.id) ? current : [...current, box]);
      showFeedback('success', t('warehouseMove.boxAdded', { number: box.boxNumber }));
      return true;
    } catch (error) {
      if (tenantRef.current === activeTenantId) {
        if (!navigator.onLine || (axios.isAxiosError(error) && !error.response && error.code !== 'ERR_CANCELED')) {
          stageCode(code);
          return false;
        }
        showFeedback('error', getApiErrorMessage(error, t('common.genericError')));
        allowCameraRetry(code);
      }
      return false;
    } finally {
      scanBusyRef.current = false;
      setIsResolving(false);
    }
  };
  processCodeRef.current = processCode;

  const handleCameraCode = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || (scanBusyRef.current && !scanQueueRef.current?.isBusy) || (lastCameraCodeRef.current.code === code && Date.now() < lastCameraCodeRef.current.retryAt)) return;
    lastCameraCodeRef.current = { code, retryAt: Number.POSITIVE_INFINITY };
    scanQueueRef.current?.enqueue(code);
  };

  const sendMove = async (entry: WarehouseSubmission) => {
    scanBusyRef.current = true;
    setIsScanning(false);
    setIsMoving(true);
    try {
      const { data } = await api.post('/boxes/bulk-move', {
        ids: entry.ids, locationId: entry.locationId, operationId: entry.operationId,
      });
      if (data.data?.updated !== entry.ids.length) throw new Error(t('warehouseMove.incompleteMove'));
      submission.clear(entry.operationId);
      toast.success(data.data.moved === 0
        ? t('warehouseMove.alreadyThere')
        : t('warehouseMove.moveSuccess', { count: data.data.moved }));
      offlineScans.clear();
      selectedBoxIdsRef.current.clear();
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

  const handleMove = async () => {
    if (!offlineScans.online || !offlineScans.allVerified || submission.pending || !destination || boxes.length === 0 || isMoving || scanBusyRef.current || scanQueueRef.current?.isBusy) return;
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

    const entry = submission.start({ ids, locationId: destination.id, locationLabel: destination.fullPath });
    if (!entry) {
      toast.error(t('warehouseSubmission.saveError'));
      scanBusyRef.current = false;
      return;
    }
    await sendMove(entry);
  };

  const discardPending = async () => {
    if (!submission.pending || isMoving) return;
    if (await confirm({ title: t('warehouseSubmission.discardTitle'), message: t('warehouseSubmission.discardWarning'), confirmLabel: t('warehouseSubmission.discard'), variant: 'warning' })) {
      submission.clear(submission.pending.operationId);
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
        <form onSubmit={(event) => { event.preventDefault(); if (isResolving || scanBusyRef.current) return; scanQueueRef.current?.enqueue(manualCode); setManualCode(''); }}>
          <label htmlFor="warehouse-code" className="label-text">{t('warehouseMove.manualCode')}</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input id="warehouse-code" className="input-field font-mono" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="AC:... / ACLOC:..." />
            <button type="submit" className="btn-secondary shrink-0" disabled={!manualCode.trim() || isResolving}>{t('warehouseMove.addCode')}</button>
          </div>
        </form>
      </section>

      <OfflineScanPanel codes={offlineScans.codes} verifiedCodes={offlineScans.verifiedCodes} online={offlineScans.online} syncing={offlineScans.syncing}
        onRemove={offlineScans.remove} onSync={() => { if (!scanBusyRef.current && !scanQueueRef.current?.isBusy) void offlineScans.verify(processCode); }} />
      <PendingWarehouseSubmission pending={submission.pending} busy={isMoving} online={offlineScans.online}
        onRetry={() => { if (submission.pending && !scanBusyRef.current) void sendMove(submission.pending); }}
        onDiscard={() => { void discardPending(); }} />

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">{t('warehouseMove.boxes', { count: boxes.length })}</h2>
        <BoxPicker value={boxes} onChange={(next) => { selectedBoxIdsRef.current = new Set(next.map((box) => box.id)); setBoxes(next); }} tenantId={activeTenantId} placeholder={t('warehouseMove.findBox')} showLocation showSelectedChips={false} />
        {boxes.length === 0 ? <p className="text-sm text-gray-500">{t('warehouseMove.noBoxes')}</p> : (
          <ul className="divide-y divide-gray-100">
            {boxes.map((box) => (
              <li key={box.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/boxes/${box.id}`} className="font-medium text-primary-700 hover:underline">{box.boxNumber}</Link>
                  {box.title && <p className="text-sm text-gray-800 break-words">{box.title}</p>}
                  <p className="text-xs text-gray-500 break-words">{box.location?.fullPath || t('warehouseMove.noLocation')}</p>
                </div>
                <button type="button" className="p-2 text-gray-500 hover:text-red-600" onClick={() => { selectedBoxIdsRef.current.delete(box.id); setBoxes((current) => current.filter((item) => item.id !== box.id)); }} aria-label={`${t('common.remove')} ${box.boxNumber}`}><X size={18} /></button>
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
          suggestPlacement
          placementCount={boxes.length}
        />
        <p className="text-sm text-gray-600 break-words">{destination?.fullPath || t('warehouseMove.noDestination')}</p>
      </section>

      <button type="button" className="btn-primary w-full flex items-center justify-center gap-2" disabled={!offlineScans.online || !offlineScans.allVerified || offlineScans.syncing || !!submission.pending || boxes.length === 0 || !destination || isMoving || isResolving || scanQueueRef.current?.isBusy} onClick={() => { void handleMove(); }}>
        {isMoving ? <Loader2 size={18} className="animate-spin" /> : <MoveRight size={18} />}
        {t('warehouseMove.moveCount', { count: boxes.length })}
      </button>
      {ConfirmDialogElement}
    </div>
  );
}
