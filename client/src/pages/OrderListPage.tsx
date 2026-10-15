import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useList, useCreate, useDelete } from '@/hooks/useApi';
import { useExport } from '@/hooks/useExport';
import { useTranslation } from 'react-i18next';
import DataTable, { Column } from '@/components/ui/DataTable';
import Pagination from '@/components/ui/Pagination';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import BoxPicker from '@/components/ui/BoxPicker';
import DocumentPicker from '@/components/ui/DocumentPicker';
import FolderPicker, { SelectedFolder } from '@/components/ui/FolderPicker';
import OrderSlaPreview from '@/components/OrderSlaPreview';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/services/api';
import { getApiErrorMessage } from '@/utils/apiError';
import toast from 'react-hot-toast';
import { Permissions, RoleCode } from '@archivecore/shared';
import { readOrderDraft } from '@/utils/orderDraft';
import { Plus, AlertTriangle, Download, Loader2, Trash2 } from 'lucide-react';

interface SelectedBox {
  id: string;
  boxNumber: string;
}

interface SelectedDocument {
  id: string;
  title: string;
  source?: 'document' | 'transfer_list_item';
}

interface SlaSummary {
  warning: number;
  overdue: number;
  escalated: number;
  total: number;
}

interface AssignableOrder {
  id: string;
  orderNumber: string;
  assignedTo: string | null;
}

interface QuickTransition {
  id: string;
  orderNumber: string;
  action: 'approve' | 'process';
}

