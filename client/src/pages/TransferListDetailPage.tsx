import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDetail, useList, useCreate, useUpdate, useDelete } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import Pagination from '@/components/ui/Pagination';
import Modal from '@/components/ui/Modal';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import api from '@/services/api';
import toast from 'react-hot-toast';
import {
  Upload, Plus, Trash2, Edit2, Check, X,
  FileSpreadsheet, Filter, Search, CheckCircle2, Archive, Box,
  Loader2, XCircle, MapPin, CalendarDays,
} from 'lucide-react';
import { SkeletonDetailPage } from '@/components/ui/Skeleton';
import { TRANSFER_LIST_STATUS_COLORS as STATUS_COLORS } from '@/constants/statusColors';
import { getApiErrorMessage } from '@/utils/apiError';
import { normalizeDisplayText } from '@archivecore/shared';

const CATEGORY_OPTIONS = ['A', 'B2', 'B5', 'B10', 'B15', 'B20', 'B25', 'B50', 'BE5', 'BE10', 'BE25', 'BE50', 'Bc'];
const ITEM_PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

// ─── Local transfer-list box number input ───────────────
function BoxNumberInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="relative">
        <Box size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field pl-9"
          placeholder={t('transferLists.detail.boxPlaceholder')}
          autoComplete="off"
        />
      </div>
      <p className="mt-1 text-xs text-gray-500">{t('transferLists.detail.localBoxNumberHint')}</p>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────
