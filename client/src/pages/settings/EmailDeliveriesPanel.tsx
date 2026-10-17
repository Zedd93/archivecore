import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Loader2, RotateCcw } from 'lucide-react';
import api from '@/services/api';
import { getApiErrorMessage } from '@/utils/apiError';
import { useConfirm } from '@/hooks/useConfirm';

type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
type FilterStatus = DeliveryStatus | 'all';

interface Delivery {
  id: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
  title: string;
  recipientEmail: string;
  tenantName: string | null;
}

interface DeliveryPage {
  smtpConfigured: boolean;
  items: Delivery[];
  total: number;
  page: number;
  limit: number;
  counts: Record<DeliveryStatus, number>;
}

const STATUSES: DeliveryStatus[] = ['pending', 'sending', 'sent', 'failed', 'skipped'];

export default function EmailDeliveriesPanel() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<FilterStatus>('all');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['notification-email-deliveries', page, status],
    queryFn: async () => {
      const response = await api.get('/notifications/email-deliveries', {
        params: { page, ...(status === 'all' ? {} : { status }) },
      });
      return response.data.data as DeliveryPage;
    },
    refetchInterval: 30_000,
  });
  const retry = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/notifications/email-deliveries/${id}/retry`);
      return response.data.data as { status: DeliveryStatus };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['notification-email-deliveries'] });
      toast.success(t(result.status === 'pending'
        ? 'settings.notifications.emailDelivery.retryQueued'
        : 'settings.notifications.emailDelivery.retrySkipped'));
    },
    onError: (error) => toast.error(getApiErrorMessage(error, t('settings.notifications.emailDelivery.retryError'))),
  });

  const formatDate = (date: string) => new Date(date).toLocaleString(i18n.language);
  async function retryDelivery(item: Delivery) {
    const approved = await confirm({
      title: t('settings.notifications.emailDelivery.retry'),
      message: t('settings.notifications.emailDelivery.retryConfirm', { recipient: item.recipientEmail }),
      confirmLabel: t('settings.notifications.emailDelivery.retry'),
      variant: 'warning',
    });
    if (approved) retry.mutate(item.id);
  }

  return (
    <div className="card p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{t('settings.notifications.emailDelivery.title')}</h2>
        <p className="text-sm text-gray-500">{t('settings.notifications.emailDelivery.description')}</p>
      </div>
      {data && !data.smtpConfigured && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          {t('settings.notifications.emailDelivery.smtpDisabled')}
        </p>
      )}
      {data && (
        <div className="flex flex-wrap gap-2 text-xs" aria-label={t('settings.notifications.emailDelivery.counts')}>
          {STATUSES.map((key) => (
            <span key={key} className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">
              {t(`settings.notifications.emailDelivery.status.${key}`)}: {data.counts[key]}
            </span>
          ))}
        </div>
      )}
      <div>
        <label htmlFor="email-delivery-filter" className="label-text">{t('settings.notifications.emailDelivery.filter')}</label>
        <select id="email-delivery-filter" className="input-field mt-1 w-full sm:w-56" value={status}
          onChange={(event) => { setStatus(event.target.value as FilterStatus); setPage(1); }}>
          <option value="all">{t('settings.notifications.emailDelivery.all')}</option>
          {STATUSES.map((key) => <option key={key} value={key}>{t(`settings.notifications.emailDelivery.status.${key}`)}</option>)}
        </select>
      </div>
      {isLoading && <p className="text-sm text-gray-500" role="status">{t('common.loading')}</p>}
      {isError && <p className="text-sm text-red-700" role="alert">{t('settings.notifications.emailDelivery.loadError')}</p>}
      {data?.items.length === 0 && <p className="text-sm text-gray-500">{t('settings.notifications.emailDelivery.empty')}</p>}
      <div className="space-y-2">
        {data?.items.map((item) => (
          <div key={item.id} className="min-w-0 rounded-lg border border-gray-200 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 break-words">{item.title}</p>
                <p className="text-gray-600 break-all">{item.recipientEmail}</p>
                {item.tenantName && <p className="text-gray-500 break-words">{item.tenantName}</p>}
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                {t(`settings.notifications.emailDelivery.status.${item.status}`)}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {t('settings.notifications.emailDelivery.created')}: {formatDate(item.createdAt)} · {t('settings.notifications.emailDelivery.attempts')}: {item.attempts}
            </p>
            {item.status === 'sent' && item.sentAt && <p className="text-xs text-gray-500">{t('settings.notifications.emailDelivery.sentAt')}: {formatDate(item.sentAt)}</p>}
            {item.status === 'pending' && <p className="text-xs text-gray-500">{t('settings.notifications.emailDelivery.nextAttempt')}: {formatDate(item.nextAttemptAt)}</p>}
            {item.lastError && <p className="mt-1 text-xs text-red-700 break-words">{item.lastError}</p>}
            {item.status === 'failed' && data.smtpConfigured && (
              <button type="button" className="btn-secondary mt-2 inline-flex items-center gap-2"
                disabled={retry.isPending} onClick={() => { void retryDelivery(item); }}>
                {retry.isPending && retry.variables === item.id ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
                {t('settings.notifications.emailDelivery.retry')}
              </button>
            )}
          </div>
        ))}
      </div>
      {data && data.total > data.limit && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 text-sm">
          <span>{t('settings.notifications.emailDelivery.page', { page: data.page, total: Math.ceil(data.total / data.limit) })}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>{t('settings.notifications.emailDelivery.previous')}</button>
            <button type="button" className="btn-secondary" disabled={page * data.limit >= data.total} onClick={() => setPage((value) => value + 1)}>{t('settings.notifications.emailDelivery.next')}</button>
          </div>
        </div>
      )}
      {ConfirmDialogElement}
    </div>
  );
}
