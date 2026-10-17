import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import api from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { getApiErrorMessage } from '@/utils/apiError';

export default function DocumentationLegalHoldControl({ path, held, holdReason, onChanged }: {
  path: string;
  held: boolean;
  holdReason: string | null;
  onChanged: () => void | Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const close = () => {
    if (saving) return;
    setOpen(false);
    setReason('');
  };

  const submit = async () => {
    setSaving(true);
    try {
      await api.patch(`${path}/legal-hold`, { hold: !held, reason: reason.trim() });
      await onChanged();
      toast.success(t(held ? 'documentationHold.released' : 'documentationHold.placed'));
      setOpen(false);
      setReason('');
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
    } finally {
      setSaving(false);
    }
  };

  return <>
    <div className="flex flex-wrap items-center gap-3">
      {held && <span className="badge-red flex items-center gap-1"><ShieldAlert size={14} />{t('documentationHold.active')}</span>}
      {hasPermission('retention.manage') && <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>{t(held ? 'documentationHold.release' : 'documentationHold.place')}</button>}
    </div>
    {held && holdReason && <p className="text-sm text-red-700 whitespace-pre-wrap break-words">{holdReason}</p>}
    <Modal isOpen={open} onClose={close} title={t(held ? 'documentationHold.release' : 'documentationHold.place')}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{t(held ? 'documentationHold.releaseHint' : 'documentationHold.placeHint')}</p>
        <div>
          <label htmlFor="documentation-hold-reason" className="label-text">{t(held ? 'documentationHold.releaseReason' : 'documentationHold.reason')}</label>
          <textarea id="documentation-hold-reason" className="input-field" rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" disabled={saving} onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" disabled={saving || reason.trim().length < 5} onClick={() => void submit()}>{saving ? t('common.saving') : t('common.confirm')}</button>
        </div>
      </div>
    </Modal>
  </>;
}
