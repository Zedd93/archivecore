import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { useCreate } from '@/hooks/useApi';
import BoxPicker from '@/components/ui/BoxPicker';
import DocumentPicker from '@/components/ui/DocumentPicker';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { ArchiveRestore, Box, FileText, Plus } from 'lucide-react';

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

export default function LoansPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedBoxes, setSelectedBoxes] = useState<SelectedBox[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<SelectedDocument[]>([]);
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');

  const { data: activeLoans = [], isLoading, refetch } = useQuery({
    queryKey: ['active-loans'],
    queryFn: async () => {
      const { data } = await api.get('/orders/loans/active');
      return data.data || [];
    },
  });

  const createLoan = useCreate('/orders', ['orders', 'active-loans'], t('loans.requestCreated'));

  const resetForm = () => {
    setSelectedBoxes([]);
    setSelectedDocuments([]);
    setPriority('normal');
    setNotes('');
  };

  const handleCreateLoan = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const items = [
      ...selectedBoxes.map((box) => ({ boxId: box.id })),
      ...selectedDocuments.map((doc) => (
        doc.source === 'transfer_list_item'
          ? { transferListItemId: doc.id }
          : { documentId: doc.id }
      )),
    ];
    if (items.length === 0) return;

    const created: any = await createLoan.mutateAsync({
      orderType: 'checkout',
      priority,
      notes: notes || undefined,
      items,
    });
    setShowCreate(false);
    resetForm();
    refetch();
    if (created?.id) navigate(`/orders/${created.id}`);
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
            <label className="label-text">{t('loans.createModal.documents')}</label>
            <DocumentPicker
              value={selectedDocuments}
              onChange={setSelectedDocuments}
              placeholder={t('loans.documentSearchPlaceholder')}
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
              disabled={createLoan.isPending || (selectedBoxes.length + selectedDocuments.length === 0)}
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
