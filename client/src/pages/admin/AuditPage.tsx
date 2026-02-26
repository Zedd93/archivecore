import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useList } from '@/hooks/useApi';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import DataTable, { Column } from '@/components/ui/DataTable';
import Pagination from '@/components/ui/Pagination';
import { Shield, User, Clock } from 'lucide-react';

export default function AuditPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ action: '', entityType: '', dateFrom: '', dateTo: '' });

  const debouncedAction = useDebouncedValue(filters.action, 300);
  const debouncedEntityType = useDebouncedValue(filters.entityType, 300);

  const { data, isLoading } = useList('audit', '/audit', { page, limit: 30, action: debouncedAction, entityType: debouncedEntityType, dateFrom: filters.dateFrom, dateTo: filters.dateTo });

  const columns: Column<any>[] = [
    {
      key: 'createdAt',
      header: t('admin.audit.colDate'),
      render: (item) => (
        <span className="text-xs text-gray-500 flex items-center gap-1">
          <Clock size={12} />
          {new Date(item.createdAt).toLocaleString('pl-PL')}
        </span>
      ),
    },
    {
      key: 'user',
      header: t('admin.audit.colUser'),
      render: (item) => item.user ? (
        <span className="flex items-center gap-1 text-sm">
          <User size={14} className="text-gray-400" />
          {item.user.firstName} {item.user.lastName}
        </span>
      ) : '—',
    },
    {
      key: 'action',
      header: t('admin.audit.colAction'),
      render: (item) => <span className="badge-blue text-xs">{item.action}</span>,
    },
    {
      key: 'entityType',
      header: t('admin.audit.colType'),
      render: (item) => <span className="badge-gray text-xs">{item.entityType}</span>,
    },
    { key: 'entityId', header: t('admin.audit.colEntityId'), render: (item) => <span className="font-mono text-xs text-gray-500">{item.entityId?.slice(0, 8)}...</span> },
    { key: 'ipAddress', header: t('admin.audit.colIp'), render: (item) => <span className="text-xs text-gray-500">{item.ipAddress || '—'}</span> },
    {
      key: 'tenant',
      header: t('admin.users.colTenant'),
      render: (item) => item.tenant?.shortCode || '—',
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shield size={24} className="text-primary-600" /> {t('admin.audit.title')}
        </h1>
        <p className="text-sm text-gray-500">{t('admin.audit.subtitle')}</p>
      </div>

      <div className="card">
        <div className="flex items-center gap-4 flex-wrap">
          <input type="text" placeholder={t('admin.audit.filterAction')} value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} className="input-field w-40" aria-label={t('admin.audit.filterAction')} />
          <input type="text" placeholder={t('admin.audit.filterEntityType')} value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })} className="input-field w-40" aria-label={t('admin.audit.filterEntityType')} />
          <div className="flex items-center gap-2">
            <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} className="input-field w-36" aria-label="Date from" />
            <span className="text-gray-400" aria-hidden="true">—</span>
            <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} className="input-field w-36" aria-label="Date to" />
          </div>
        </div>
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={data?.data || []} isLoading={isLoading} emptyMessage={t('admin.audit.empty')} />
        {data?.meta && <div className="px-4 pb-4"><Pagination page={page} limit={30} total={data.meta.total} onPageChange={setPage} /></div>}
      </div>
    </div>
  );
}