export default function TransferListDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const STATUS_LABELS: Record<string, string> = {
    draft: t('transferLists.statusDraft'),
    confirmed: t('transferLists.statusConfirmed'),
    archived: t('transferLists.statusArchived'),
  };

  // Filters
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [boxFilter, setBoxFilter] = useState('');

  // Modals
  const [showAddItem, setShowAddItem] = useState(false);
  const [showEditListTitle, setShowEditListTitle] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [editListTitle, setEditListTitle] = useState('');
  const [updatingListTitle, setUpdatingListTitle] = useState(false);

  // Selection & bulk actions
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'none' | 'assignBox' | 'storageLocation' | 'disposalDate'>('none');
  const [bulkBoxNumber, setBulkBoxNumber] = useState('');
  const [bulkStorageLocation, setBulkStorageLocation] = useState('');
  const [bulkDisposalDate, setBulkDisposalDate] = useState('');
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // Form state for add/edit
  const [form, setForm] = useState({
    folderSignature: '',
    folderTitle: '',
    dateFrom: '',
    dateTo: '',
    categoryCode: 'B10',
    folderCount: 1,
    storageLocation: '',
    disposalOrTransferDate: '',
    notes: '',
    boxNumber: '',
  });

  const { confirm, ConfirmDialogElement } = useConfirm();
  const canWrite = hasPermission('transfer_list.write');
  const canImport = hasPermission('transfer_list.import');

  // Fetch transfer list details
  const { data: list, isLoading: listLoading, refetch: refetchList } = useDetail(
    'transfer-list', '/transfer-lists', id
  );

  // Fetch items with pagination + filters
  const itemParams: any = { page, limit: pageSize };
  if (search) itemParams.search = search;
  if (categoryFilter) itemParams.categoryCode = categoryFilter;
  if (boxFilter) itemParams.hasBox = boxFilter;

  const { data: itemsResult, isLoading: itemsLoading, refetch: refetchItems } = useList(
    'transfer-list-items',
    `/transfer-lists/${id}/items`,
    itemParams,
    { enabled: !!id }
  );

  const addItemMutation = useCreate(`/transfer-lists/${id}/items`, ['transfer-list-items', 'transfer-list'], t('transferLists.detail.itemAdded'));
  const deleteItemMutation = useDelete(`/transfer-lists/${id}/items`, ['transfer-list-items', 'transfer-list'], t('transferLists.detail.itemDeleted'));

  const items = itemsResult?.data || [];
  const itemsPagination = (itemsResult as any)?.pagination;
  const getItemStorageLocation = (item: any) => item.storageLocation || item.box?.location?.fullPath || '';
  const getItemSourceBoxNumber = (item: any) => item.sourceBoxNumber || item.box?.boxNumber || '';
  const handlePageSizeChange = (limit: number) => {
    setPageSize(limit);
    setPage(1);
    setSelectedItemIds(new Set());
  };

  const resetForm = () => {
    setForm({
      folderSignature: '', folderTitle: '', dateFrom: '', dateTo: '',
      categoryCode: 'B10', folderCount: 1, storageLocation: '',
      disposalOrTransferDate: '', notes: '', boxNumber: '',
    });
  };

  const updateFormField = (field: keyof typeof form, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addItemMutation.mutateAsync({
        folderSignature: form.folderSignature,
        folderTitle: form.folderTitle,
        categoryCode: form.categoryCode,
        folderCount: Number(form.folderCount),
        dateFrom: form.dateFrom || null,
        dateTo: form.dateTo || null,
        disposalOrTransferDate: form.disposalOrTransferDate || null,
        storageLocation: form.storageLocation || null,
        notes: form.notes || null,
        boxNumber: form.boxNumber || null,
      });
      setShowAddItem(false);
      resetForm();
      refetchItems();
    } catch {
      // Error handled by mutation onError callback
    }
  };

  const handleEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    try {
      await api.put(`/transfer-lists/${id}/items/${editingItem.id}`, {
        folderSignature: form.folderSignature,
        folderTitle: form.folderTitle,
        categoryCode: form.categoryCode,
        folderCount: Number(form.folderCount),
        dateFrom: form.dateFrom || null,
        dateTo: form.dateTo || null,
        disposalOrTransferDate: form.disposalOrTransferDate || null,
        storageLocation: form.storageLocation || null,
        notes: form.notes || null,
        boxNumber: form.boxNumber || null,
      });
      toast.success(t('transferLists.detail.itemUpdated'));
      setEditingItem(null);
      resetForm();
      refetchItems();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('transferLists.detail.updateError')));
    }
  };

  const openEditItem = (item: any) => {
    setForm({
      folderSignature: item.folderSignature || '',
      folderTitle: item.folderTitle || '',
      dateFrom: item.dateFrom ? item.dateFrom.split('T')[0] : '',
      dateTo: item.dateTo ? item.dateTo.split('T')[0] : '',
      categoryCode: item.categoryCode || 'B10',
      folderCount: item.folderCount || 1,
      storageLocation: item.storageLocation || '',
      disposalOrTransferDate: item.disposalOrTransferDate ? item.disposalOrTransferDate.split('T')[0] : '',
      notes: item.notes || '',
      boxNumber: getItemSourceBoxNumber(item),
    });
    setEditingItem(item);
  };

  const handleDeleteItem = async (itemId: string) => {
    const ok = await confirm({
      title: t('transferLists.detail.confirmDeleteItem'),
      message: t('transferLists.detail.confirmDeleteItemMsg'),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!ok) return;
    await deleteItemMutation.mutateAsync(itemId);
    refetchItems();
  };

  // Import
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data } = await api.post(`/transfer-lists/${id}/import`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      toast.success(t('transferLists.detail.importedItems', { count: data.data.imported }));
      refetchItems();
      refetchList();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('transferLists.detail.importError')));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await api.patch(`/transfer-lists/${id}/status`, { status: newStatus });
      toast.success(t('transferLists.detail.statusChanged', { status: STATUS_LABELS[newStatus] }));
      refetchList();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('transferLists.detail.statusError')));
    }
  };

  const openEditListTitle = () => {
    setEditListTitle(normalizeDisplayText(list.title));
    setShowEditListTitle(true);
  };

  const handleUpdateListTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextTitle = normalizeDisplayText(editListTitle).trim();
    if (!nextTitle) {
      toast.error(t('transferLists.detail.titleRequired'));
      return;
    }

    setUpdatingListTitle(true);
    try {
      await api.put(`/transfer-lists/${id}`, { title: nextTitle });
      toast.success(t('transferLists.detail.titleUpdated'));
      setShowEditListTitle(false);
      refetchList();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('transferLists.detail.titleUpdateError')));
    } finally {
      setUpdatingListTitle(false);
    }
  };

  // ─── Selection helpers ────────────────────────────────
  const toggleItemSelect = (itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleSelectAllItems = () => {
    if (selectedItemIds.size === items.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(items.map((i: any) => i.id)));
    }
  };

  // ─── Bulk handlers ──────────────────────────────────
  const handleBulkDeleteItems = async () => {
    const ok = await confirm({
      title: t('transferLists.detail.confirmDeleteItem'),
      message: t('transferLists.detail.confirmDeleteItemMsg'),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!ok) return;
    setBulkProcessing(true);
    try {
      const { data } = await api.post(`/transfer-lists/${id}/items/bulk-delete`, {
        itemIds: Array.from(selectedItemIds),
      });
      toast.success(t('transferLists.detail.bulkDeleted', { count: data.data.deleted }));
      setSelectedItemIds(new Set());
      refetchItems();
      refetchList();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('transferLists.detail.bulkDeleteError')));
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkAssignBox = async () => {
    if (!bulkBoxNumber.trim()) {
      toast.error(t('transferLists.detail.enterBoxNumber'));
      return;
    }
    setBulkProcessing(true);
    try {
      const { data } = await api.post(`/transfer-lists/${id}/items/bulk-assign-box`, {
        itemIds: Array.from(selectedItemIds),
        boxNumber: bulkBoxNumber.trim(),
      });
      toast.success(t('transferLists.detail.assigned', {
        count: data.data.updated,
        boxNumber: data.data.sourceBoxNumber || bulkBoxNumber.trim(),
      }));
      setSelectedItemIds(new Set());
      setBulkAction('none');
      setBulkBoxNumber('');
      refetchItems();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('transferLists.detail.assignError')));
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkRemoveBox = async () => {
    const ok = await confirm({
      title: t('transferLists.detail.confirmUnassign'),
      message: t('transferLists.detail.confirmUnassignMsg', { count: selectedItemIds.size }),
      confirmLabel: t('transferLists.detail.unassign'),
      variant: 'warning',
    });
    if (!ok) return;
    setBulkProcessing(true);
    try {
      const { data } = await api.post(`/transfer-lists/${id}/items/bulk-assign-box`, {
        itemIds: Array.from(selectedItemIds),
        boxNumber: null,
      });
      toast.success(t('transferLists.detail.unassigned', { count: data.data.updated }));
      setSelectedItemIds(new Set());
      refetchItems();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('transferLists.detail.unassignError')));
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkUpdateStorageLocation = async () => {
    if (!bulkStorageLocation.trim()) {
      toast.error(t('transferLists.detail.enterStorageLocation'));
      return;
    }
    setBulkProcessing(true);
    try {
      const { data } = await api.post(`/transfer-lists/${id}/items/bulk-storage-location`, {
        itemIds: Array.from(selectedItemIds),
        storageLocation: bulkStorageLocation.trim(),
      });
      toast.success(t('transferLists.detail.storageLocationUpdated', { count: data.data.updated }));
      setSelectedItemIds(new Set());
      setBulkAction('none');
      setBulkStorageLocation('');
      refetchItems();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('transferLists.detail.storageLocationError')));
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkUpdateDisposalDate = async () => {
    if (!bulkDisposalDate) {
      toast.error(t('transferLists.detail.enterDisposalDate'));
      return;
    }
    setBulkProcessing(true);
    try {
      const { data } = await api.post(`/transfer-lists/${id}/items/bulk-disposal-date`, {
        itemIds: Array.from(selectedItemIds),
        disposalOrTransferDate: bulkDisposalDate,
      });
      toast.success(t('transferLists.detail.disposalDateUpdated', { count: data.data.updated }));
      setSelectedItemIds(new Set());
      setBulkAction('none');
      setBulkDisposalDate('');
      refetchItems();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('transferLists.detail.disposalDateError')));
    } finally {
      setBulkProcessing(false);
    }
  };

  if (listLoading) {
    return <SkeletonDetailPage />;
  }

  if (!list) {
    return <div className="card p-8 text-center text-gray-500">{t('transferLists.detail.notFound')}</div>;
  }

  const canEditItems = canWrite && list.status === 'draft';
  const addItemDisabledReason = !canWrite
    ? t('transferLists.detail.addItemNoPermission')
    : list.status !== 'draft'
      ? t('transferLists.detail.addItemLocked')
      : '';

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: t('layout.nav.transferLists'), to: '/transfer-lists' }, { label: list.listNumber || normalizeDisplayText(list.title) }]} />

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 break-words">{normalizeDisplayText(list.title)}</h1>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[list.status]}`}>
              {STATUS_LABELS[list.status]}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
            <span className="font-mono">{list.listNumber}</span>
            {list.transferringUnit && <span>{list.transferringUnit} → {list.receivingUnit || '—'}</span>}
            {list.transferDate && (
              <span>{t('transferLists.detail.dateLabel')}{new Date(list.transferDate).toLocaleDateString('pl-PL')}</span>
            )}
            <span>{t('transferLists.detail.itemsCount')}{list.items?.length ?? 0}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {canWrite && (
            <button
              onClick={openEditListTitle}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <Edit2 size={16} />
              {t('transferLists.detail.editTitle')}
            </button>
          )}
          {canWrite && list.status === 'draft' && (
            <button
              onClick={() => handleStatusChange('confirmed')}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <CheckCircle2 size={16} />
              {t('transferLists.detail.confirm')}
            </button>
          )}
          {canWrite && list.status === 'confirmed' && (
            <>
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: t('transferLists.detail.rejectConfirm'),
                    message: t('transferLists.detail.rejectConfirmMsg'),
                    confirmLabel: t('transferLists.detail.reject'),
                    variant: 'warning',
                  });
                  if (ok) handleStatusChange('draft');
                }}
                className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition-colors"
              >
                <XCircle size={16} />
                {t('transferLists.detail.reject')}
              </button>
              <button
                onClick={() => handleStatusChange('archived')}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <Archive size={16} />
                {t('transferLists.detail.archive')}
              </button>
            </>
          )}
          {canImport && list.status === 'draft' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleImportFile}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <Upload size={16} />
                {importing ? t('transferLists.importModal.submitting') : t('transferLists.detail.importExcel')}
              </button>
            </>
          )}
          <button
            onClick={() => {
              if (canEditItems) setShowAddItem(true);
            }}
            disabled={!canEditItems}
            title={addItemDisabledReason || undefined}
            className={`flex items-center gap-2 text-sm ${
              canEditItems ? 'btn-primary' : 'btn-secondary opacity-60 cursor-not-allowed'
            }`}
          >
              <Plus size={16} />
              {t('transferLists.detail.addItem')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={t('transferLists.detail.searchPlaceholder')}
              className="input-field pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              className="input-field w-auto"
            >
              <option value="">{t('transferLists.detail.categoryFilter')}</option>
              {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={boxFilter}
              onChange={(e) => { setBoxFilter(e.target.value); setPage(1); }}
              className="input-field w-auto"
            >
              <option value="">{t('transferLists.detail.boxFilter')}</option>
              <option value="true">{t('transferLists.detail.boxFilterWith')}</option>
              <option value="false">{t('transferLists.detail.boxFilterWithout')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Import help */}
      {canImport && list.status === 'draft' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <FileSpreadsheet size={20} className="text-blue-600 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-blue-900">{t('transferLists.detail.importTitle')}</h3>
              <p className="text-xs text-blue-700 mt-1">
                {t('transferLists.detail.importDesc')}
              </p>
            </div>
          </div>
        </div>
      )}

      {!canEditItems && addItemDisabledReason && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          {addItemDisabledReason}
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selectedItemIds.size > 0 && canEditItems && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-indigo-800 font-medium">
              {t('common.selected', { count: selectedItemIds.size })}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSelectedItemIds(new Set())}
                className="btn-secondary text-sm py-1.5 px-3"
              >
                {t('common.deselect')}
              </button>
              <button
                onClick={() => { setBulkAction('assignBox'); setBulkBoxNumber(''); }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm py-1.5 px-3 rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Box size={14} />
                {t('transferLists.detail.assignBox')}
              </button>
              <button
                onClick={() => { setBulkAction('storageLocation'); setBulkStorageLocation(''); }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm py-1.5 px-3 rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <MapPin size={14} />
                {t('transferLists.detail.assignStorageLocation')}
              </button>
              <button
                onClick={() => { setBulkAction('disposalDate'); setBulkDisposalDate(''); }}
                className="bg-sky-600 hover:bg-sky-700 text-white text-sm py-1.5 px-3 rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <CalendarDays size={14} />
                {t('transferLists.detail.assignDisposalDate')}
              </button>
              <button
                onClick={handleBulkRemoveBox}
                disabled={bulkProcessing}
                className="bg-orange-500 hover:bg-orange-600 text-white text-sm py-1.5 px-3 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <XCircle size={14} />
                {t('transferLists.detail.unassignBox')}
              </button>
              <button
                onClick={handleBulkDeleteItems}
                disabled={bulkProcessing}
                className="bg-red-600 hover:bg-red-700 text-white text-sm py-1.5 px-3 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {bulkProcessing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {t('transferLists.detail.deleteSelected')}
              </button>
            </div>
          </div>

          {bulkAction === 'assignBox' && (
            <div className="mt-3 pt-3 border-t border-indigo-200 flex flex-wrap items-end gap-3">
              <div className="flex-1 max-w-sm">
                <label htmlFor="bulk-assign-boxNumber" className="text-xs font-medium text-indigo-700 mb-1 block">{t('transferLists.detail.boxNumber')}</label>
                <BoxNumberInput
                  value={bulkBoxNumber}
                  onChange={(val) => setBulkBoxNumber(val)}
                />
              </div>
              <button
                onClick={handleBulkAssignBox}
                disabled={bulkProcessing || !bulkBoxNumber.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm py-2 px-4 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {bulkProcessing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {t('transferLists.detail.assign')}
              </button>
              <button
                onClick={() => { setBulkAction('none'); setBulkBoxNumber(''); }}
                className="btn-secondary text-sm py-2 px-3"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}

          {bulkAction === 'storageLocation' && (
            <div className="mt-3 pt-3 border-t border-indigo-200 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[240px] max-w-xl">
                <label htmlFor="bulk-storage-location" className="text-xs font-medium text-indigo-700 mb-1 block">{t('transferLists.detail.storageLocation')}</label>
                <input
                  id="bulk-storage-location"
                  type="text"
                  value={bulkStorageLocation}
                  onChange={(e) => setBulkStorageLocation(e.target.value)}
                  className="input"
                  placeholder={t('transferLists.detail.storageLocationPlaceholder')}
                />
              </div>
              <button
                onClick={handleBulkUpdateStorageLocation}
                disabled={bulkProcessing || !bulkStorageLocation.trim()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm py-2 px-4 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {bulkProcessing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {t('transferLists.detail.assign')}
              </button>
              <button
                onClick={() => { setBulkAction('none'); setBulkStorageLocation(''); }}
                className="btn-secondary text-sm py-2 px-3"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}

          {bulkAction === 'disposalDate' && (
            <div className="mt-3 pt-3 border-t border-indigo-200 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px] max-w-sm">
                <label htmlFor="bulk-disposal-date" className="text-xs font-medium text-indigo-700 mb-1 block">{t('transferLists.detail.destructionDate')}</label>
                <input
                  id="bulk-disposal-date"
                  type="date"
                  value={bulkDisposalDate}
                  onChange={(e) => setBulkDisposalDate(e.target.value)}
                  className="input"
                />
              </div>
              <button
                onClick={handleBulkUpdateDisposalDate}
                disabled={bulkProcessing || !bulkDisposalDate}
                className="bg-sky-600 hover:bg-sky-700 text-white text-sm py-2 px-4 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {bulkProcessing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {t('transferLists.detail.assign')}
              </button>
              <button
                onClick={() => { setBulkAction('none'); setBulkDisposalDate(''); }}
                className="btn-secondary text-sm py-2 px-3"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Items Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {canEditItems && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={items.length > 0 && selectedItemIds.size === items.length}
                      onChange={toggleSelectAllItems}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                  </th>
                )}
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-12">{t('transferLists.detail.colOrdinal')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">{t('transferLists.detail.colFolderSign')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[250px]">{t('transferLists.detail.colFolderTitle')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">{t('transferLists.detail.colDateRange')}</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-16">{t('transferLists.detail.colCategory')}</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-16">{t('transferLists.detail.colFolders')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-40">{t('transferLists.detail.colStorage')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">{t('transferLists.detail.colDisposalDate')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">{t('transferLists.detail.colBox')}</th>
                {canEditItems && (
                  <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">{t('transferLists.detail.colActions')}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {itemsLoading ? (
                <tr>
                  <td colSpan={canEditItems ? 11 : 10} className="px-3 py-12 text-center text-gray-400">{t('common.loading')}</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={canEditItems ? 11 : 10} className="px-3 py-12 text-center text-gray-400">
                    <FileSpreadsheet size={40} className="mx-auto text-gray-300 mb-2" />
                    <p>{t('transferLists.detail.emptyItems')}</p>
                    <p className="text-xs mt-1">
                      {canEditItems ? t('transferLists.detail.emptyItemsDesc') : addItemDisabledReason}
                    </p>
                    {canEditItems && (
                      <button
                        type="button"
                        onClick={() => setShowAddItem(true)}
                        className="btn-primary inline-flex items-center gap-2 text-sm mt-4"
                      >
                        <Plus size={16} />
                        {t('transferLists.detail.addItem')}
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                items.map((item: any) => (
                  <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${selectedItemIds.has(item.id) ? 'bg-indigo-50/50' : ''}`}>
                    {canEditItems && (
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedItemIds.has(item.id)}
                          onChange={() => toggleItemSelect(item.id)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{item.ordinalNumber}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-sm font-medium text-gray-900">{item.folderSignature}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-gray-900 whitespace-normal break-words">{normalizeDisplayText(item.folderTitle)}</div>
                      {item.notes && (
                        <div className="text-xs text-gray-400 mt-0.5 truncate">{item.notes}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">
                      {item.dateFrom ? new Date(item.dateFrom).getFullYear() : '—'}
                      {' – '}
                      {item.dateTo ? new Date(item.dateTo).getFullYear() : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-bold ${
                        item.categoryCode === 'A' ? 'bg-red-100 text-red-700' :
                        item.categoryCode.startsWith('BE') ? 'bg-orange-100 text-orange-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {item.categoryCode}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-600">{item.folderCount}</td>
                    <td
                      className="px-3 py-2.5 text-gray-600 text-xs whitespace-normal break-words max-w-[220px]"
                      title={getItemStorageLocation(item) || undefined}
                    >
                      {getItemStorageLocation(item) || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">
                      {item.disposalOrTransferDate
                        ? new Date(item.disposalOrTransferDate).toLocaleDateString('pl-PL')
                        : '—'
                      }
                    </td>
                    <td className="px-3 py-2.5">
                      {item.box ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/boxes/${item.box.id}`); }}
                          className="flex items-start gap-1 text-xs text-primary-600 hover:text-primary-800 text-left"
                        >
                          <Box size={12} className="mt-0.5 shrink-0" />
                          <span>
                            <span className="font-medium">{getItemSourceBoxNumber(item)}</span>
                            {item.sourceBoxNumber && item.box.boxNumber !== item.sourceBoxNumber && (
                              <span className="block text-[10px] text-gray-400">{item.box.boxNumber}</span>
                            )}
                          </span>
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    {canEditItems && (
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEditItem(item)}
                            className="p-1 hover:bg-blue-50 rounded text-gray-400 hover:text-blue-600"
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {itemsPagination && (
          <div className="px-4 py-3 border-t border-gray-100">
            <Pagination
              page={itemsPagination.page}
              total={itemsPagination.total}
              limit={pageSize}
              onPageChange={setPage}
              pageSizeOptions={ITEM_PAGE_SIZE_OPTIONS}
              onLimitChange={handlePageSizeChange}
            />
          </div>
        )}
      </div>

      {/* Add / Edit Item Modal */}
      <Modal
        isOpen={showAddItem || !!editingItem}
        onClose={() => { setShowAddItem(false); setEditingItem(null); resetForm(); }}
        title={editingItem ? t('transferLists.detail.editItem') : t('transferLists.detail.addItemTitle')}
        size="lg"
      >
        <form onSubmit={editingItem ? handleEditItem : handleAddItem} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-folderSignature" className="label-text">{t('transferLists.detail.folderSign')}</label>
              <input
                id="item-folderSignature"
                type="text"
                data-autofocus
                value={form.folderSignature}
                onChange={(e) => updateFormField('folderSignature', e.target.value)}
                className="input-field"
                placeholder={t('transferLists.detail.folderSignPlaceholder')}
                required
              />
            </div>
            <div>
              <label htmlFor="item-categoryCode" className="label-text">{t('transferLists.detail.category')}</label>
              <select
                id="item-categoryCode"
                value={form.categoryCode}
                onChange={(e) => updateFormField('categoryCode', e.target.value)}
                className="input-field"
                required
              >
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="item-folderTitle" className="label-text">{t('transferLists.detail.folderTitle')}</label>
            <input
              id="item-folderTitle"
              type="text"
              value={form.folderTitle}
              onChange={(e) => updateFormField('folderTitle', e.target.value)}
              className="input-field"
              placeholder={t('transferLists.detail.folderTitlePlaceholder')}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="item-dateFrom" className="label-text">{t('transferLists.detail.dateFrom')}</label>
              <input
                id="item-dateFrom"
                type="date"
                value={form.dateFrom}
                onChange={(e) => updateFormField('dateFrom', e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="item-dateTo" className="label-text">{t('transferLists.detail.dateTo')}</label>
              <input
                id="item-dateTo"
                type="date"
                value={form.dateTo}
                onChange={(e) => updateFormField('dateTo', e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="item-folderCount" className="label-text">{t('transferLists.detail.folderCount')}</label>
              <input
                id="item-folderCount"
                type="number"
                min={1}
                value={form.folderCount}
                onChange={(e) => updateFormField('folderCount', parseInt(e.target.value) || 1)}
                className="input-field"
              />
            </div>
          </div>

          <div>
            <label htmlFor="item-storageLocation" className="label-text">{t('transferLists.detail.storageLocation')}</label>
            <input
              id="item-storageLocation"
              type="text"
              value={form.storageLocation}
              onChange={(e) => updateFormField('storageLocation', e.target.value)}
              className="input-field"
              placeholder={t('transferLists.detail.storageLocationPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-destructionDate" className="label-text">{t('transferLists.detail.destructionDate')}</label>
              <input
                id="item-destructionDate"
                type="date"
                value={form.disposalOrTransferDate}
                onChange={(e) => updateFormField('disposalOrTransferDate', e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="item-boxNumber" className="label-text">{t('transferLists.detail.boxOptional')}</label>
              <BoxNumberInput
                value={form.boxNumber}
                onChange={(val) => updateFormField('boxNumber', val)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="item-notes" className="label-text">{t('transferLists.detail.notes')}</label>
            <textarea
              id="item-notes"
              value={form.notes}
              onChange={(e) => updateFormField('notes', e.target.value)}
              className="input-field"
              rows={2}
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowAddItem(false); setEditingItem(null); resetForm(); }}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={addItemMutation.isPending}>
              {editingItem ? t('common.save') : t('transferLists.detail.addItem')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showEditListTitle}
        onClose={() => setShowEditListTitle(false)}
        title={t('transferLists.detail.editTitle')}
        size="md"
      >
        <form onSubmit={handleUpdateListTitle} className="space-y-4">
          <div>
            <label htmlFor="edit-list-title" className="label-text">{t('transferLists.listTitle')} *</label>
            <input
              id="edit-list-title"
              type="text"
              data-autofocus
              value={editListTitle}
              onChange={(e) => setEditListTitle(e.target.value)}
              className="input-field"
              placeholder={t('transferLists.importModal.titlePlaceholder')}
              required
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowEditListTitle(false)}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={updatingListTitle || !editListTitle.trim()}
            >
              {updatingListTitle ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      {ConfirmDialogElement}
    </div>
  );
}
