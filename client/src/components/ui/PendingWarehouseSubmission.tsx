import { useTranslation } from 'react-i18next';
import { Loader2, RotateCw, Trash2 } from 'lucide-react';
import type { WarehouseSubmission } from '@/utils/warehouseSubmission';

interface Props {
  pending: WarehouseSubmission | null;
  busy: boolean;
  online: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}

export default function PendingWarehouseSubmission({ pending, busy, online, onRetry, onDiscard }: Props) {
  const { t } = useTranslation();
  if (!pending) return null;

  return <section className="card space-y-3 border-amber-300 bg-amber-50" role="status">
    <h2 className="font-semibold text-amber-950">{t('warehouseSubmission.title')}</h2>
    <p className="text-sm text-amber-950 break-words">{t('warehouseSubmission.description', { count: pending.ids.length, location: pending.locationLabel })}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-primary" disabled={!online || busy} onClick={onRetry}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}{t('warehouseSubmission.retry')}
      </button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={onDiscard}>
        <Trash2 size={16} />{t('warehouseSubmission.discard')}
      </button>
    </div>
  </section>;
}
