import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createBoxSchema, DOC_TYPES } from '@archivecore/shared';
import { z } from 'zod';
import { useList, useCreate } from '@/hooks/useApi';
import { useExport } from '@/hooks/useExport';
import { useConfirm } from '@/hooks/useConfirm';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import DataTable, { Column } from '@/components/ui/DataTable';
import Pagination from '@/components/ui/Pagination';
import StatusBadge from '@/components/ui/StatusBadge';
import BulkActionBar from '@/components/ui/BulkActionBar';
import Modal from '@/components/ui/Modal';
import FormField from '@/components/ui/FormField';
import LocationPicker from '@/components/ui/LocationPicker';
import toast from 'react-hot-toast';
import { Plus, Download, Loader2, RefreshCw, MapPin } from 'lucide-react';

type CreateBoxForm = z.infer<typeof createBoxSchema>;

export default function BoxListPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [showCreateModal, setShowCreateModal] = useState(searchParams.get('action') === 'create');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);
  const [showBulkMoveModal, setShowBulkMoveModal] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkLocationId, setBulkLocationId] = useState('');
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [filters, setFilters] = useState({
    search: searchParams.get('search') || '',
    status: searchParams.get('status') || '',
    docType: searchParams.get('docType') || '',
  });

  const { data, isLoading, refetch } = useList('boxes', '/boxes', {
    page,
    limit: 20,
    ...filters,
  });

  const createBox = useCreate('/boxes', ['boxes'], t('common.success'));
  const { exportData, isExporting } = useExport({ endpoint: '/export/boxes', defaultFilename: 'kartony.xlsx' });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<CreateBoxForm>({
    resolver: zodResolver(createBoxSchema),
    defaultValues: {
      title: '',
      docType: '',
      description: '',
      notes: '',
    },
  });

  const columns: Column<any>[] = [
    {
      key: 'boxNumber',
      header: t('boxes.boxNumber'),
      render: (item) => <span className="font-mono font-medium text-primary-700">{item.boxNumber}</span>,
    },
    { key: 'title', header: t('common.title'), className: 'max-w-xs truncate' },
    {
      key: 'status',
      header: t('common.status'),
      render: (item) => <StatusBadge status={item.status} type="box" />,
    },
    {
      key: 'location',
      header: t('boxes.location'),
      render: (item) => (
        <span className="text-gray-500 text-xs">{item.location?.fullPath || '—'}</span>
      ),
    },
    { key: 'docType', header: t('boxes.docType'), render: (item) => item.docType || '—' },
    {
      key: '_count',
      header: t('boxes.folders'),
      render: (item) => item._count?.folders ?? 0,
    },
    {
      key: 'createdAt',
      header: t('boxes.createdAt'),
      render: (item) => new Date(item.createdAt).toLocaleDateString('pl-PL'),
    },
  ];

  const onCreateSubmit = async (formData: CreateBoxForm) => {
    await createBox.mutateAsync({
      title: formData.title,
      docType: formData.docType || undefined,
      description: formData.description || undefined,
      locationId: formData.locationId || undefined,
      notes: formData.notes || undefined,
    });
    setShowCreateModal(false);
    reset();
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    reset();
  };

  // ─── Bulk actions ─────────────────────────────────────
  const handleBulkStatusChange = async () => {
    if (!bulkStatus) return;
    const ok = await confirm({
      title: t('boxes.bulk.confirmStatus'),
      message: t('boxes.bulk.confirmStatusMsg', { count: selectedIds.size, status: bulkStatus }),
      confirmLabel: t('boxes.bulk.change'),
      variant: 'warning',
    });
    if (!ok) return;
    setBulkLoading(true);
    try {
      await api.post('/boxes/bulk-status', { ids: Array.from(selectedIds), status: bulkStatus });
      toast.success(t('boxes.bulk.statusUpdated', { count: selectedIds.size }));
      setSelectedIds(new Set());
      setShowBulkStatusModal(false);
      setBulkStatus('');
      refetch();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('boxes.bulk.statusError'));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkMove = async () => {
    if (!bulkLocationId) return;
    setBulkLoading(true);
    try {
      await api.post('/boxes/bulk-move', { ids: Array.from(selectedIds), locationId: bulkLocationId });
      toast.success(t('boxes.bulk.moveSuccess', { count: selectedIds.size }));
      setSelectedIds(new Set());
      setShowBulkMoveModal(false);
      setBulkLocationId('');
      refetch();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('boxes.bulk.moveError'));
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('boxes.title')}</h1>
          <p className="text-sm text-gray-500">{t('boxes.subtitle')}</p>
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
          <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} />
            <span className="hidden sm:inline">{t('boxes.newBox')}</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder={t('boxes.searchPlaceholder')}
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="input-field"
              aria-label={t('boxes.searchPlaceholder')}
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="input-field w-40"
            aria-label={t('boxes.allStatuses')}
          >
            <option value="">{t('boxes.allStatuses')}</option>
            <option value="active">{t('boxes.statusActive')}</option>
            <option value="checked_out">{t('boxes.statusIssued')}</option>
            <option value="pending_disposal">{t('boxes.statusForDestruction')}</option>
            <option value="disposed">{t('boxes.statusDestroyed')}</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0">
        <DataTable
          columns={columns}
          data={data?.data || []}
          isLoading={isLoading}
          onRowClick={(item) => navigate(`/boxes/${item.id}`)}
          emptyMessage={t('boxes.empty')}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
        {data?.meta && (
          <div className="px-4 pb-4">
            <Pagination
              page={page}
              limit={20}
              total={data.meta.total}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {/* Bulk Action Bar */}
      <BulkActionBar
        count={selectedIds.size}
        onClearSelection={() => setSelectedIds(new Set())}
        actions={[
          {
            label: t('boxes.bulk.changeStatus'),
            icon: <RefreshCw size={14} />,
            onClick: () => setShowBulkStatusModal(true),
            variant: 'primary',
          },
          {
            label: t('boxes.bulk.move'),
            icon: <MapPin size={14} />,
            onClick: () => setShowBulkMoveModal(true),
            variant: 'secondary',
          },
          {
            label: t('boxes.bulk.exportSelected'),
            icon: <Download size={14} />,
            onClick: () => exportData({ format: 'xlsx', ...filters }),
            variant: 'secondary',
          },
        ]}
      />

      {/* Bulk Status Modal */}
      <Modal isOpen={showBulkStatusModal} onClose={() => setShowBulkStatusModal(false)} title={t('boxes.bulk.changeStatus')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{t('boxes.bulk.selectedCount', { count: selectedIds.size })}</p>
          <div>
            <label htmlFor="bulk-newStatus" className="label-text">{t('boxes.bulk.newStatus')}</label>
            <select id="bulk-newStatus" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className="input-field">
              <option value="">---</option>
              <option value="active">{t('boxes.statusActive')}</option>
              <option value="checked_out">{t('boxes.statusIssued')}</option>
              <option value="pending_disposal">{t('boxes.statusForDestruction')}</option>
              <option value="disposed">{t('boxes.statusDestroyed')}</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowBulkStatusModal(false)} className="btn-secondary">{t('common.cancel')}</button>
            <button onClick={handleBulkStatusChange} disabled={!bulkStatus || bulkLoading} className="btn-primary">
              {bulkLoading ? t('common.processing') : t('boxes.bulk.change')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Move Modal */}
      <Modal isOpen={showBulkMoveModal} onClose={() => setShowBulkMoveModal(false)} title={t('boxes.bulk.moveTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{t('boxes.bulk.selectedCount', { count: selectedIds.size })}</p>
          <div>
            <label htmlFor="bulk-locationId" className="label-text">{t('boxes.bulk.locationId')}</label>
            <LocationPicker
              value={bulkLocationId}
              onChange={setBulkLocationId}
              excludeTypes={['warehouse', 'zone', 'rack']}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowBulkMoveModal(false)} className="btn-secondary">{t('common.cancel')}</button>
            <button onClick={handleBulkMove} disabled={!bulkLocationId || bulkLoading} className="btn-primary">
              {bulkLoading ? t('common.processing') : t('boxes.bulk.move')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Create Modal */}
      <Modal isOpen={showCreateModal} onClose={handleCloseModal} title={t('boxes.createModal.title')} size="lg">
        <form onSubmit={handleSubmit(onCreateSubmit)} className="space-y-4">
          <FormField label={t('boxes.createModal.fieldTitle')} required error={errors.title?.message}>
            <input
              {...register('title')}
              className={`input-field ${errors.title ? 'border-red-300 focus:ring-red-500' : ''}`}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label={t('boxes.createModal.fieldDocType')} error={errors.docType?.message}>
              <select {...register('docType')} className="input-field">
                <option value="">{t('common.all')}</option>
                {DOC_TYPES.map(dt => (
                  <option key={dt} value={dt}>{t(`docTypes.${dt}`, { defaultValue: dt })}</option>
                ))}
              </select>
            </FormField>
            <FormField label={t('boxes.bulk.locationId')} error={errors.locationId?.message}>
              <LocationPicker
                value={watch('locationId') || ''}
                onChange={(id) => setValue('locationId', id)}
                excludeTypes={['warehouse', 'zone', 'rack']}
              />
            </FormField>
          </div>

          <FormField label={t('boxes.createModal.fieldDescription')} error={errors.description?.message}>
            <textarea {...register('description')} className="input-field" rows={3} />
          </FormField>

          <FormField label={t('common.notes')} error={errors.notes?.message}>
            <textarea {...register('notes')} className="input-field" rows={2} placeholder={t('boxes.createModal.fieldNotes')} />
          </FormField>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={handleCloseModal} className="btn-secondary">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={createBox.isPending} className="btn-primary">
              {createBox.isPending ? t('common.creating') : t('boxes.createModal.submit')}
            </button>
          </div>
        </form>
      </Modal>

      {ConfirmDialogElement}
    </div>
  );
}
