import { useTranslation } from 'react-i18next';
import { Check, Loader2, RefreshCw, X } from 'lucide-react';

interface Props {
  codes: string[];
  verifiedCodes: string[];
  online: boolean;
  syncing: boolean;
  onSync: () => void;
  onRemove: (code: string) => void;
}

export default function OfflineScanPanel({ codes, verifiedCodes, online, syncing, onSync, onRemove }: Props) {
  const { t } = useTranslation();
  if (codes.length === 0) return null;

  return <section className="card space-y-3 border-amber-300 bg-amber-50" aria-label={t('offlineScans.title')}>
    <h2 className="font-semibold text-amber-950">{t('offlineScans.title', { count: codes.length })}</h2>
    <p className="text-sm text-amber-950">{t('offlineScans.description')}</p>
    <ul className="max-h-40 overflow-y-auto divide-y divide-amber-200">
      {codes.map((code) => <li key={code} className="flex items-center justify-between gap-2 py-1 text-sm">
        <span className="font-mono break-all flex items-center gap-2">{verifiedCodes.includes(code) && <Check size={16} className="text-green-700 shrink-0" aria-label={t('offlineScans.verified')} />}{code}</span>
        <button type="button" className="p-2 text-gray-600 hover:text-red-700" disabled={syncing} onClick={() => onRemove(code)} aria-label={t('offlineScans.remove', { code })}><X size={16} /></button>
      </li>)}
    </ul>
    <button type="button" className="btn-secondary" disabled={!online || syncing} onClick={onSync}>
      {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
      {t('offlineScans.verify')}
    </button>
  </section>;
}
