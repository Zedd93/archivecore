import { useState } from 'react';
import { useList } from '@/hooks/useApi';
import { useTranslation } from 'react-i18next';
import { Clock, User, FileText, Box, MapPin, ShieldCheck, Loader2 } from 'lucide-react';
import Pagination from './Pagination';

interface ActivityTimelineProps {
  entityType: string;
  entityId: string;
  source?: 'audit' | 'order';
}

const ACTION_ICONS: Record<string, typeof Box> = {
  'box': Box,
  'order': FileText,
  'hr': User,
  'transfer_list': FileText,
  'export': FileText,
  'import': FileText,
};

export default function ActivityTimeline({ entityType, entityId, source = 'audit' }: ActivityTimelineProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const isOrderHistory = source === 'order';
  const { data, isLoading, isError } = useList(
    isOrderHistory ? 'order-history' : 'audit-timeline',
    isOrderHistory ? `/orders/${entityId}/history` : '/audit',
    isOrderHistory ? { orderId: entityId, page, limit: 20 } : { entityType, entityId, limit: 20, page: 1 },
    isOrderHistory ? { refetchInterval: 10_000 } : undefined,
  );

  const logs = data?.data || [];

  const getActionLabel = (action: string): string => {
    const key = `timeline.actions.${action}`;
    const translated = t(key);
    return translated === key ? action : translated;
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return t('timeline.justNow');
    if (diffMin < 60) return t('timeline.minutesAgo', { count: diffMin });
    if (diffHours < 24) return t('timeline.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('timeline.daysAgo', { count: diffDays });
    return date.toLocaleDateString('pl-PL') + ' ' + date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  if (isError) return <p className="text-sm text-red-600 py-4">{t('timeline.loadError')}</p>;

  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        <Clock size={24} className="mx-auto mb-2 text-gray-300" />
        {t('timeline.noHistory')}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-200" />

      <div className="space-y-4">
        {logs.map((log: any) => {
          const IconComponent = ACTION_ICONS[log.entityType] || ShieldCheck;
          return (
            <div key={log.id} className="relative flex gap-3 pl-2">
              {/* Dot */}
              <div className="relative z-10 w-5 h-5 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center shrink-0 mt-0.5">
                <IconComponent size={10} className="text-gray-500" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">
                  {getActionLabel(log.action)}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-500">
                    {log.user ? `${log.user.firstName} ${log.user.lastName}` : t('timeline.system')}
                  </span>
                  <span className="text-xs text-gray-300">•</span>
                  <span className="text-xs text-gray-400">{formatDate(log.createdAt)}</span>
                </div>
                {log.details && (
                  <div className="mt-1 text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
                    {typeof log.details === 'object'
                      ? Object.entries(log.details).map(([key, val]) => `${key}: ${val}`).join(', ')
                      : String(log.details)
                    }
                  </div>
                )}
                {log.reason && <p className="mt-1 text-sm text-gray-600 break-words">{t('timeline.reason')}: {log.reason}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {isOrderHistory && data?.meta && data.meta.total > 20 && (
        <div className="mt-4 pl-8"><Pagination page={page} limit={20} total={data.meta.total} onPageChange={setPage} /></div>
      )}
    </div>
  );
}
