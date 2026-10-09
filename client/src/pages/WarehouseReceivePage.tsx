import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Camera, Loader2, MapPin, PackageCheck, X } from 'lucide-react';
import { parseLocationQrData, parseQrData } from '@archivecore/shared';
import toast from 'react-hot-toast';
import api from '@/services/api';
import BoxPicker from '@/components/ui/BoxPicker';
import LocationPicker from '@/components/ui/LocationPicker';
import QrCameraScanner from '@/components/ui/QrCameraScanner';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import { getApiErrorMessage } from '@/utils/apiError';

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
  const canReceive = hasPermission('box.move') && hasPermission('box.read') && hasPermission('location.read');
  const [boxes, setBoxes] = useState<ReceiveBox[]>([]);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [notes, setNotes] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const busyRef = useRef(false);
  const tenantRef = useRef(activeTenantId);
  const lastCameraRef = useRef({ code: '', at: 0 });

  useEffect(() => {
    tenantRef.current = activeTenantId;
    setBoxes([]);
    setDestination(null);
    setIsScanning(false);
  }, [activeTenantId]);

  const processCode = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || busyRef.current || !activeTenantId) return;
    busyRef.current = true;
    setIsResolving(true);
    try {
      const locationQr = parseLocationQrData(code);
      if (locationQr) {
        if (!locationQr.isValid) { toast.error(t('warehouseReceive.invalidCode')); return; }
        const { data } = await api.get(`/locations/${encodeURIComponent(locationQr.locationId)}`);
        const location = data.data;
        if (tenantRef.current !== activeTenantId) return;
        if (location?.id !== locationQr.locationId || !location.isActive || !['shelf', 'level', 'slot'].includes(location.type)) {
          toast.error(t('warehouseReceive.invalidDestination'));
          return;
        }
        setDestination({ id: location.id, fullPath: location.fullPath });
        toast.success(t('warehouseReceive.destinationAdded'));
        return;
      }
      if (!parseQrData(code)?.isValid) { toast.error(t('warehouseReceive.invalidCode')); return; }
      const { data } = await api.get('/boxes', { params: { search: code, unlocated: 'true', status: 'active', limit: 10 } });
      if (tenantRef.current !== activeTenantId) return;
      const box = (data.data as ReceiveBox[] | undefined)?.find((item) => item.qrCode === code && item.locationId === null && item.tenantId === activeTenantId);
      if (!box) { toast.error(t('warehouseReceive.boxNotFound')); return; }
      if (boxes.some((item) => item.id === box.id)) { toast(t('warehouseReceive.duplicate')); return; }
      setBoxes((current) => current.some((item) => item.id === box.id) ? current : [...current, box]);
      toast.success(t('warehouseReceive.boxAdded', { number: box.boxNumber }));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
    } finally {
      busyRef.current = false;
      setIsResolving(false);
    }
  };

  const handleCameraCode = (rawCode: string) => {
    const code = rawCode.trim();
    const now = Date.now();
    if (!code || busyRef.current || (lastCameraRef.current.code === code && now - lastCameraRef.current.at < 1500)) return;
    lastCameraRef.current = { code, at: now };
    void processCode(code);
  };

  const receive = async () => {
    if (!destination || boxes.length === 0 || busyRef.current) return;
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
      {!isScanning ? <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => setIsScanning(true)}><Camera size={17} />{t('labels.startCamera')}</button> : <>
        <QrCameraScanner id="archivecore-receive-scanner" onCode={handleCameraCode} onError={() => { toast.error(t('labels.cameraError')); setIsScanning(false); }} />
        <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setIsScanning(false)}>{t('labels.stopCamera')}</button>
      </>}
      <form onSubmit={(event) => { event.preventDefault(); if (!isResolving) { void processCode(manualCode); setManualCode(''); } }}>
        <label htmlFor="receive-code" className="label-text">{t('warehouseReceive.manualCode')}</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input id="receive-code" className="input-field font-mono" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="AC:... / ACLOC:..." />
          <button type="submit" className="btn-secondary shrink-0" disabled={!manualCode.trim() || isResolving}>{isResolving && <Loader2 size={16} className="animate-spin" />}{t('warehouseReceive.addCode')}</button>
        </div>
      </form>
    </section>
    <section className="card space-y-3">
      <h2 className="font-semibold">{t('warehouseReceive.boxes', { count: boxes.length })}</h2>
      <BoxPicker value={boxes} onChange={setBoxes} tenantId={activeTenantId} unlocatedOnly placeholder={t('warehouseReceive.findBox')} showSelectedChips={false} />
      {boxes.length === 0 ? <p className="text-sm text-gray-500">{t('warehouseReceive.noBoxes')}</p> : <ul className="divide-y divide-gray-100">
        {boxes.map((box) => <li key={box.id} className="py-2 flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0"><Link to={`/boxes/${box.id}`} className="font-medium text-primary-700 hover:underline">{box.boxNumber}</Link><p className="break-words">{box.title}</p></div>
          <button type="button" className="p-2 text-gray-500 hover:text-red-600" onClick={() => setBoxes((current) => current.filter((item) => item.id !== box.id))} aria-label={`${t('common.remove')} ${box.boxNumber}`}><X size={18} /></button>
        </li>)}
      </ul>}
    </section>
    <section className="card space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><MapPin size={19} />{t('warehouseReceive.destination')}</h2>
      <LocationPicker value={destination?.id || ''} onChange={(id) => { if (!id) setDestination(null); }} onLocationChange={(location) => setDestination(location ? { id: location.id, fullPath: location.fullPath } : null)} excludeTypes={['warehouse', 'zone', 'rack']} placeholder={t('warehouseReceive.chooseDestination')} tenantId={activeTenantId} />
      {destination && <p className="text-sm break-words">{destination.fullPath}</p>}
      <label htmlFor="receive-notes" className="label-text">{t('warehouseReceive.notes')}</label>
      <textarea id="receive-notes" className="input-field w-full" rows={2} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
    </section>
    <button type="button" className="btn-primary w-full" disabled={!destination || boxes.length === 0 || isReceiving || isResolving} onClick={() => { void receive(); }}>
      {isReceiving ? <Loader2 size={18} className="animate-spin" /> : <PackageCheck size={18} />}{t('warehouseReceive.receiveCount', { count: boxes.length })}
    </button>
    {ConfirmDialogElement}
  </div>;
}
