import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useList, useCreate } from '@/hooks/useApi';
import { useExport } from '@/hooks/useExport';
import { useTranslation } from 'react-i18next';
import DataTable, { Column } from '@/components/ui/DataTable';
import Pagination from '@/components/ui/Pagination';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import BoxPicker from '@/components/ui/BoxPicker';
import { Plus, AlertTriangle, Download, Loader2 } from 'lucide-react';

export default function OrderListPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedBoxes, setSelectedBoxes] = useState<{ id: string; boxNumber: string }[]>([]);
  const [filters, setFilters] = useState({ search: '', status: '', orderType: '' });

  const { data, isLoading } = useList('orders', '/orders', { page, limit: 20, ...filters });
  const createOrder = useCreate('/orders', ['orders'], t('common.success'));
  const { exportData, isExporting } = useExport({ endpoint: '/export/orders', defaultFilename: 'zlecenia.xlsx' });

  const ORDER_TYPE_LABELS: Record<string, string> = {
    checkout: t('orders.typeIssue'),
    return_order: t('orders.typeReturn'),
    transfer: t('orders.typeTransfer'),
    disposal: t('orders.typeDestruction'),
  };

  const columns: Column<any>[] = [
    {
      key: 'orderNumber',
      header: t('transferLists.number'),
      render: (item) => <span className="font-mono font-medium text-primary-700">{item.orderNumber}</span>,
    },
    {
      key: 'orderType',
      header: t('common.type'),
      render: (item) => ORDER_TYPE_LABELS[item.orderType] || item.orderType,
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (item) => <StatusBadge status={item.status} type="order" />,
    },
    {
      key: 'priority',
      header: t('orders.createModal.priority'),
      render: (item) => <StatusBadge status={item.priority} type="priority" />,
    },
    {
      key: 'requester',
      header: t('orders.requester'),
      render: (item) => item.requester ? `${item.requester.firstName} ${item.requester.lastName}` : '—',
    },
    {
      key: 'assignee',
      header: t('orders.assignee'),
      render: (item) => item.assignee ? `${item.assignee.firstName} ${item.assignee.lastName}` : '—',
    },
    {
      key: '_count',
      header: t('orders.itemCount'),
      render: (item) => item._count?.items ?? 0,
    },
    {
      key: 'slaDeadline',
      header: t('orders.sla'),
      render: (item) => {
        if (!item.slaDeadline) return '—';
        const deadline = new Date(item.slaDeadline);
        const now = new Date();
        const isOverdue = deadline < now && !['completed', 'cancelled'].includes(item.status);
        return (
          <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
            {isOverdue && <AlertTriangle size={14} />}
            {deadline.toLocaleDateString('pl-PL')} {deadline.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
          </span>
        );
      },
    },
  ];

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createOrder.mutateAsync({
      orderType: fd.get('orderType'),
      priority: fd.get('priority') || 'normal',
      notes: fd.get('notes') || undefined,
      items: selectedBoxes.map(b => ({ boxId: b.id })),
    });
    setShowCreate(false);
    setSelectedBoxes([]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('orders.title')}</h1>
          <p className="text-sm text-gray-500">{t('orders.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => exportData({ format: 'xlsx', ...filters })}
            disabled={isExporting}
            className="btn-secondary flex items-center gap-2"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            <span className="hidden sm:inline">{t('common.export')}</span>
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> <span className="hidden sm:inline">{t('orders.newOrder')}</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder={t('orders.searchPlaceholder')}
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="input-field flex-1"
            aria-label={t('orders.searchPlaceholder')}
          />
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="input-field w-40" aria-label={t('orders.allStatuses')}>
            <option value="">{t('orders.allStatuses')}</option>
            <option value="draft">{t('orders.statusDraft')}</option>
            <option value="submitted">{t('orders.statusSubmitted')}</option>
            <option value="approved">{t('orders.statusApproved')}</option>
            <option value="in_progress">{t('orders.statusInProgress')}</option>
            <option value="ready">{t('orders.statusReady')}</option>
            <option value="delivered">{t('orders.statusIssued')}</option>
            <option value="completed">{t('orders.statusCompleted')}</option>
            <option value="cancelled">{t('orders.statusCancelled')}</option>
          </select>
          <select value={filters.orderType} onChange={(e) => setFilters({ ...filters, orderType: e.target.value })} className="input-field w-36" aria-label={t('orders.allTypes')}>
            <option value="">{t('orders.allTypes')}</option>
            <option value="checkout">{t('orders.typeIssue')}</option>
            <option value="return_order">{t('orders.typeReturn')}</option>
            <option value="transfer">{t('orders.typeTransfer')}</option>
            <option value="disposal">{t('orders.typeDestruction')}</option>
          </select>
        </div>
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={data?.data || []} isLoading={isLoading} onRowClick={(item) => navigate(`/orders/${item.id}`)} emptyMessage={t('orders.empty')} />
        {data?.meta && (
          <div className="px-4 pb-4">
            <Pagination page={page} limit={20} total={data.meta.total} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => { setShowCreate(false); setSelectedBoxes([]); }} title={t('orders.createModal.title')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="order-create-type" className="label-text">{t('orders.createModal.type')}</label>
              <select id="order-create-type" name="orderType" className="input-field" required>
                <option value="checkout">{t('orders.typeIssue')}</option>
                <option value="return_order">{t('orders.typeReturn')}</option>
                <option value="transfer">{t('orders.typeTransfer')}</option>
                <option value="disposal">{t('orders.typeDestruction')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="order-create-priority" className="label-text">{t('orders.createModal.priority')}</label>
              <select id="order-create-priority" name="priority" className="input-field">
                <option value="normal">{t('orders.createModal.priorityNormal')}</option>
                <option value="high">{t('orders.createModal.priorityHigh')}</option>
                <option value="urgent">{t('orders.createModal.priorityUrgent')}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label-text">{t('orders.createModal.boxIds')}</label>
            <BoxPicker
              value={selectedBoxes}
              onChange={setSelectedBoxes}
              placeholder={t('orders.createModal.boxIdsPlaceholder')}
            />
          </div>
          <div>
            <label htmlFor="order-create-notes" className="label-text">{t('orders.createModal.notes')}</label>
            <textarea id="order-create-notes" name="notes" className="input-field" rows={3} placeholder={t('orders.createModal.notesPlaceholder')} />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => { setShowCreate(false); setSelectedBoxes([]); }} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={createOrder.isPending} className="btn-primary">
              {createOrder.isPending ? t('common.creating') : t('orders.createModal.submit')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
