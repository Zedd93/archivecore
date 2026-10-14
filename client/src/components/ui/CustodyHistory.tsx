import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';

type CustodyEvent = {
  id: string;
  eventType: 'handover' | 'receipt' | 'return_event' | 'transfer';
  eventAt: string;
  notes: string | null;
  recipientName: string | null;
  orderNumberSnapshot: string | null;
  order: { id: string; orderNumber: string } | null;
  performedBy: { firstName: string; lastName: string } | null;
  fromUser: { firstName: string; lastName: string } | null;
  toUser: { firstName: string; lastName: string } | null;
  fromLocation: { fullPath: string } | null;
  toLocation: { fullPath: string } | null;
};

const PAGE_SIZE = 30;

export default function CustodyHistory({ kind, id }: { kind: 'box' | 'folder' | 'document' | 'hr'; id: string }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const tenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['custody-history', tenantId, kind, id],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const response = await api.get<{ data: CustodyEvent[]; pagination: { totalPages: number } }>(
        `/custody-history/${kind}/${encodeURIComponent(id)}`,
        { params: { page: pageParam, limit: PAGE_SIZE } }
      );
      return response.data;
    },
    getNextPageParam: (page, pages) => pages.length < page.pagination.totalPages ? pages.length + 1 : undefined,
  });
  const events = data?.pages.flatMap((page) => page.data) || [];

  return <section className="card space-y-3">
    <h2 className="text-sm font-semibold text-gray-700">{t('orders.detail.custody.title')}</h2>
    {isLoading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
    {isError && <p role="alert" className="text-sm text-red-700">{t('orders.detail.custody.loadError')}</p>}
    {!isLoading && !isError && events.length === 0 && <p className="text-sm text-gray-500">{t('orders.detail.custody.empty')}</p>}
    <ol className="max-h-96 overflow-y-auto divide-y divide-gray-100">
      {events.map((event) => <li key={event.id} className="py-3 text-sm space-y-1">
        <p className="font-medium text-gray-900">{t(`orders.detail.custody.${event.eventType}`)} · {new Date(event.eventAt).toLocaleString(i18n.language === 'en' ? 'en-GB' : 'pl-PL')}</p>
        {(event.order || event.orderNumberSnapshot) && <p className="text-gray-600">
          {t('custodyHistory.order')}: {event.order
            ? <Link to={`/orders/${event.order.id}`} className="text-primary-700 hover:underline">{event.order.orderNumber}</Link>
            : event.orderNumberSnapshot}
        </p>}
        {event.performedBy && <p className="text-gray-600">{t('orders.detail.custody.operator')}: {event.performedBy.firstName} {event.performedBy.lastName}</p>}
        {event.recipientName && <p className="text-gray-600">{t('orders.detail.custody.recipient')}: {event.recipientName}</p>}
        {(event.fromLocation || event.toLocation) && <p className="text-gray-600 break-words">{event.fromLocation?.fullPath || '—'} → {event.toLocation?.fullPath || '—'}</p>}
        {event.notes && <p className="text-gray-600 break-words">{event.notes}</p>}
      </li>)}
    </ol>
    {hasNextPage && <button type="button" className="btn-secondary" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? t('common.loading') : t('custodyHistory.more')}</button>}
  </section>;
}
