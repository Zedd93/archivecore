import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Camera, Loader2, MapPin, PackageCheck, Volume2, VolumeX, X } from 'lucide-react';
import { parseLocationQrData, parseQrData } from '@archivecore/shared';
import toast from 'react-hot-toast';
import axios from 'axios';
import api from '@/services/api';
import BoxPicker from '@/components/ui/BoxPicker';
import LocationPicker from '@/components/ui/LocationPicker';
import QrCameraScanner from '@/components/ui/QrCameraScanner';
import OfflineScanPanel from '@/components/ui/OfflineScanPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import { scanFeedbackStyles, useScanFeedback } from '@/hooks/useScanFeedback';
import { getApiErrorMessage } from '@/utils/apiError';
import { SerialScanQueue } from '@/utils/serialScanQueue';
import { useOfflineWarehouseScans } from '@/hooks/useOfflineWarehouseScans';

interface ReceiveBox {
  id: string;
  boxNumber: string;
  title?: string;
  qrCode?: string;
  tenantId?: string;
  locationId?: string | null;
}

interface Destination {
  id: string;
  fullPath: string;
}

export default function WarehouseReceivePage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const { confirm, ConfirmDialogElement } = useConfirm();
  const activeTenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const offlineScans = useOfflineWarehouseScans(user?.id || '', activeTenantId, 'receive');
  const canReceive = hasPermission('box.move') && hasPermission('box.read') && hasPermission('location.read');
  const [boxes, setBoxes] = useState<ReceiveBox[]>([]);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [notes, setNotes] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const { feedback: scanFeedback, soundEnabled, startCameraSound, toggleSound, showFeedback, clearFeedback } = useScanFeedback(isScanning);
  const [isResolving, setIsResolving] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const busyRef = useRef(false);
  const selectedBoxIdsRef = useRef(new Set<string>());
  const tenantRef = useRef(activeTenantId);
  const lastCameraRef = useRef({ code: '', retryAt: 0 });
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
    lastCameraRef.current = { code: '', retryAt: 0 };
  }, [activeTenantId, clearFeedback]);

  const allowCameraRetry = (code: string) => {
    if (lastCameraRef.current.code === code) lastCameraRef.current.retryAt = Date.now() + 5000;
  };

  const stageCode = (code: string): boolean => {
    if (!parseLocationQrData(code)?.isValid && !parseQrData(code)?.isValid) {
      showFeedback('error', t('warehouseReceive.invalidCode'));
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
    if (!code || busyRef.current || !activeTenantId) return false;
    if (!navigator.onLine) {
      stageCode(code);
      return false;
    }
    busyRef.current = true;
    setIsResolving(true);
    try {
      const locationQr = parseLocationQrData(code);
      if (locationQr) {
        if (!locationQr.isValid) { showFeedback('error', t('warehouseReceive.invalidCode')); allowCameraRetry(code); return false; }
        const { data } = await api.get(`/locations/${encodeURIComponent(locationQr.locationId)}`);
        const location = data.data;
        if (tenantRef.current !== activeTenantId) return false;
        if (location?.id !== locationQr.locationId || !location.isActive || !['shelf', 'level', 'slot'].includes(location.type)) {
          showFeedback('error', t('warehouseReceive.invalidDestination'));
          allowCameraRetry(code);
          return false;
        }
        setDestination({ id: location.id, fullPath: location.fullPath });
        showFeedback('success', t('warehouseReceive.locationScanned', { path: location.fullPath }));
        return true;
      }
      if (!parseQrData(code)?.isValid) { showFeedback('error', t('warehouseReceive.invalidCode')); allowCameraRetry(code); return false; }
      const { data } = await api.get('/boxes', { params: { search: code, unlocated: 'true', status: 'active', limit: 10 } });
      if (tenantRef.current !== activeTenantId) return false;
      const box = (data.data as ReceiveBox[] | undefined)?.find((item) => item.qrCode === code && item.locationId === null && item.tenantId === activeTenantId);
      if (!box) { showFeedback('error', t('warehouseReceive.boxNotFound')); allowCameraRetry(code); return false; }
      if (selectedBoxIdsRef.current.has(box.id)) { showFeedback('duplicate', t('warehouseReceive.duplicate')); return true; }
      selectedBoxIdsRef.current.add(box.id);
      setBoxes((current) => current.some((item) => item.id === box.id) ? current : [...current, box]);
      showFeedback('success', t('warehouseReceive.boxAdded', { number: box.boxNumber }));
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
      busyRef.current = false;
      setIsResolving(false);
    }
  };
  processCodeRef.current = processCode;

  const handleCameraCode = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || (busyRef.current && !scanQueueRef.current?.isBusy) || (lastCameraRef.current.code === code && Date.now() < lastCameraRef.current.retryAt)) return;
    lastCameraRef.current = { code, retryAt: Number.POSITIVE_INFINITY };
    scanQueueRef.current?.enqueue(code);
  };

  const receive = async () => {
    if (!offlineScans.online || !offlineScans.allVerified || !destination || boxes.length === 0 || busyRef.current || scanQueueRef.current?.isBusy) return;
    const ids = boxes.map((box) => box.id);
    busyRef.current = true;
    setIsScanning(false);
    const approved = await confirm({
      title: t('warehouseReceive.confirmTitle'),
      message: t('warehouseReceive.confirmMessage', { count: ids.length, location: destination.fullPath }),
      confirmLabel: t('warehouseReceive.receive'),
      variant: 'warning',
    });
    if (!approved) { busyRef.current = false; return; }
    setIsReceiving(true);
    try {
      const { data } = await api.post('/boxes/bulk-receive', { ids, locationId: destination.id, notes: notes.trim() || undefined });
      if (data.data?.received !== ids.length) throw new Error(t('warehouseReceive.incomplete'));
      toast.success(t('warehouseReceive.success', { count: ids.length }));
      offlineScans.clear();
      selectedBoxIdsRef.current.clear();
      setBoxes([]);
      setDestination(null);
      setNotes('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['boxes'] }),
        queryClient.invalidateQueries({ queryKey: ['box-picker'] }),
        queryClient.invalidateQueries({ queryKey: ['locations-tree'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('warehouseReceive.error')));
    } finally {
      setIsReceiving(false);
      busyRef.current = false;
    }
  };

  if (!canReceive) return <div className="card text-sm text-gray-600">{t('warehouseReceive.noPermission')}</div>;
  if (!activeTenantId) return <div className="card text-sm text-gray-600">{t('warehouseMove.chooseTenant')}</div>;

  return <div className="space-y-5 max-w-3xl">
    <div>
      <h1 className="text-2xl font-bold text-gray-900">{t('warehouseReceive.title')}</h1>
      <p className="text-sm text-gray-500 mt-1">{t('warehouseReceive.subtitle')}</p>
    </div>
    <section className="card space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><Camera size={19} />{t('warehouseReceive.scanner')}</h2>
      {!isScanning ? <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => { startCameraSound(); lastCameraRef.current = { code: '', retryAt: 0 }; setIsScanning(true); }}><Camera size={17} />{t('labels.startCamera')}</button> : <>
        <QrCameraScanner id="archivecore-receive-scanner" onCode={handleCameraCode} onError={() => { showFeedback('error', t('labels.cameraError')); setIsScanning(false); }} />
        <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setIsScanning(false)}>{t('labels.stopCamera')}</button>
      </>}
      <button type="button" className="btn-secondary w-full sm:w-auto" aria-pressed={soundEnabled} onClick={toggleSound}>
        {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}{t(soundEnabled ? 'inventory.muteSound' : 'inventory.unmuteSound')}
      </button>
      {scanFeedback && <div role="status" aria-live="polite" className={`rounded-lg border px-4 py-3 text-sm font-semibold break-words ${scanFeedbackStyles[scanFeedback.kind]}`}>
        {t(`warehouseReceive.scanResult.${scanFeedback.kind}`)}: {scanFeedback.message}
      </div>}
      <form onSubmit={(event) => { event.preventDefault(); if (!isResolving && !busyRef.current) { scanQueueRef.current?.enqueue(manualCode); setManualCode(''); } }}>
        <label htmlFor="receive-code" className="label-text">{t('warehouseReceive.manualCode')}</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input id="receive-code" className="input-field font-mono" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="AC:... / ACLOC:..." />
          <button type="submit" className="btn-secondary shrink-0" disabled={!manualCode.trim() || isResolving}>{isResolving && <Loader2 size={16} className="animate-spin" />}{t('warehouseReceive.addCode')}</button>
        </div>
      </form>
    </section>
    <OfflineScanPanel codes={offlineScans.codes} verifiedCodes={offlineScans.verifiedCodes} online={offlineScans.online} syncing={offlineScans.syncing}
      onRemove={offlineScans.remove} onSync={() => { if (!busyRef.current && !scanQueueRef.current?.isBusy) void offlineScans.verify(processCode); }} />
    <section className="card space-y-3">
      <h2 className="font-semibold">{t('warehouseReceive.boxes', { count: boxes.length })}</h2>
      <BoxPicker value={boxes} onChange={(next) => { selectedBoxIdsRef.current = new Set(next.map((box) => box.id)); setBoxes(next); }} tenantId={activeTenantId} unlocatedOnly placeholder={t('warehouseReceive.findBox')} showSelectedChips={false} />
      {boxes.length === 0 ? <p className="text-sm text-gray-500">{t('warehouseReceive.noBoxes')}</p> : <ul className="divide-y divide-gray-100">
        {boxes.map((box) => <li key={box.id} className="py-2 flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0"><Link to={`/boxes/${box.id}`} className="font-medium text-primary-700 hover:underline">{box.boxNumber}</Link><p className="break-words">{box.title}</p></div>
          <button type="button" className="p-2 text-gray-500 hover:text-red-600" onClick={() => { selectedBoxIdsRef.current.delete(box.id); setBoxes((current) => current.filter((item) => item.id !== box.id)); }} aria-label={`${t('common.remove')} ${box.boxNumber}`}><X size={18} /></button>
        </li>)}
      </ul>}
    </section>
    <section className="card space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><MapPin size={19} />{t('warehouseReceive.destination')}</h2>
      <LocationPicker value={destination?.id || ''} onChange={(id) => { if (!id) setDestination(null); }} onLocationChange={(location) => setDestination(location ? { id: location.id, fullPath: location.fullPath } : null)} excludeTypes={['warehouse', 'zone', 'rack']} placeholder={t('warehouseReceive.chooseDestination')} tenantId={activeTenantId} suggestPlacement placementCount={boxes.length} />
      {destination && <p className="text-sm break-words">{destination.fullPath}</p>}
      <label htmlFor="receive-notes" className="label-text">{t('warehouseReceive.notes')}</label>
      <textarea id="receive-notes" className="input-field w-full" rows={2} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
    </section>
    <button type="button" className="btn-primary w-full" disabled={!offlineScans.online || !offlineScans.allVerified || offlineScans.syncing || !destination || boxes.length === 0 || isReceiving || isResolving || scanQueueRef.current?.isBusy} onClick={() => { void receive(); }}>
      {isReceiving ? <Loader2 size={18} className="animate-spin" /> : <PackageCheck size={18} />}{t('warehouseReceive.receiveCount', { count: boxes.length })}
    </button>
    {ConfirmDialogElement}
  </div>;
}