export default function OrderListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { user, hasPermission, hasRole } = useAuth();
  const queryClient = useQueryClient();
  const consumedDraft = useRef(false);
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState('checkout');
  const [createPriority, setCreatePriority] = useState('normal');
  const [selectedBoxes, setSelectedBoxes] = useState<SelectedBox[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<SelectedFolder[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<SelectedDocument[]>([]);
  const [filters, setFilters] = useState({ search: '', status: '', orderType: '', slaRisk: false, slaLevel: '' });
  const [assigningOrder, setAssigningOrder] = useState<AssignableOrder | null>(null);
  const [assigneeChoice, setAssigneeChoice] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [quickTransition, setQuickTransition] = useState<QuickTransition | null>(null);
  const [transitionBusy, setTransitionBusy] = useState(false);

  useEffect(() => {
    if (consumedDraft.current) return;
    if (!(location.state as { orderDraft?: unknown } | null)?.orderDraft) return;
    consumedDraft.current = true;
    const tenantId = user?.tenantId || localStorage.getItem('tenantId');
    const items = readOrderDraft(location.state, tenantId);
    if (items.length > 0) {
      setSelectedBoxes(items.filter((item) => item.type === 'box').map((item) => ({ id: item.id, boxNumber: item.boxNumber || item.title })));
      setSelectedFolders(items.filter((item) => item.type === 'folder').map((item) => ({ id: item.id, source: item.source === 'transfer_list' ? 'transfer_list' : 'manual', title: item.title })));
      setSelectedDocuments(items.filter((item) => item.type === 'document').map((item) => ({ id: item.id, title: item.title })));
      setShowCreate(true);
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, user?.tenantId]);

  const { data, isLoading } = useList('orders', '/orders', { page, limit: 20, ...filters }, { refetchInterval: 60_000 });
  const canApproveOrders = hasPermission(Permissions.ORDER_APPROVE);
  const canProcessOrders = hasPermission(Permissions.ORDER_PROCESS);
  const activeTenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const { data: assignees = [], isLoading: assigneesLoading, isError: assigneesError } = useQuery<Array<{ id: string; firstName: string; lastName: string }>>({
    queryKey: ['order-assignees', activeTenantId],
    queryFn: async () => { const { data: response } = await api.get('/orders/assignees'); return response.data; },
    enabled: Boolean(assigningOrder && activeTenantId && canProcessOrders),
  });
  const { data: slaSummary, isError: slaSummaryError } = useQuery<SlaSummary>({
    queryKey: ['orders', 'sla-summary', activeTenantId],
    queryFn: async () => {
      const { data: response } = await api.get('/orders/sla-summary');
      return response.data;
    },
    enabled: Boolean(activeTenantId),
    refetchInterval: 60_000,
  });
  const { data: awaitingApprovalCount = 0 } = useQuery({
    queryKey: ['orders', 'awaiting-approval', activeTenantId],
    queryFn: async () => {
      const { data: response } = await api.get('/orders', { params: { status: 'submitted', page: 1, limit: 1 } });
      return Number(response.meta?.total) || 0;
    },
    enabled: canApproveOrders && Boolean(activeTenantId),
  });
  const createOrder = useCreate('/orders', ['orders'], t('common.success'));
  const deleteOrder = useDelete('/orders', ['orders'], t('orders.deleted'));
  const { exportData, isExporting } = useExport({ endpoint: '/export/orders', defaultFilename: 'zlecenia.xlsx' });
  const canDeleteOrders = hasRole(RoleCode.SUPER_ADMIN) || hasRole(RoleCode.DOXART_ADMIN);
  const selectedItemCount = (createType === 'scan' ? 0 : selectedBoxes.length) + selectedFolders.length + selectedDocuments.length;

  const assignSelectedOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assigningOrder || !assigneeChoice || assigneeChoice === assigningOrder.assignedTo || assigning) return;
    setAssigning(true);
    try {
      await api.patch(`/orders/${assigningOrder.id}/assign`, { assigneeId: assigneeChoice });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['order', assigningOrder.id] }),
        queryClient.invalidateQueries({ queryKey: ['order-history'] }),
      ]);
      setAssigningOrder(null);
      setAssigneeChoice('');
      toast.success(t('orders.detail.assignedSuccess'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
    } finally {
      setAssigning(false);
    }
  };

  const confirmQuickTransition = async () => {
    if (!quickTransition || transitionBusy) return;
    setTransitionBusy(true);
    try {
      await api.patch(`/orders/${quickTransition.id}/${quickTransition.action}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['order', quickTransition.id] }),
        queryClient.invalidateQueries({ queryKey: ['order-history'] }),
      ]);
      setQuickTransition(null);
      toast.success(t('orders.detail.statusChanged'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
      if ((error as { response?: { status?: number } })?.response?.status === 409) {
        setQuickTransition(null);
        await queryClient.invalidateQueries({ queryKey: ['orders'] });
      }
    } finally {
      setTransitionBusy(false);
    }
  };

  const ORDER_TYPE_LABELS: Record<string, string> = {
    checkout: t('orders.typeIssue'),
    return_order: t('orders.typeReturn'),
    transfer: t('orders.typeTransfer'),
    disposal: t('orders.typeDestruction'),
    scan: t('orders.typeScan'),
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
        if (item.status === 'draft' || !item.slaDeadline) return '—';
        const deadline = new Date(item.slaDeadline);
        const level = item.slaLevel as 80 | 100 | 120 | null;
        const badge = level === 120
          ? { label: t('orders.slaEscalated'), color: 'bg-red-100 text-red-800' }
          : level === 100
            ? { label: t('orders.slaOverdue'), color: 'bg-orange-100 text-orange-800' }
            : level === 80
              ? { label: t('orders.slaWarning'), color: 'bg-amber-100 text-amber-800' }
              : null;
        return (
          <span className="flex flex-col items-start gap-1">
            <span className={level && level >= 100 ? 'text-red-700 font-medium' : ''}>
              {deadline.toLocaleDateString('pl-PL')} {deadline.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {badge && <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>
              <AlertTriangle size={12} aria-hidden="true" />{badge.label}
            </span>}
          </span>
        );
      },
    },
    ...(canProcessOrders || canApproveOrders ? [{
      key: 'slaAction',
      header: t('orders.slaQuickAction'),
      render: (item: any) => item.slaLevel ? (
        <div className="flex flex-wrap gap-1">
          {canProcessOrders && ['submitted', 'approved', 'in_progress', 'ready'].includes(item.status) && (
            <button
              type="button"
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                setAssigneeChoice('');
                setAssigningOrder({ id: item.id, orderNumber: item.orderNumber, assignedTo: item.assignedTo });
              }}
              className="btn-secondary text-sm"
              aria-label={t('orders.slaAssignAction', { number: item.orderNumber })}
            >
              {t('orders.detail.assign')}
            </button>
          )}
          {((item.status === 'submitted' && canApproveOrders) || (item.status === 'approved' && canProcessOrders)) && (
            <button
              type="button"
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                setQuickTransition({ id: item.id, orderNumber: item.orderNumber, action: item.status === 'submitted' ? 'approve' : 'process' });
              }}
              className="btn-primary text-sm"
              aria-label={t(item.status === 'submitted' ? 'orders.slaApproveAction' : 'orders.slaProcessAction', { number: item.orderNumber })}
            >
              {t(item.status === 'submitted' ? 'orders.detail.approve' : 'orders.detail.startProgress')}
            </button>
          )}
        </div>
      ) : null,
    }] : []),
    ...(canDeleteOrders ? [{
      key: 'actions',
      header: t('common.actions'),
      render: (item: any) => {
        const canDelete = ['completed', 'cancelled'].includes(item.status);
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!canDelete) return;
              if (!window.confirm(t('orders.confirmDelete'))) return;
              deleteOrder.mutate(item.id);
            }}
            disabled={!canDelete || deleteOrder.isPending}
            className="text-red-600 hover:text-red-800 disabled:text-gray-300 disabled:cursor-not-allowed"
            title={canDelete ? t('common.delete') : t('orders.deleteOnlyClosed')}
            aria-label={t('common.delete')}
          >
            <Trash2 size={16} />
          </button>
        );
      },
    }] : []),
  ];

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selectedItemCount === 0) return;
    const fd = new FormData(e.currentTarget);
    try {
      await createOrder.mutateAsync({
        orderType: fd.get('orderType'),
        priority: fd.get('priority') || 'normal',
        notes: fd.get('notes') || undefined,
        items: [
          ...(createType === 'scan' ? [] : selectedBoxes.map((box) => ({ boxId: box.id }))),
          ...selectedFolders.map((folder) => ({ folderId: folder.id })),
          ...selectedDocuments.map((doc) => (
            doc.source === 'transfer_list_item'
              ? { transferListItemId: doc.id }
              : { documentId: doc.id }
          )),
        ],
      });
      setShowCreate(false);
      resetCreateForm();
    } catch {
      // Error toast is handled by useCreate.
    }
  };

  const resetCreateForm = () => {
    setSelectedBoxes([]);
    setSelectedFolders([]);
    setSelectedDocuments([]);
    setCreateType('checkout');
    setCreatePriority('normal');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('orders.title')}</h1>
          <p className="text-sm text-gray-500">{t('orders.subtitle')}</p>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          <button
            onClick={() => exportData({ format: 'xlsx', ...filters, slaRisk: String(filters.slaRisk) })}
            disabled={isExporting}
            className="btn-secondary flex-1 sm:flex-none"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            <span className="hidden sm:inline">{t('common.export')}</span>
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex-1 sm:flex-none">
            <Plus size={16} /> <span className="hidden sm:inline">{t('orders.newOrder')}</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      {canApproveOrders && (
        <button
          type="button"
          onClick={() => {
            setFilters(filters.status === 'submitted'
              ? { search: '', status: '', orderType: '', slaRisk: false, slaLevel: '' }
              : { search: '', status: 'submitted', orderType: '', slaRisk: false, slaLevel: '' });
            setPage(1);
          }}
          className={filters.status === 'submitted' ? 'btn-primary' : 'btn-secondary'}
          aria-pressed={filters.status === 'submitted'}
        >
          {t('orders.awaitingApproval', { count: awaitingApprovalCount })}
        </button>
      )}
      <button
        type="button"
        onClick={() => { setFilters({ ...filters, slaRisk: !filters.slaRisk, slaLevel: '' }); setPage(1); }}
        className={filters.slaRisk ? 'btn-primary' : 'btn-secondary'}
        aria-pressed={filters.slaRisk}
      >
        <AlertTriangle size={16} aria-hidden="true" />{t('orders.slaAtRisk')}
      </button>
      <section aria-label={t('orders.slaSummary')}>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('orders.slaSummary')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
            { level: '80', label: t('orders.slaWarning'), count: slaSummary?.warning, color: 'text-amber-700' },
            { level: '100', label: t('orders.slaOverdue'), count: slaSummary?.overdue, color: 'text-orange-700' },
            { level: '120', label: t('orders.slaEscalated'), count: slaSummary?.escalated, color: 'text-red-700' },
          ] as const).map(({ level, label, count, color }) => (
            <button
              key={level}
              type="button"
              onClick={() => {
                setFilters({ search: '', status: '', orderType: '', slaRisk: false, slaLevel: filters.slaLevel === level ? '' : level });
                setPage(1);
              }}
              aria-pressed={filters.slaLevel === level}
              className={`card text-left border-2 transition-colors hover:border-primary-400 ${filters.slaLevel === level ? 'border-primary-600' : 'border-transparent'}`}
            >
              <span className="block text-sm text-gray-600">{label}</span>
              <span className={`block text-2xl font-bold ${color}`}>{count ?? '—'}</span>
            </button>
          ))}
        </div>
        {slaSummaryError && <p className="mt-2 text-sm text-red-600">{t('orders.slaSummaryError')}</p>}
      </section>
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <input
            type="text"
            placeholder={t('orders.searchPlaceholder')}
            value={filters.search}
            onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setPage(1); }}
            className="input-field w-full sm:flex-1"
            aria-label={t('orders.searchPlaceholder')}
          />
          <select value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }} className="input-field w-full sm:w-40" aria-label={t('orders.allStatuses')}>
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
          <select value={filters.orderType} onChange={(e) => { setFilters({ ...filters, orderType: e.target.value }); setPage(1); }} className="input-field w-full sm:w-36" aria-label={t('orders.allTypes')}>
            <option value="">{t('orders.allTypes')}</option>
            <option value="checkout">{t('orders.typeIssue')}</option>
            <option value="return_order">{t('orders.typeReturn')}</option>
            <option value="transfer">{t('orders.typeTransfer')}</option>
            <option value="disposal">{t('orders.typeDestruction')}</option>
            <option value="scan">{t('orders.typeScan')}</option>
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

      <Modal
        isOpen={Boolean(assigningOrder)}
        onClose={() => { if (!assigning) { setAssigningOrder(null); setAssigneeChoice(''); } }}
        title={t('orders.slaAssignAction', { number: assigningOrder?.orderNumber || '' })}
      >
        <form onSubmit={(event) => { void assignSelectedOrder(event); }} className="space-y-4">
          <div>
            <label htmlFor="sla-order-assignee" className="label-text">{t('orders.detail.assignTo')}</label>
            <select
              id="sla-order-assignee"
              className="input-field"
              value={assigneeChoice}
              onChange={(event) => setAssigneeChoice(event.target.value)}
              disabled={assigning || assigneesLoading || assigneesError}
              required
            >
              <option value="">{t('orders.detail.selectAssignee')}</option>
              {assignees.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>{assignee.firstName} {assignee.lastName}</option>
              ))}
            </select>
            {assigneesError && <p className="mt-2 text-sm text-red-600">{t('orders.detail.assigneesError')}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => { setAssigningOrder(null); setAssigneeChoice(''); }} disabled={assigning}>{t('common.cancel')}</button>
            <button type="submit" className="btn-primary" disabled={assigning || assigneesLoading || assigneesError || !assigneeChoice || assigneeChoice === assigningOrder?.assignedTo}>
              {assigning && <Loader2 size={16} className="animate-spin" />}{t('orders.detail.assign')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(quickTransition)}
        onClose={() => { if (!transitionBusy) setQuickTransition(null); }}
        title={t('orders.slaTransitionTitle', { number: quickTransition?.orderNumber || '' })}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            {t(quickTransition?.action === 'approve' ? 'orders.slaApproveConfirm' : 'orders.slaProcessConfirm')}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setQuickTransition(null)} disabled={transitionBusy}>{t('common.cancel')}</button>
            <button type="button" className="btn-primary" onClick={() => { void confirmQuickTransition(); }} disabled={transitionBusy}>
              {transitionBusy && <Loader2 size={16} className="animate-spin" />}
              {t(quickTransition?.action === 'approve' ? 'orders.detail.approve' : 'orders.detail.startProgress')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => { setShowCreate(false); resetCreateForm(); }} title={t('orders.createModal.title')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="order-create-type" className="label-text">{t('orders.createModal.type')}</label>
              <select id="order-create-type" name="orderType" className="input-field" value={createType} onChange={(event) => { setCreateType(event.target.value); if (event.target.value === 'scan') setSelectedBoxes([]); }} required>
                <option value="checkout">{t('orders.typeIssue')}</option>
                <option value="return_order">{t('orders.typeReturn')}</option>
                <option value="transfer">{t('orders.typeTransfer')}</option>
                <option value="disposal">{t('orders.typeDestruction')}</option>
                <option value="scan">{t('orders.typeScan')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="order-create-priority" className="label-text">{t('orders.createModal.priority')}</label>
              <select id="order-create-priority" name="priority" className="input-field" value={createPriority} onChange={(event) => setCreatePriority(event.target.value)}>
                <option value="normal">{t('orders.createModal.priorityNormal')}</option>
                <option value="high">{t('orders.createModal.priorityHigh')}</option>
                <option value="urgent">{t('orders.createModal.priorityUrgent')}</option>
              </select>
            </div>
          </div>
          <OrderSlaPreview tenantId={activeTenantId} orderType={createType} priority={createPriority} enabled={showCreate} />
          {createType === 'scan' && <p className="text-sm text-gray-600">{t('orders.createModal.scanHint')}</p>}
          {createType !== 'scan' && <div>
            <label className="label-text">{t('orders.createModal.boxIds')}</label>
            <BoxPicker
              value={selectedBoxes}
              onChange={setSelectedBoxes}
              placeholder={t('orders.createModal.boxIdsPlaceholder')}
            />
          </div>}
          <div>
            <label className="label-text">{t('orders.createModal.folders')}</label>
            <FolderPicker
              value={selectedFolders}
              onChange={setSelectedFolders}
              placeholder={t('orders.createModal.foldersPlaceholder')}
            />
          </div>
          <div>
            <label className="label-text">{t('orders.createModal.documents')}</label>
            <DocumentPicker
              value={selectedDocuments}
              onChange={setSelectedDocuments}
              placeholder={t('orders.createModal.documentsPlaceholder')}
              includeTransferListItems={false}
            />
          </div>
          <div>
            <label htmlFor="order-create-notes" className="label-text">{t('orders.createModal.notes')}</label>
            <textarea id="order-create-notes" name="notes" className="input-field" rows={3} placeholder={t('orders.createModal.notesPlaceholder')} />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => { setShowCreate(false); resetCreateForm(); }} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={createOrder.isPending || selectedItemCount === 0} className="btn-primary">
              {createOrder.isPending ? t('common.creating') : t('orders.createModal.submit')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
