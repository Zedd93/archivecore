import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Calculator, Loader2, Lock, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '@/services/api';
import Modal from '@/components/ui/Modal';
import Pagination from '@/components/ui/Pagination';
import { getApiErrorMessage } from '@/utils/apiError';

type BillingStatus = 'unpriced' | 'pending' | 'excluded' | 'invoiced';

interface BillingEvent {
  id: string;
  serviceCode: string;
  serviceName: string;
  unit: string;
  quantity: string;
  unitPrice: string | null;
  netAmount: string | null;
  occurredAt: string;
  status: BillingStatus;
  excludedReason: string | null;
  description: string | null;
  order: { id: string; orderNumber: string; orderType: string } | null;
}

interface BillingResponse {
  data: BillingEvent[];
  total: number;
  summary: Record<BillingStatus, number> & { pendingNetAmount: string };
  pagination: { page: number; limit: number; total: number; totalPages: number };
  period: {
    id: string;
    status: 'open' | 'closed';
    generatedAt: string | null;
    closedAt: string | null;
  } | null;
}

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const statusClasses: Record<BillingStatus, string> = {
  unpriced: 'badge-yellow',
  pending: 'badge-blue',
  excluded: 'badge-gray',
  invoiced: 'badge-green',
};

export default function BillingEventsPanel({ tenantId }: { tenantId: string }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [excludeTarget, setExcludeTarget] = useState<BillingEvent | null>(null);
  const [excludeReason, setExcludeReason] = useState('');

  useEffect(() => {
    setPage(1);
  }, [tenantId, month, status, limit]);

  const queryKey = ['billing-events', tenantId, month, status, page, limit];
  const { data, isLoading } = useQuery<BillingResponse>({
    queryKey,
    queryFn: async () => {
      const response = await api.get(`/pricing/tenants/${tenantId}/events`, {
        params: { month, status: status || undefined, page, limit },
      });
      return response.data.data;
    },
    enabled: Boolean(tenantId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['billing-events', tenantId] });

  const excludeMutation = useMutation({
    mutationFn: async () => api.patch(`/pricing/events/${excludeTarget!.id}/exclude`, { reason: excludeReason }),
    onSuccess: async () => {
      toast.success(t('admin.pricing.eventExcluded'));
      setExcludeTarget(null);
      setExcludeReason('');
      await refresh();
    },
    onError: (error: any) => toast.error(getApiErrorMessage(error, t('common.genericError'))),
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/pricing/events/${id}/restore`),
    onSuccess: async () => {
      toast.success(t('admin.pricing.eventRestored'));
      await refresh();
    },
    onError: (error: any) => toast.error(getApiErrorMessage(error, t('common.genericError'))),
  });

  const generateStorageMutation = useMutation({
    mutationFn: async () => api.post(`/pricing/tenants/${tenantId}/events/storage`, { month }),
    onSuccess: async (response) => {
      toast.success(t('admin.pricing.storageGenerated', { count: response.data.data.createdEvents }));
      await refresh();
    },
    onError: (error: any) => toast.error(getApiErrorMessage(error, t('common.genericError'))),
  });

  const closePeriodMutation = useMutation({
    mutationFn: async () => api.post(`/pricing/tenants/${tenantId}/periods/close`, { month }),
    onSuccess: async () => {
      toast.success(t('admin.pricing.periodClosedSuccess'));
      await refresh();
    },
    onError: (error: any) => toast.error(getApiErrorMessage(error, t('common.genericError'))),
  });

  const money = (value: string | number | null) => value == null
    ? '—'
    : new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'PLN' }).format(Number(value));

  const summary = data?.summary || {
    pending: 0,
    unpriced: 0,
    excluded: 0,
    invoiced: 0,
    pendingNetAmount: '0',
  };
  const isClosed = data?.period?.status === 'closed';
  const canClose = Boolean(data?.period?.generatedAt) && !isClosed && month < currentMonth();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{t('admin.pricing.eventsTitle')}</h2>
          <p className="text-sm text-gray-500">{t('admin.pricing.eventsSubtitle')}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <div>
            <label htmlFor="billing-month" className="label-text">{t('admin.pricing.billingMonth')}</label>
            <input id="billing-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="input-field" />
          </div>
          <div>
            <label htmlFor="billing-status" className="label-text">{t('admin.pricing.eventStatus')}</label>
            <select id="billing-status" value={status} onChange={(event) => setStatus(event.target.value)} className="input-field">
              <option value="">{t('admin.pricing.allStatuses')}</option>
              {(['unpriced', 'pending', 'excluded', 'invoiced'] as BillingStatus[]).map((value) => (
                <option key={value} value={value}>{t(`admin.pricing.eventStatuses.${value}`)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{t('admin.pricing.periodStatus')}</span>
            <span className={isClosed ? 'badge-green' : 'badge-blue'}>
              {t(`admin.pricing.periodStatuses.${isClosed ? 'closed' : 'open'}`)}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">{t('admin.pricing.generateStorageHint')}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="btn-secondary"
            disabled={isClosed || generateStorageMutation.isPending}
            onClick={() => {
              if (window.confirm(t('admin.pricing.generateStorageConfirm'))) {
                generateStorageMutation.mutate();
              }
            }}
          >
            {generateStorageMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Calculator size={16} />}
            {t('admin.pricing.generateStorage')}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!canClose || closePeriodMutation.isPending}
            title={month >= currentMonth() ? t('admin.pricing.currentMonthCannotClose') : undefined}
            onClick={() => {
              if (window.confirm(t('admin.pricing.closePeriodConfirm'))) {
                closePeriodMutation.mutate();
              }
            }}
          >
            {closePeriodMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
            {t('admin.pricing.closePeriod')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs uppercase text-gray-500">{t('admin.pricing.toSettle')}</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{money(summary.pendingNetAmount)}</div>
          <div className="text-xs text-gray-500">{summary.pending} {t('admin.pricing.items')}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase text-gray-500">{t('admin.pricing.unpriced')}</div>
          <div className={`mt-1 text-xl font-semibold ${summary.unpriced ? 'text-amber-600' : 'text-gray-900'}`}>{summary.unpriced}</div>
          <div className="text-xs text-gray-500">{t('admin.pricing.requiresRate')}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase text-gray-500">{t('admin.pricing.excluded')}</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{summary.excluded}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase text-gray-500">{t('admin.pricing.invoiced')}</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{summary.invoiced}</div>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary-600" size={28} /></div>
        ) : !data?.data.length ? (
          <div className="py-10 text-center text-sm text-gray-500">{t('admin.pricing.noEvents')}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-4 py-3">{t('admin.pricing.eventDate')}</th>
                    <th className="px-4 py-3">{t('admin.pricing.source')}</th>
                    <th className="px-4 py-3">{t('admin.pricing.service')}</th>
                    <th className="px-4 py-3 text-right">{t('admin.pricing.quantity')}</th>
                    <th className="px-4 py-3 text-right">{t('admin.pricing.netAmount')}</th>
                    <th className="px-4 py-3">{t('admin.pricing.eventStatus')}</th>
                    <th className="px-4 py-3 text-right">{t('admin.pricing.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.data.map((event) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-500">{new Date(event.occurredAt).toLocaleString(i18n.language)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{event.order?.orderNumber || '—'}</div>
                        <div className="max-w-xs truncate text-xs text-gray-500" title={event.description || ''}>{event.description}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-900">{t(`admin.pricing.services.${event.serviceCode}`, { defaultValue: event.serviceName })}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{Number(event.quantity)} {t(`admin.pricing.units.${event.unit}`, { defaultValue: event.unit })}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium">{money(event.netAmount)}</td>
                      <td className="px-4 py-3">
                        <span className={statusClasses[event.status]}>{t(`admin.pricing.eventStatuses.${event.status}`)}</span>
                        {event.excludedReason && <div className="mt-1 max-w-xs text-xs text-gray-500" title={event.excludedReason}>{event.excludedReason}</div>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!isClosed && event.status === 'excluded' ? (
                          <button type="button" onClick={() => restoreMutation.mutate(event.id)} disabled={restoreMutation.isPending} className="btn-secondary px-2 py-1 text-xs">
                            <RotateCcw size={13} /> {t('admin.pricing.restore')}
                          </button>
                        ) : !isClosed && event.status !== 'invoiced' ? (
                          <button type="button" onClick={() => setExcludeTarget(event)} className="btn-secondary px-2 py-1 text-xs text-red-600">
                            <Ban size={13} /> {t('admin.pricing.exclude')}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 pb-4">
              <Pagination
                page={page}
                limit={limit}
                total={data.total}
                onPageChange={setPage}
                pageSizeOptions={[25, 50, 100, 200]}
                onLimitChange={setLimit}
              />
            </div>
          </>
        )}
      </div>

      <Modal isOpen={Boolean(excludeTarget)} onClose={() => setExcludeTarget(null)} title={t('admin.pricing.excludeTitle')} size="md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            excludeMutation.mutate();
          }}
          className="space-y-4"
        >
          <p className="text-sm text-gray-600">{excludeTarget?.description}</p>
          <div>
            <label htmlFor="exclude-reason" className="label-text">{t('admin.pricing.excludeReason')}</label>
            <textarea id="exclude-reason" value={excludeReason} onChange={(event) => setExcludeReason(event.target.value)} className="input-field min-h-24" maxLength={500} required />
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <button type="button" onClick={() => setExcludeTarget(null)} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={excludeMutation.isPending} className="btn-primary">{t('admin.pricing.exclude')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
