import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { useCreate } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import BoxPicker from '@/components/ui/BoxPicker';
import DocumentPicker from '@/components/ui/DocumentPicker';
import FolderPicker, { SelectedFolder } from '@/components/ui/FolderPicker';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { getApiErrorMessage } from '@/utils/apiError';
import toast from 'react-hot-toast';
import { ArchiveRestore, Box, FileText, Plus, RotateCcw } from 'lucide-react';

interface SelectedBox {
  id: string;
  boxNumber: string;
  title?: string;
}

interface SelectedDocument {
  id: string;
  title: string;
  source?: 'document' | 'transfer_list_item';
}

const ITEM_TYPE_ICON: Record<string, React.ReactNode> = {
  box: <Box size={16} className="text-blue-500" />,
  folder: <ArchiveRestore size={16} className="text-yellow-600" />,
  document: <FileText size={16} className="text-green-600" />,
  transfer_list_item: <FileText size={16} className="text-green-600" />,
  hr_folder: <FileText size={16} className="text-purple-600" />,
};

function toDateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getDefaultExpectedReturnDate() {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return toDateInputValue(date);
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('pl-PL') : '—';
}

export default function LoansPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedBoxes, setSelectedBoxes] = useState<SelectedBox[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<SelectedFolder[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<SelectedDocument[]>([]);
  const [priority, setPriority] = useState('normal');
  const [expectedReturnAt, setExpectedReturnAt] = useState(getDefaultExpectedReturnDate);
  const [notes, setNotes] = useState('');

  const { data: activeLoans = [], isLoading, refetch } = useQuery({
    queryKey: ['active-loans'],
    queryFn: async () => {
      const { data } = await api.get('/orders/loans/active');
      return data.data || [];
    },
  });

  const createLoan = useCreate('/orders', ['orders', 'active-loans'], t('loans.requestCreated'));
  const returnLoan = useMutation({
    mutationFn: async (item: any) => {
      const { data } = await api.patch(`/orders/${item.order.id}/items/${item.id}/return`);
      return data.data;
    },
    onSuccess: () => {
      toast.success(t('loans.returned'));
      refetch();
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['boxes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: any) => {
      toast.error(getApiErrorMessage(err, t('common.genericError')));
    },
  });

  const resetForm = () => {
    setSelectedBoxes([]);
    setSelectedFolders([]);
    setSelectedDocuments([]);
    setPriority('normal');
    setExpectedReturnAt(getDefaultExpectedReturnDate());
    setNotes('');
  };

  const handleCreateLoan = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const items = [
      ...selectedBoxes.map((box) => ({ boxId: box.id })),
      ...selectedFolders.map((folder) => (
        folder.source === 'transfer_list'
          ? { transferListItemId: folder.id }
          : { folderId: folder.id }
      )),
      ...selectedDocuments.map((doc) => (
        doc.source === 'transfer_list_item'
          ? { transferListItemId: doc.id }
          : { documentId: doc.id }
      )),
    ];
    if (items.length === 0) return;

    try {
      const created: any = await createLoan.mutateAsync({
        orderType: 'checkout',
        priority,
        expectedReturnAt,
        notes: notes || undefined,
        items,
      });
      setShowCreate(false);
      resetForm();
      refetch();
      if (created?.id) navigate(`/orders/${created.id}`);
    } catch {
      // Error toast is handled by useCreate.
    }
  };

  const handleReturnLoan = (item: any) => {
    if (!window.confirm(t('loans.returnConfirm'))) return;
    returnLoan.mutate(item);
  };

  const columns: Column<any>[] = [
    {
      key: 'itemType',
      header: t('loans.itemType'),
      render: (item) => (
        <span className="inline-flex items-center gap-2">
          {ITEM_TYPE_ICON[item.itemType] || <FileText size={16} />}
          {t(`loans.itemTypes.${item.itemType}`, { defaultValue: item.itemType })}
        </span>
      ),
    },
    {
      key: 'title',
      header: t('common.title'),
      render: (item) => <span className="font-medium">{item.title}</span>,
    },
    {
      key: 'box',
      header: t('boxes.boxNumber'),
      render: (item) => item.box?.boxNumber ? <span className="font-mono text-primary-700">{item.box.boxNumber}</span> : '—',
    },
    { key: 'location', header: t('boxes.location'), render: (item) => item.location || '—' },
    {
      key: 'borrower',
      header: t('loans.borrower'),
      render: (item) => item.order?.requester
        ? `${item.order.requester.firstName} ${item.order.requester.lastName}`
        : '—',
    },
    {
      key: 'deliveredAt',
      header: t('loans.borrowedAt'),
      render: (item) => item.deliveredAt ? new Date(item.deliveredAt).toLocaleString('pl-PL') : '—',
    },
    {
      key: 'expectedReturnAt',
      header: t('loans.expectedReturnAt'),
      render: (item) => {
        const dateValue = item.order?.expectedReturnAt;
        const isOverdue = dateValue && toDateInputValue(new Date(dateValue)) < toDateInputValue(new Date());
        return (
          <span className={isOverdue ? 'font-medium text-red-600' : ''}>
            {formatDate(dateValue)}
          </span>
        );
      },
    },
    {
      key: 'order',
      header: t('orders.title'),
      render: (item) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/orders/${item.order.id}`);
          }}
          className="font-mono text-primary-700 hover:underline"
        >
          {item.order.orderNumber}
        </button>
      ),
    },
    ...(hasPermission('order.complete') ? [{
      key: 'actions',
      header: t('common.actions'),
      render: (item: any) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleReturnLoan(item);
          }}
          disabled={returnLoan.isPending}
          className="btn-secondary text-xs whitespace-nowrap"
        >
          <RotateCcw size={14} /> {t('loans.returnAction')}
        </button>
      ),
    }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('loans.title')}</h1>
          <p className="text-sm text-gray-500">{t('loans.subtitle')}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary w-full sm:w-auto">
          <Plus size={16} /> {t('loans.newRequest')}
        </button>
      </div>

      <div className="card">
        <DataTable
          columns={columns}
          data={activeLoans}
          isLoading={isLoading}
          onRowClick={(item) => navigate(`/orders/${item.order.id}`)}
          emptyMessage={t('loans.empty')}
        />
      </div>

      <Modal
        isOpen={showCreate}
        onClose={() => { setShowCreate(false); resetForm(); }}
        title={t('loans.createModal.title')}
        size="lg"
      >
        <form onSubmit={handleCreateLoan} className="space-y-4">
          <div>
            <label className="label-text">{t('loans.createModal.boxes')}</label>
            <BoxPicker
              value={selectedBoxes}
              onChange={setSelectedBoxes}
              placeholder={t('orders.createModal.boxIdsPlaceholder')}
              showLocation
            />
          </div>

          <div>
            <label className="label-text">{t('loans.createModal.folders')}</label>
            <FolderPicker
              value={selectedFolders}
              onChange={setSelectedFolders}
              placeholder={t('loans.folderSearchPlaceholder')}
            />
          </div>

          <div>
            <label className="label-text">{t('loans.createModal.documents')}</label>
            <DocumentPicker
              value={selectedDocuments}
              onChange={setSelectedDocuments}
              placeholder={t('loans.documentSearchPlaceholder')}
              includeTransferListItems={false}
            />
          </div>

          <div>
            <label htmlFor="loan-priority" className="label-text">{t('orders.createModal.priority')}</label>
            <select id="loan-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="input-field">
              <option value="normal">{t('orders.createModal.priorityNormal')}</option>
              <option value="high">{t('orders.createModal.priorityHigh')}</option>
              <option value="urgent">{t('orders.createModal.priorityUrgent')}</option>
            </select>
          </div>

          <div>
            <label htmlFor="loan-expected-return" className="label-text">{t('loans.createModal.expectedReturnAt')}</label>
            <input
              id="loan-expected-return"
              type="date"
              value={expectedReturnAt}
              min={toDateInputValue(new Date())}
              onChange={(e) => setExpectedReturnAt(e.target.value)}
              className="input-field"
            />
          </div>

          <div>
            <label htmlFor="loan-notes" className="label-text">{t('orders.createModal.notes')}</label>
            <textarea
              id="loan-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input-field"
              rows={3}
              placeholder={t('loans.createModal.notesPlaceholder')}
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => { setShowCreate(false); resetForm(); }} className="btn-secondary">
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={createLoan.isPending || !expectedReturnAt || (selectedBoxes.length + selectedFolders.length + selectedDocuments.length === 0)}
              className="btn-primary"
            >
              {createLoan.isPending ? t('common.creating') : t('loans.createModal.submit')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
