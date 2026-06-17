import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useList } from '@/hooks/useApi';
import DataTable, { Column } from '@/components/ui/DataTable';
import Pagination from '@/components/ui/Pagination';
import { Shield, User, Clock, RotateCcw, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import api from '@/services/api';
import toast from 'react-hot-toast';
import { getApiErrorMessage } from '@/utils/apiError';
import { RoleCode } from '@archivecore/shared';

const AUDIT_ACTION_OPTIONS = [
  'attachment.upload',
  'attachment.delete',
  'audit.revert',
  'box.create',
  'box.update',
  'box.move',
  'box.status',
  'box.bulk_status',
  'box.bulk_move',
  'custody.create',
  'disposal.initiate',
  'disposal.approve',
  'document.create',
  'document.update',
  'document.delete',
  'export.boxes',
  'export.orders',
  'export.hr',
  'export.transfer-lists',
  'folder.create',
  'folder.update',
  'hr.create',
  'hr.update',
  'hr.add_document',
  'hr.search_pesel',
  'hr.litigation_hold',
  'hr_doc.create',
  'hr_doc.delete',
  'import.boxes',
  'import.hr',
  'label.batch_generate',
  'location.create',
  'location.update',
  'login',
  'logout',
  'order.create',
  'order.update',
  'order.submit',
  'order.approve',
  'order.reject',
  'order.process',
  'order.ready',
  'order.deliver',
  'order.complete',
  'order.cancel',
  'order.assign',
  'order_item.create',
  'order_item.status',
  'order_item.return',
  'order.delete',
  'policy.create',
  'policy.update',
  'policy.delete',
  'template.create',
  'tenant.create',
  'tenant.update',
  'transfer_list.create',
  'transfer_list.update',
  'transfer_list.delete',
  'transfer_list.confirm',
  'transfer_list.status',
  'transfer_list.import',
  'transfer_list_item.create',
  'transfer_list_item.update',
  'transfer_list_item.delete',
  'transfer_list_item.bulk_delete',
  'transfer_list_item.bulk_assign_box',
  'transfer_list_item.bulk_storage_location',
  'transfer_list_item.bulk_disposal_date',
  'user.create',
  'user.update',
  'user.update_access',
  'user.assign_roles',
  'user.deactivate',
] as const;

const AUDIT_ENTITY_OPTIONS = [
  'attachment',
  'box',
  'custody_event',
  'disposal',
  'document',
  'export',
  'folder',
  'hr_document',
  'hr_folder',
  'import',
  'label',
  'label_template',
  'location',
  'order',
  'order_item',
  'retention_policy',
  'tenant',
  'transfer_list',
  'transfer_list_item',
  'user',
] as const;

export default function AuditPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ action: '', entityType: '', dateFrom: '', dateTo: '' });
  const [revertingId, setRevertingId] = useState<string | null>(null);

  const actionLabels = t('statuses.auditAction', { returnObjects: true }) as Record<string, string>;
  const entityLabels = t('statuses.auditEntity', { returnObjects: true }) as Record<string, string>;

  const humanizeAuditValue = (value: string) =>
    value
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const formatAuditAction = (action: string) => actionLabels[action] || humanizeAuditValue(action);
  const formatAuditEntity = (entityType: string) => entityLabels[entityType] || humanizeAuditValue(entityType);

  const { data, isLoading } = useList('audit', '/audit', { page, limit: 30, ...filters });
  const isSuperAdmin = hasRole(RoleCode.SUPER_ADMIN);

  const revertMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/audit/${id}/revert`);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit'] });
      toast.success(t('admin.audit.revertSuccess'));
    },
    onError: (err: any) => {
      toast.error(getApiErrorMessage(err, t('admin.audit.revertError')));
    },
    onSettled: () => setRevertingId(null),
  });

  const handleRevert = async (item: any) => {
    const ok = await confirm({
      title: t('admin.audit.revertConfirmTitle'),
      message: t('admin.audit.revertConfirmMsg', {
        action: formatAuditAction(item.action),
        entity: formatAuditEntity(item.entityType),
      }),
      confirmLabel: t('admin.audit.revert'),
      variant: 'danger',
    });
    if (!ok) return;
    setRevertingId(item.id);
    revertMutation.mutate(item.id);
  };

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
      render: (item) => <span className="badge-blue text-xs">{formatAuditAction(item.action)}</span>,
    },
    {
      key: 'entityType',
      header: t('admin.audit.colType'),
      render: (item) => <span className="badge-gray text-xs">{formatAuditEntity(item.entityType)}</span>,
    },
    { key: 'entityId', header: t('admin.audit.colEntityId'), render: (item) => <span className="font-mono text-xs text-gray-500">{item.entityId?.slice(0, 8)}...</span> },
    { key: 'ipAddress', header: t('admin.audit.colIp'), render: (item) => <span className="text-xs text-gray-500">{item.ipAddress || '—'}</span> },
    {
      key: 'tenant',
      header: t('admin.users.colTenant'),
      render: (item) => item.tenant?.shortCode || '—',
    },
    ...(isSuperAdmin ? [{
      key: 'actions',
      header: t('common.actions'),
      render: (item: any) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleRevert(item); }}
          disabled={!item.canRevert || revertingId === item.id}
          title={item.canRevert ? t('admin.audit.revert') : item.reason || t('admin.audit.notRevertible')}
          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent"
        >
          {revertingId === item.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
          {t('admin.audit.revert')}
        </button>
      ),
    } as Column<any>] : []),
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
          <select
            value={filters.action}
            onChange={(e) => { setPage(1); setFilters({ ...filters, action: e.target.value }); }}
            className="input-field w-56"
            aria-label={t('admin.audit.filterAction')}
          >
            <option value="">{t('admin.audit.filterAction')}</option>
            {AUDIT_ACTION_OPTIONS.map((action) => (
              <option key={action} value={action}>{formatAuditAction(action)}</option>
            ))}
          </select>
          <select
            value={filters.entityType}
            onChange={(e) => { setPage(1); setFilters({ ...filters, entityType: e.target.value }); }}
            className="input-field w-48"
            aria-label={t('admin.audit.filterEntityType')}
          >
            <option value="">{t('admin.audit.filterEntityType')}</option>
            {AUDIT_ENTITY_OPTIONS.map((entityType) => (
              <option key={entityType} value={entityType}>{formatAuditEntity(entityType)}</option>
            ))}
          </select>
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
      {ConfirmDialogElement}
    </div>
  );
}
