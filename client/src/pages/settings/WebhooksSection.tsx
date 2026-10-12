import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clipboard, Loader2, Trash2, Webhook } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { getApiErrorMessage } from '@/utils/apiError';
import { useConfirm } from '@/hooks/useConfirm';

interface Endpoint {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
}

interface Delivery {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  endpoint: { name: string };
}

export default function WebhooksSection({ tenantId }: { tenantId: string }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: endpoints, isLoading } = useQuery({
    queryKey: ['integration-webhooks', tenantId],
    queryFn: async () => (await api.get('/integrations/webhooks')).data.data as Endpoint[],
  });
  const { data: deliveries } = useQuery({
    queryKey: ['integration-webhook-deliveries', tenantId],
    queryFn: async () => (await api.get('/integrations/webhook-deliveries')).data.data as Delivery[],
    refetchInterval: 30_000,
  });

  async function createEndpoint(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const { data } = await api.post('/integrations/webhooks', { name: name.trim(), url: url.trim() });
      setSecret(data.data.secret);
      setName('');
      setUrl('');
      await queryClient.invalidateQueries({ queryKey: ['integration-webhooks', tenantId] });
      toast.success(t('settings.webhooks.created'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('settings.webhooks.createError')));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(endpoint: Endpoint) {
    const approved = await confirm({
      title: t('settings.webhooks.deactivate'),
      message: t('settings.webhooks.deactivateConfirm', { name: endpoint.name }),
      confirmLabel: t('settings.webhooks.deactivate'),
      variant: 'danger',
    });
    if (!approved) return;
    try {
      await api.delete(`/integrations/webhooks/${endpoint.id}`);
      await queryClient.invalidateQueries({ queryKey: ['integration-webhooks', tenantId] });
      toast.success(t('settings.webhooks.deactivated'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('settings.webhooks.deactivateError')));
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

  return (
    <section className="space-y-4 border-t border-gray-100 pt-6">
      <div>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Webhook size={18} />{t('settings.webhooks.title')}</h3>
        <p className="text-sm text-gray-500">{t('settings.webhooks.description')}</p>
      </div>

      {secret && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
        <p className="text-sm font-medium text-amber-900">{t('settings.webhooks.secretOnce')}</p>
        <code className="block break-all rounded bg-white p-2 text-xs select-all">{secret}</code>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => { void copySecret(); }}><Clipboard size={14} />{t('settings.integrations.copy')}</button>
          <button type="button" className="btn-secondary" onClick={() => setSecret(null)}>{t('settings.integrations.closeSecret')}</button>
        </div>
      </div>}

      <form onSubmit={(event) => { void createEndpoint(event); }} className="space-y-3">
        <div>
          <label htmlFor="webhook-name" className="label-text">{t('settings.webhooks.name')}</label>
          <input id="webhook-name" className="input-field" value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={100} required />
        </div>
        <div>
          <label htmlFor="webhook-url" className="label-text">{t('settings.webhooks.url')}</label>
          <input id="webhook-url" type="url" className="input-field" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/webhooks/archivecore" maxLength={2048} required />
          <p className="mt-1 text-xs text-gray-500">{t('settings.webhooks.urlHint')}</p>
        </div>
        <button type="submit" disabled={saving || name.trim().length < 3 || !url.trim()} className="btn-primary flex items-center gap-2">
          {saving && <Loader2 size={16} className="animate-spin" />}{t('settings.webhooks.create')}
        </button>
      </form>

      <div className="space-y-2">
        <h4 className="font-medium">{t('settings.webhooks.endpoints')}</h4>
        {isLoading ? <Loader2 size={18} className="animate-spin" /> : endpoints?.length ? <ul className="divide-y divide-gray-100">
          {endpoints.map((endpoint) => <li key={endpoint.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{endpoint.name} <span className={endpoint.isActive ? 'text-green-700' : 'text-gray-500'}>({endpoint.isActive ? t('settings.integrations.active') : t('settings.integrations.inactive')})</span></p>
              <p className="break-all text-xs text-gray-500">{endpoint.url}</p>
            </div>
            {endpoint.isActive && <button type="button" className="btn-secondary flex items-center gap-1 text-red-700" onClick={() => { void deactivate(endpoint); }} aria-label={`${t('settings.webhooks.deactivate')} ${endpoint.name}`}><Trash2 size={14} />{t('settings.webhooks.deactivate')}</button>}
          </li>)}
        </ul> : <p className="text-sm text-gray-500">{t('settings.webhooks.noEndpoints')}</p>}
      </div>

      <div className="space-y-2">
        <h4 className="font-medium">{t('settings.webhooks.deliveries')}</h4>
        {deliveries?.length ? <ul className="divide-y divide-gray-100">
          {deliveries.slice(0, 10).map((delivery) => <li key={delivery.id} className="py-2 text-xs text-gray-600">
            <span className="font-medium">{delivery.endpoint.name}</span> · {new Date(delivery.createdAt).toLocaleString(i18n.language)} · {t(`settings.webhooks.status.${delivery.status}`, { defaultValue: delivery.status })} · {t('settings.webhooks.attempts', { count: delivery.attempts })}
            {delivery.lastError && <span className="block text-red-700">{delivery.lastError}</span>}
          </li>)}
        </ul> : <p className="text-sm text-gray-500">{t('settings.webhooks.noDeliveries')}</p>}
      </div>
      {ConfirmDialogElement}
    </section>
  );
}
