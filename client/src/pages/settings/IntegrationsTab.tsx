import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clipboard, KeyRound, Loader2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { getApiErrorMessage } from '@/utils/apiError';
import { useConfirm } from '@/hooks/useConfirm';
import { useAuth } from '@/contexts/AuthContext';

interface IntegrationKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export default function IntegrationsTab() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { confirm, ConfirmDialogElement } = useConfirm();
  const { user } = useAuth();
  const tenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const { data: keys, isLoading } = useQuery({
    queryKey: ['integration-keys', tenantId],
    queryFn: async () => {
      const { data } = await api.get('/integrations/keys');
      return data.data as IntegrationKey[];
    },
    enabled: Boolean(tenantId),
  });

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim().length < 3 || saving) return;
    setSaving(true);
    try {
      const { data } = await api.post('/integrations/keys', { name: name.trim(), expiresInDays });
      setSecret(data.data.secret);
      setName('');
      await queryClient.invalidateQueries({ queryKey: ['integration-keys', tenantId] });
      toast.success(t('settings.integrations.created'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('settings.integrations.createError')));
    } finally {
      setSaving(false);
    }
  }

  async function revokeKey(key: IntegrationKey) {
    const approved = await confirm({
      title: t('settings.integrations.revoke'),
      message: t('settings.integrations.revokeConfirm', { name: key.name }),
      confirmLabel: t('settings.integrations.revoke'),
      variant: 'danger',
    });
    if (!approved) return;
    try {
      await api.delete(`/integrations/keys/${key.id}`);
      await queryClient.invalidateQueries({ queryKey: ['integration-keys', tenantId] });
      toast.success(t('settings.integrations.revoked'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('settings.integrations.revokeError')));
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success(t('settings.integrations.copied'));
    } catch {
      toast.error(t('settings.integrations.copyError'));
    }
  }

  const formatDate = (date: string) => new Date(date).toLocaleDateString(i18n.language);

  return (
    <div className="card p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><KeyRound size={20} />{t('settings.integrations.title')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('settings.integrations.description')}</p>
      </div>

      {!tenantId ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('settings.integrations.selectTenant')}</p> : <>

      {secret && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2">
          <p className="font-medium text-amber-900">{t('settings.integrations.secretOnce')}</p>
          <code className="block break-all rounded bg-white p-2 text-xs text-gray-800 select-all">{secret}</code>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => { void copySecret(); }}><Clipboard size={16} />{t('settings.integrations.copy')}</button>
            <button type="button" className="btn-secondary" onClick={() => setSecret(null)}>{t('settings.integrations.closeSecret')}</button>
          </div>
        </div>
      )}

      <form onSubmit={(event) => { void createKey(event); }} className="space-y-3 border-t border-gray-100 pt-4">
        <label htmlFor="integration-key-name" className="label-text">{t('settings.integrations.keyName')}</label>
        <input id="integration-key-name" className="input-field" value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={100} required />
        <label htmlFor="integration-key-expiry" className="label-text">{t('settings.integrations.expiry')}</label>
        <select id="integration-key-expiry" className="input-field" value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))}>
          {[30, 90, 365].map((days) => <option key={days} value={days}>{t('settings.integrations.days', { count: days })}</option>)}
        </select>
        <button type="submit" disabled={saving || name.trim().length < 3} className="btn-primary flex items-center gap-2">
          {saving && <Loader2 size={16} className="animate-spin" />}{t('settings.integrations.create')}
        </button>
      </form>

      <div className="border-t border-gray-100 pt-4 space-y-2">
        <h3 className="font-semibold">{t('settings.integrations.existing')}</h3>
        {isLoading ? <Loader2 size={20} className="animate-spin" /> : keys?.length ? (
          <ul className="divide-y divide-gray-100">
            {keys.map((key) => {
              const active = !key.revokedAt && new Date(key.expiresAt) > new Date();
              return (
                <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{key.name} <span className={active ? 'text-green-700' : 'text-gray-500'}>({active ? t('settings.integrations.active') : t('settings.integrations.inactive')})</span></p>
                    <p className="text-xs text-gray-500 break-all">{key.keyPrefix} · {t('settings.integrations.expiresAt')}: {formatDate(key.expiresAt)} · {t('settings.integrations.lastUsed')}: {key.lastUsedAt ? formatDate(key.lastUsedAt) : t('settings.integrations.never')}</p>
                  </div>
                  {active && <button type="button" onClick={() => { void revokeKey(key); }} className="btn-secondary flex items-center gap-1 text-red-700" aria-label={`${t('settings.integrations.revoke')} ${key.name}`}><Trash2 size={14} />{t('settings.integrations.revoke')}</button>}
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-gray-500">{t('settings.integrations.noKeys')}</p>}
      </div>

      <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
        <p className="font-medium">{t('settings.integrations.apiHint')}</p>
        <code className="block break-all">GET /api/v1/orders</code>
        <code className="block break-all">GET /api/v1/orders/:id</code>
        <p>{t('settings.integrations.authHint')}</p>
      </div>
      </>}
      {ConfirmDialogElement}
    </div>
  );
}
