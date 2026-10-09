import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, Download, Loader2, MapPin, RotateCcw, ScanLine, Volume2, VolumeX, X } from 'lucide-react';
import { parseLocationQrData, parseQrData, type InventoryDiscrepancyKind } from '@archivecore/shared';
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

interface ScannedBox extends InventoryBox {
  scanId: string;
}

interface InventorySession {
  id: string;
  status: 'in_progress' | 'completed';
  finishedAt: string | null;
  snapshot: Snapshot;
  scanned: ScannedBox[];
  discrepancies: InventoryDiscrepancy[];
}

interface InventoryDiscrepancy {
  boxId: string;
  kind: InventoryDiscrepancyKind;
  status: 'open' | 'resolved';
  history: Array<{
    id: string;
    action: 'resolved' | 'reopened';
    note: string;
    createdAt: string;
    user: { firstName: string; lastName: string };
  }>;
}

interface SessionSummary {
  id: string;
  locationPath: string;
  status: InventorySession['status'];
  startedAt: string;
  finishedAt: string | null;
}

interface SessionHistory {
  sessions: SessionSummary[];
  page: number;
  totalPages: number;
  total: number;
}

type ScanFeedbackKind = 'success' | 'warning' | 'duplicate' | 'error';

const scanFeedbackStyles: Record<ScanFeedbackKind, string> = {
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

export default function InventoryPage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const activeTenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const [session, setSession] = useState<InventorySession | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedDiscrepancy, setSelectedDiscrepancy] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [scanFeedback, setScanFeedback] = useState<{ kind: ScanFeedbackKind; message: string } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const busyRef = useRef(false);
  const lastCameraCodeRef = useRef('');
  const audioContextRef = useRef<AudioContext | null>(null);
  const snapshot = session?.snapshot || null;
  const scanned = session?.scanned || [];
  const isFinished = session?.status === 'completed';

  useEffect(() => () => {
    if (audioContextRef.current) void audioContextRef.current.close();
  }, []);

  const unlockSound = () => {
    if (!window.AudioContext) return;
    try {
      audioContextRef.current ??= new AudioContext();
      void audioContextRef.current.resume();
    } catch {
      // The visual result remains available when audio is blocked.
    }
  };

  const showScanFeedback = (kind: ScanFeedbackKind, message: string) => {
    setScanFeedback({ kind, message });
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
        oscillator.start(start);
        oscillator.stop(start + 0.13);
      });
    } catch {
      // Audio is optional; never interrupt a scan because of device support.
    }
  };

  const { data: history, isLoading: isHistoryLoading, isError: isHistoryError, refetch: refetchHistory } = useQuery<SessionHistory>({
    queryKey: ['inventory-sessions', activeTenantId, historyPage],
    enabled: Boolean(activeTenantId && hasPermission('inventory.manage')),
    queryFn: async () => {
      const { data } = await api.get('/inventory/sessions', { params: { page: historyPage } });
      return data.data;
    },
  });
  const recentSessions = history?.sessions || [];

  const startSnapshot = async (locationId: string, force = false) => {
    if (!locationId || busyRef.current) return false;
    if (!force && session?.status === 'in_progress' && snapshot?.location.id === locationId) return true;
    if (session?.status === 'in_progress' && scanned.length > 0
      && !window.confirm(t('inventory.replaceConfirm'))) return false;
    busyRef.current = true;
    setIsBusy(true);
    try {
      const { data } = await api.post('/inventory/sessions', { locationId });
      setSession(data.data);
      setSelectedDiscrepancy('');
      setResolutionNote('');
      setManualCode('');
      setScanFeedback(null);
      setHistoryPage(1);
      await queryClient.invalidateQueries({ queryKey: ['inventory-sessions', activeTenantId] });
      toast.success(t('inventory.started'));
      return true;
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
      return false;
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  const openSession = async (id: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    setIsScanning(false);
    try {
      const { data } = await api.get(`/inventory/sessions/${encodeURIComponent(id)}`);
      setSession(data.data);
      setSelectedDiscrepancy('');
      setResolutionNote('');
      setManualCode('');
      setScanFeedback(null);
      lastCameraCodeRef.current = '';
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
    const locationQr = parseLocationQrData(code);
    if (locationQr) {
      if (!locationQr.isValid) { showScanFeedback('error', t('inventory.invalidCode')); return; }
      if (await startSnapshot(locationQr.locationId)) showScanFeedback('success', t('inventory.locationScanned'));
      return;
    }
    if (isFinished) { showScanFeedback('error', t('inventory.finishedHint')); return; }
    if (!parseQrData(code)?.isValid) { showScanFeedback('error', t('inventory.invalidCode')); return; }
    if (!snapshot || !session) { showScanFeedback('error', t('inventory.chooseLocationFirst')); return; }
    const existing = scanned.find((box) => box.qrCode === code);
    if (existing) { showScanFeedback('duplicate', t('inventory.duplicateBox', { number: existing.boxNumber })); return; }

    busyRef.current = true;
    setIsBusy(true);
    try {
      const { data } = await api.post(`/inventory/sessions/${session.id}/scans`, { code });
      const updated = data.data as InventorySession;
      setSession(updated);
      const box = updated.scanned.find((item) => item.qrCode === code);
      if (!box) throw new Error(t('common.genericError'));
      const isExpected = snapshot.expected.some((item) => item.id === box.id);
      showScanFeedback(isExpected ? 'success' : 'warning', t(isExpected ? 'inventory.scannedBox' : 'inventory.discrepancyBox', { number: box.boxNumber }));
    } catch (error) {
      showScanFeedback('error', getApiErrorMessage(error, t('common.genericError')));
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

  const undoLast = async () => {
    if (!session || scanned.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    try {
      const last = scanned[scanned.length - 1];
      const { data } = await api.post(`/inventory/sessions/${session.id}/scans/${last.scanId}/void`);
      setSession(data.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  const finishSession = async () => {
    if (!session || !result || busyRef.current) return;
    if (result.missing.length > 0 && !window.confirm(t('inventory.finishConfirm', { count: result.missing.length }))) return;
    busyRef.current = true;
    setIsBusy(true);
    setIsScanning(false);
    try {
      const { data } = await api.post(`/inventory/sessions/${session.id}/finish`);
      setSession(data.data);
      await queryClient.invalidateQueries({ queryKey: ['inventory-sessions', activeTenantId] });
      toast.success(t('inventory.finished'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  const saveResolution = async (item: InventoryDiscrepancy) => {
    if (!session || resolutionNote.trim().length < 5 || busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    try {
      const action = item.status === 'open' ? 'resolved' : 'reopened';
      const { data } = await api.post(`/inventory/sessions/${session.id}/discrepancies/${item.boxId}/${item.kind}/resolution`, {
        action, note: resolutionNote.trim(),
      });
      setSession(data.data);
      setSelectedDiscrepancy('');
      setResolutionNote('');
      toast.success(t('inventory.resolutionSaved'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  const downloadReport = () => {
    if (!snapshot || !result || !isFinished) return;
    const resolutionColumns = (boxId: string, kind: InventoryDiscrepancyKind) => {
      const item = session?.discrepancies.find((entry) => entry.boxId === boxId && entry.kind === kind);
      return [item ? t(`inventory.resolutionStatus.${item.status}`) : '', item?.history.at(-1)?.note || ''];
    };
    const rows = [
      [t('inventory.title'), snapshot.location.fullPath, '', '', '', ''],
      [t('inventory.sessionNumber'), session?.id || '', '', '', '', ''],
      [t('inventory.snapshotAt'), new Date(snapshot.capturedAt).toLocaleString(), '', '', '', ''],
      [t('inventory.finishedAt'), session?.finishedAt ? new Date(session.finishedAt).toLocaleString() : '', '', '', '', ''],
      [t('inventory.csvResult'), t('boxes.boxNumber'), t('common.title'), t('boxes.location'), t('inventory.resolution'), t('inventory.resolutionNote')],
      ...result.matched.map((box) => [t('inventory.matched'), box.boxNumber, box.title, snapshot.location.fullPath, '', '']),
      ...result.missing.map((box) => [t('inventory.missing'), box.boxNumber, box.title, snapshot.location.fullPath, ...resolutionColumns(box.id, 'missing')]),
      ...result.wrongLocation.map((box) => [t('inventory.wrongLocation'), box.boxNumber, box.title, box.location?.fullPath || '', ...resolutionColumns(box.id, 'wrong_location')]),
      ...result.unexpected.map((box) => [t('inventory.unexpected'), box.boxNumber, box.title, snapshot.location.fullPath, ...resolutionColumns(box.id, 'unexpected')]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escapeInventoryCsvCell).join(';')).join('\r\n')}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `kontrola-polki-${new Date().toISOString().replace(/:/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const discrepancyBoxes = result ? [
    ...result.missing.map((box) => ({ box, kind: 'missing' as const })),
    ...result.wrongLocation.map((box) => ({ box, kind: 'wrong_location' as const })),
    ...result.unexpected.map((box) => ({ box, kind: 'unexpected' as const })),
  ] : [];

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
        <h2 className="font-semibold">{t('inventory.recentSessions')}</h2>
        {isHistoryLoading ? <p className="text-sm text-gray-500">{t('common.loading')}</p> : isHistoryError ? (
          <button type="button" className="btn-secondary" onClick={() => { void refetchHistory(); }}>{t('common.tryAgain')}</button>
        ) : recentSessions.length === 0 ? <p className="text-sm text-gray-500">{t('inventory.noSessions')}</p> : (
          <ul className="divide-y divide-gray-100 max-h-60 overflow-y-auto">
            {recentSessions.map((item) => (
              <li key={item.id}>
                <button type="button" className={`w-full py-2 text-left text-sm hover:text-primary-700 ${session?.id === item.id ? 'font-semibold text-primary-700' : ''}`} disabled={isBusy} onClick={() => { void openSession(item.id); }}>
                  <span className="block break-words">{item.locationPath}</span>
                  <span className="text-xs text-gray-500">{new Date(item.startedAt).toLocaleString()} · {t(`inventory.status.${item.status}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {history && history.totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <button type="button" className="btn-secondary" disabled={historyPage <= 1 || isBusy} onClick={() => setHistoryPage((page) => page - 1)}>{t('inventory.previousPage')}</button>
            <span>{t('inventory.pageCount', { page: history.page, pages: history.totalPages })}</span>
            <button type="button" className="btn-secondary" disabled={historyPage >= history.totalPages || isBusy} onClick={() => setHistoryPage((page) => page + 1)}>{t('inventory.nextPage')}</button>
          </div>
        )}
      </section>
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
          <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => { unlockSound(); lastCameraCodeRef.current = ''; setIsScanning(true); }}><Camera size={17} />{t('labels.startCamera')}</button>
        ) : (
          <>
            <QrCameraScanner id="archivecore-inventory-scanner" onCode={handleCameraCode} onError={() => { setScanFeedback({ kind: 'error', message: t('labels.cameraError') }); setIsScanning(false); }} />
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setIsScanning(false)}>{t('labels.stopCamera')}</button>
          </>
        )}
        <button type="button" className="btn-secondary w-full sm:w-auto" aria-pressed={soundEnabled} onClick={() => { if (!soundEnabled) unlockSound(); setSoundEnabled((enabled) => !enabled); }}>
          {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}{t(soundEnabled ? 'inventory.muteSound' : 'inventory.unmuteSound')}
        </button>
        {scanFeedback && (
          <div role="status" aria-live="polite" className={`rounded-lg border px-4 py-3 text-sm font-semibold break-words ${scanFeedbackStyles[scanFeedback.kind]}`}>
            {t(`inventory.scanResult.${scanFeedback.kind}`)}: {scanFeedback.message}
          </div>
        )}
        <form onSubmit={(event) => { event.preventDefault(); void processCode(manualCode); setManualCode(''); }}>
          <label htmlFor="inventory-code" className="label-text">{t('inventory.manualCode')}</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input id="inventory-code" className="input-field font-mono" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="ACLOC:... / AC:..." />
            <button type="submit" className="btn-secondary shrink-0" disabled={!manualCode.trim() || isBusy}>{isBusy ? <Loader2 size={16} className="animate-spin" /> : null}{t('inventory.addCode')}</button>
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
            {!isFinished ? <button type="button" className="btn-primary" disabled={isBusy} onClick={() => { void finishSession(); }}><Check size={16} />{t('inventory.finish')}</button> : <button type="button" className="btn-secondary" onClick={downloadReport}><Download size={16} />{t('inventory.download')}</button>}
            <button type="button" className="btn-secondary" disabled={isBusy || !session} onClick={() => { if (session) void openSession(session.id); }}><RotateCcw size={16} />{t('inventory.refresh')}</button>
            <button type="button" className="btn-secondary" disabled={isBusy} onClick={() => { void startSnapshot(snapshot.location.id, true); }}><RotateCcw size={16} />{t('inventory.restart')}</button>
            {!isFinished && <button type="button" className="btn-secondary" onClick={() => { void undoLast(); }} disabled={scanned.length === 0 || isBusy}><X size={16} />{t('inventory.undoLast')}</button>}
          </div>
          <p className="text-sm text-amber-700">{t(isFinished ? 'inventory.finishedWarning' : 'inventory.draftWarning')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {section(t('inventory.matched'), result.matched, 'text-green-700')}
            {section(t(isFinished ? 'inventory.missing' : 'inventory.remaining'), result.missing, 'text-red-700')}
            {section(t('inventory.wrongLocation'), result.wrongLocation, 'text-amber-700')}
            {section(t('inventory.unexpected'), result.unexpected, 'text-purple-700')}
          </div>
          {isFinished && session && (
            <section className="card space-y-3">
              <h2 className="font-semibold">{t('inventory.resolution')} ({session.discrepancies.filter((item) => item.status === 'open').length} {t('inventory.openCount')})</h2>
              <p className="text-sm text-gray-500">{t('inventory.resolutionHint')}</p>
              {discrepancyBoxes.length === 0 ? <p className="text-sm text-gray-500">{t('inventory.noDiscrepancies')}</p> : (
                <ul className="divide-y divide-gray-100">
                  {discrepancyBoxes.map(({ box, kind }) => {
                    const item = session.discrepancies.find((entry) => entry.boxId === box.id && entry.kind === kind);
                    if (!item) return null;
                    const key = `${kind}:${box.id}`;
                    return <li key={key} className="py-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Link to={`/boxes/${box.id}`} className="font-semibold text-primary-700 hover:underline">{box.boxNumber}</Link>
                        <span className="break-words">{box.title}</span>
                        <span className="text-gray-500">{t(`inventory.discrepancyKind.${kind}`)}</span>
                        <span className={item.status === 'resolved' ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'}>{t(`inventory.resolutionStatus.${item.status}`)}</span>
                      </div>
                      {item.history.length > 0 && <ul className="space-y-1 text-xs text-gray-600">
                        {item.history.map((event) => <li key={event.id} className="break-words">
                          {new Date(event.createdAt).toLocaleString()} · {event.user.firstName} {event.user.lastName} · {t(`inventory.resolutionAction.${event.action}`)}: {event.note}
                        </li>)}
                      </ul>}
                      {selectedDiscrepancy === key ? <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void saveResolution(item); }}>
                        <label htmlFor="inventory-resolution-note" className="label-text">{t('inventory.resolutionNote')}</label>
                        <textarea id="inventory-resolution-note" className="input-field w-full" maxLength={1000} rows={2} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder={t('inventory.resolutionPlaceholder')} />
                        <div className="flex gap-2">
                          <button type="submit" className="btn-primary" disabled={resolutionNote.trim().length < 5 || isBusy}>{t(item.status === 'open' ? 'inventory.markResolved' : 'inventory.reopen')}</button>
                          <button type="button" className="btn-secondary" onClick={() => { setSelectedDiscrepancy(''); setResolutionNote(''); }}>{t('common.cancel')}</button>
                        </div>
                      </form> : <button type="button" className="btn-secondary" disabled={isBusy} onClick={() => { setSelectedDiscrepancy(key); setResolutionNote(''); }}>{t(item.status === 'open' ? 'inventory.markResolved' : 'inventory.reopen')}</button>}
                    </li>;
                  })}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
