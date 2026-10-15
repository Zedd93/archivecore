import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';

interface SlaPreview {
  calculatedAt: string;
  hours: number;
  deadline: string;
}

interface Props {
  tenantId: string;
  orderType: string;
  priority: string;
  enabled: boolean;
  isLoan?: boolean;
}

export default function OrderSlaPreview({ tenantId, orderType, priority, enabled, isLoan = false }: Props) {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError } = useQuery<SlaPreview>({
    queryKey: ['order-sla-preview', tenantId, orderType, priority],
    queryFn: async () => {
      const response = await api.get('/orders/sla-preview', { params: { orderType, priority } });
      return response.data.data;
    },
    enabled: enabled && Boolean(tenantId),
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: 'always',
  });

  if (!enabled) return null;

  const deadline = data ? new Intl.DateTimeFormat(i18n.language.startsWith('pl') ? 'pl-PL' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(data.deadline)) : null;

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-gray-800" aria-live="polite">
      <p className="font-medium">{t('orders.slaPreview.title')}</p>
      {!tenantId ? <p className="mt-1">{t('orders.slaPreview.missingTenant')}</p>
        : isPending ? <p className="mt-1">{t('orders.slaPreview.loading')}</p>
          : isError ? <p className="mt-1 text-red-700">{t('orders.slaPreview.error')}</p>
            : <p className="mt-1 font-semibold">{deadline} ({t('orders.slaPreview.duration', { hours: data?.hours })})</p>}
      <p className="mt-1 text-xs text-gray-600">{t('orders.slaPreview.explanation')}</p>
      {isLoan && <p className="mt-1 text-xs text-gray-600">{t('orders.slaPreview.loanNote')}</p>}
    </section>
  );
}
