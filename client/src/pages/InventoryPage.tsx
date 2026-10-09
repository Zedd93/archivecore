import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, Check, Download, Loader2, MapPin, RotateCcw, ScanLine, X } from 'lucide-react';
import { parseLocationQrData, parseQrData } from '@archivecore/shared';
import toast from 'react-hot-toast';
import api from '@/services/api';
import QrCameraScanner from '@/components/ui/QrCameraScanner';
import LocationPicker from '@/components/ui/LocationPicker';
import { useAuth } from '@/contexts/AuthContext';
import { getApiErrorMessage } from '@/utils/apiError';
import { escapeInventoryCsvCell, reconcileInventory, type InventoryBox } from '@/utils/inventory';

interface Snapshot {
  location: { id: string; fullPath: string };
  expected: InventoryBox[];
  excludedCount: number;
  capturedAt: string;
}

export default function InventoryPage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const activeTenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [scanned, setScanned] = useState<InventoryBox[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [isFinished, setIsFinished] = useState(false);
  const busyRef = useRef(false);
  const lastCameraCodeRef = useRef('');

  const startSnapshot = async (locationId: string) => {
    if (!locationId || busyRef.current) return;
    if (snapshot && (snapshot.location.id !== locationId || scanned.length > 0)
      && !window.confirm(t('inventory.replaceConfirm'))) return;
    busyRef.current = true;
    setIsBusy(true);
    try {
      const { data } = await api.get(`/inventory/locations/${encodeURIComponent(locationId)}/snapshot`);
      setSnapshot(data.data);
      setScanned([]);
      setIsFinished(false);
      setManualCode('');
      lastCameraCodeRef.current = '';
      toast.success(t('inventory.started'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  const processCode = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || busyRef.current || !activeTenantId) return;
    if (isFinished) { toast.error(t('inventory.finishedHint')); return; }
    const locationQr = parseLocationQrData(code);
    if (locationQr) {
      if (!locationQr.isValid) { toast.error(t('inventory.invalidCode')); return; }
      await startSnapshot(locationQr.locationId);
      return;
    }
    if (!parseQrData(code)?.isValid) { toast.error(t('inventory.invalidCode')); return; }
    if (!snapshot) { toast.error(t('inventory.chooseLocationFirst')); return; }
    if (scanned.some((box) => box.qrCode === code)) { toast(t('inventory.duplicate')); return; }

    busyRef.current = true;
    setIsBusy(true);
    try {
      const { data } = await api.get('/inventory/boxes/resolve', { params: { code } });
      const box = data.data as InventoryBox;
      setScanned((current) => current.some((item) => item.id === box.id) ? current : [...current, box]);
      const isExpected = snapshot.expected.some((item) => item.id === box.id);
      toast[isExpected ? 'success' : 'error'](isExpected ? t('inventory.scanned') : t('inventory.discrepancyToast'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  const handleCameraCode = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed || busyRef.current || lastCameraCodeRef.current === trimmed) return;
    lastCameraCodeRef.current = trimmed;
    void processCode(trimmed);
  };

  const result = snapshot ? reconcileInventory(snapshot.location.id, snapshot.expected, scanned) : null;

  const downloadReport = () => {
    if (!snapshot || !result || !isFinished) return;
    const rows = [
      [t('inventory.title'), snapshot.location.fullPath, '', ''],
      [t('inventory.snapshotAt'), new Date(snapshot.capturedAt).toLocaleString(), '', ''],
      [t('inventory.csvResult'), t('boxes.boxNumber'), t('common.title'), t('boxes.location')],
      ...result.matched.map((box) => [t('inventory.matched'), box.boxNumber, box.title, snapshot.location.fullPath]),
      ...result.missing.map((box) => [t('inventory.missing'), box.boxNumber, box.title, snapshot.location.fullPath]),
      ...result.wrongLocation.map((box) => [t('inventory.wrongLocation'), box.boxNumber, box.title, box.location?.fullPath || '']),
      ...result.unexpected.map((box) => [t('inventory.unexpected'), box.boxNumber, box.title, snapshot.location.fullPath]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escapeInventoryCsvCell).join(';')).join('\r\n')}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `kontrola-polki-${new Date().toISOString().replace(/:/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const section = (title: string, boxes: InventoryBox[], color: string) => (
    <section className="card space-y-2">
      <h2 className={`font-semibold ${color}`}>{title} ({boxes.length})</h2>
      {boxes.length === 0 ? <p className="text-sm text-gray-500">{t('inventory.none')}</p> : (
        <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
          {boxes.map((box) => (
            <li key={box.id} className="py-2 text-sm">
              <Link to={`/boxes/${box.id}`} className="font-medium text-primary-700 hover:underline">{box.boxNumber}</Link>
              <span className="ml-2 break-words">{box.title}</span>
              {box.locationId !== snapshot?.location.id && <p className="text-xs text-gray-500 break-words">{box.location?.fullPath || t('inventory.noLocation')}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  if (!hasPermission('inventory.manage')) return <div className="card">{t('inventory.noPermission')}</div>;
  if (!activeTenantId) return <div className="card">{t('warehouseMove.chooseTenant')}</div>;

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('inventory.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('inventory.subtitle')}</p>
      </div>
      <section className="card space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><MapPin size={19} />{t('inventory.location')}</h2>
        <LocationPicker
          value={snapshot?.location.id || ''}
          onChange={(id) => { if (id) void startSnapshot(id); }}
          excludeTypes={['warehouse', 'zone', 'rack']}
          placeholder={t('inventory.chooseLocation')}
        />
        {snapshot && <p className="text-sm break-words">{snapshot.location.fullPath}</p>}
        {snapshot && <p className="text-xs text-gray-500">{t('inventory.snapshotAt')}: {new Date(snapshot.capturedAt).toLocaleString()} · {t('inventory.excluded', { count: snapshot.excludedCount })}</p>}
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><ScanLine size={19} />{t('inventory.scanner')}</h2>
        {!isScanning ? (
          <button type="button" className="btn-primary w-full sm:w-auto" disabled={isFinished} onClick={() => { lastCameraCodeRef.current = ''; setIsScanning(true); }}><Camera size={17} />{t('labels.startCamera')}</button>
        ) : (
          <>
            <QrCameraScanner id="archivecore-inventory-scanner" onCode={handleCameraCode} onError={() => { toast.error(t('labels.cameraError')); setIsScanning(false); }} />
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setIsScanning(false)}>{t('labels.stopCamera')}</button>
          </>
        )}
        <form onSubmit={(event) => { event.preventDefault(); void processCode(manualCode); setManualCode(''); }}>
          <label htmlFor="inventory-code" className="label-text">{t('inventory.manualCode')}</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input id="inventory-code" className="input-field font-mono" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="ACLOC:... / AC:..." />
            <button type="submit" className="btn-secondary shrink-0" disabled={!manualCode.trim() || isBusy || isFinished}>{isBusy ? <Loader2 size={16} className="animate-spin" /> : null}{t('inventory.addCode')}</button>
          </div>
        </form>
        {!snapshot && <p className="text-sm text-gray-600">{t('inventory.chooseLocationFirst')}</p>}
      </section>
      {snapshot && result && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[[t('inventory.matched'), result.matched.length], [t(isFinished ? 'inventory.missing' : 'inventory.remaining'), result.missing.length], [t('inventory.wrongLocation'), result.wrongLocation.length], [t('inventory.unexpected'), result.unexpected.length]].map(([label, count]) => (
              <div key={label} className="card"><div className="text-xs text-gray-500">{label}</div><div className="text-2xl font-bold">{count}</div></div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            {!isFinished ? <button type="button" className="btn-primary" disabled={isBusy} onClick={() => { if (result.missing.length > 0 && !window.confirm(t('inventory.finishConfirm', { count: result.missing.length }))) return; setIsScanning(false); setIsFinished(true); }}><Check size={16} />{t('inventory.finish')}</button> : <button type="button" className="btn-secondary" onClick={downloadReport}><Download size={16} />{t('inventory.download')}</button>}
            <button type="button" className="btn-secondary" onClick={() => { void startSnapshot(snapshot.location.id); }}><RotateCcw size={16} />{t('inventory.restart')}</button>
            {!isFinished && <button type="button" className="btn-secondary" onClick={() => setScanned((current) => current.slice(0, -1))} disabled={scanned.length === 0}><X size={16} />{t('inventory.undoLast')}</button>}
          </div>
          <p className="text-sm text-amber-700">{t(isFinished ? 'inventory.finishedWarning' : 'inventory.draftWarning')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {section(t('inventory.matched'), result.matched, 'text-green-700')}
            {section(t(isFinished ? 'inventory.missing' : 'inventory.remaining'), result.missing, 'text-red-700')}
            {section(t('inventory.wrongLocation'), result.wrongLocation, 'text-amber-700')}
            {section(t('inventory.unexpected'), result.unexpected, 'text-purple-700')}
          </div>
        </>
      )}
    </div>
  );
}
