import { useState, useRef, useEffect, useCallback } from 'react';
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
  FileSpreadsheet, Filter, Search, CheckCircle2, Archive, Box, PackagePlus,
  Loader2, XCircle,
} from 'lucide-react';
import { SkeletonDetailPage } from '@/components/ui/Skeleton';
import { TRANSFER_LIST_STATUS_COLORS as STATUS_COLORS } from '@/constants/statusColors';

const CATEGORY_OPTIONS = ['A', 'B2', 'B5', 'B10', 'B15', 'B20', 'B25', 'B50', 'BE5', 'BE10', 'BE25', 'BE50', 'Bc'];

// ─── Box Number Autocomplete ────────────────────────────
function BoxNumberInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 1) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get('/boxes', { params: { search: query, limit: 8 } });
      setSuggestions(data.data || []);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (val: string) => {
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
    setShowDropdown(true);
  };

  const selectBox = (box: any) => {
    onChange(box.boxNumber);
    setShowDropdown(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isNewBox = value.trim().length > 0 && !suggestions.some(
    (b) => b.boxNumber.toLowerCase() === value.trim().toLowerCase()
  );

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Box size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (value) { fetchSuggestions(value); setShowDropdown(true); } }}
          className="input-field pl-9"
          placeholder={t('transferLists.detail.boxPlaceholder')}
          autoComplete="off"
        />
        {loading && (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
        )}
      </div>

      {showDropdown && (value.trim().length > 0) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 max-h-48 overflow-y-auto">
          {suggestions.map((box: any) => (
            <button
              key={box.id}
              type="button"
              onClick={() => selectBox(box)}
              className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-sm border-b border-gray-50 last:border-0"
            >
              <Box size={14} className="text-primary-500 shrink-0" />
              <span className="font-mono font-medium text-gray-900">{box.boxNumber}</span>
              <span className="text-gray-400 truncate text-xs">— {box.title}</span>
            </button>
          ))}

          {isNewBox && (
            <button
              type="button"
              onClick={() => { onChange(value.trim()); setShowDropdown(false); }}
              className="w-full px-3 py-2 text-left hover:bg-green-50 flex items-center gap-2 text-sm bg-green-50/50 border-t border-green-100"
            >
              <PackagePlus size={14} className="text-green-600 shrink-0" />
              <span className="text-green-800 font-medium">{t('transferLists.detail.createNewBox')}</span>
              <span className="font-mono text-green-700">{value.trim()}</span>
            </button>
          )}

          {!loading && suggestions.length === 0 && !isNewBox && (
            <div className="px-3 py-2 text-xs text-gray-400 text-center">{t('common.noResults')}</div>
          )}
        </div>
      )}

      {value.trim() && !showDropdown && isNewBox && (
        <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
          <PackagePlus size={12} />
          {t('transferLists.detail.newBoxAuto')}
        </p>
      )}
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
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [boxFilter, setBoxFilter] = useState('');

  // Modals
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  // Selection & bulk actions
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'none' | 'assignBox' | 'removeBox'>('none');
  const [bulkBoxNumber, setBulkBoxNumber] = useState('');
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
  const itemParams: any = { page, limit: 50 };
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

  const resetForm = () => {
    setForm({
      folderSignature: '', folderTitle: '', dateFrom: '', dateTo: '',
      categoryCode: 'B10', folderCount: 1, storageLocation: '',
      disposalOrTransferDate: '', notes: '', boxNumber: '',
    });
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
      toast.error(err.response?.data?.error || t('transferLists.detail.updateError'));
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
      boxNumber: item.box?.boxNumber || '',
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
      toast.error(err.response?.data?.error || t('transferLists.detail.importError'));
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
      toast.error(err.response?.data?.error || t('transferLists.detail.statusError'));
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
      toast.error(err.response?.data?.error || t('transferLists.detail.bulkDeleteError'));
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
      toast.success(t('transferLists.detail.assigned', { count: data.data.updated }));
      setSelectedItemIds(new Set());
      setBulkAction('none');
      setBulkBoxNumber('');
      refetchItems();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('transferLists.detail.assignError'));
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
      toast.error(err.response?.data?.error || t('transferLists.detail.unassignError'));
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

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: t('layout.nav.transferLists'), to: '/transfer-lists' }, { label: list.listNumber || list.title }]} />

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{list.title}</h1>
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
          {canWrite && list.status === 'draft' && (
            <button onClick={() => setShowAddItem(true)} className="btn-primary flex items-center gap-2 text-sm">
              <Plus size={16} />
              {t('transferLists.detail.addItem')}
            </button>
          )}
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

      {/* Bulk Actions Bar */}
      {selectedItemIds.size > 0 && canWrite && list.status === 'draft' && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-indigo-800 font-medium">
              {t('common.selected', { count: selectedItemIds.size })}
            </span>
            <div className="flex items-center gap-2">
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

          {/* Assign box inline form */}
          {bulkAction === 'assignBox' && (
            <div className="mt-3 pt-3 border-t border-indigo-200 flex items-end gap-3">
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
        </div>
      )}

      {/* Items Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {canWrite && list.status === 'draft' && (
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
                {canWrite && list.status === 'draft' && (
                  <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">{t('transferLists.detail.colActions')}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {itemsLoading ? (
                <tr>
                  <td colSpan={canWrite && list.status === 'draft' ? 11 : 10} className="px-3 py-12 text-center text-gray-400">{t('common.loading')}</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={canWrite && list.status === 'draft' ? 11 : 10} className="px-3 py-12 text-center text-gray-400">
                    <FileSpreadsheet size={40} className="mx-auto text-gray-300 mb-2" />
                    <p>{t('transferLists.detail.emptyItems')}</p>
                    <p className="text-xs mt-1">{t('transferLists.detail.emptyItemsDesc')}</p>
                  </td>
                </tr>
              ) : (
                items.map((item: any) => (
                  <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${selectedItemIds.has(item.id) ? 'bg-indigo-50/50' : ''}`}>
                    {canWrite && list.status === 'draft' && (
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
                      <div className="text-gray-900 line-clamp-2">{item.folderTitle}</div>
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
                    <td className="px-3 py-2.5 text-gray-600 text-xs truncate max-w-[160px]">{item.storageLocation || '—'}</td>
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
                          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800"
                        >
                          <Box size={12} />
                          {item.box.boxNumber}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    {canWrite && list.status === 'draft' && (
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
        {itemsPagination && itemsPagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100">
            <Pagination
              page={itemsPagination.page}
              total={itemsPagination.total}
              limit={itemsPagination.limit}
              onPageChange={setPage}
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
                value={form.folderSignature}
                onChange={(e) => setForm({ ...form, folderSignature: e.target.value })}
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
                onChange={(e) => setForm({ ...form, categoryCode: e.target.value })}
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
              onChange={(e) => setForm({ ...form, folderTitle: e.target.value })}
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
                onChange={(e) => setForm({ ...form, dateFrom: e.target.value })}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="item-dateTo" className="label-text">{t('transferLists.detail.dateTo')}</label>
              <input
                id="item-dateTo"
                type="date"
                value={form.dateTo}
                onChange={(e) => setForm({ ...form, dateTo: e.target.value })}
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
                onChange={(e) => setForm({ ...form, folderCount: parseInt(e.target.value) || 1 })}
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
              onChange={(e) => setForm({ ...form, storageLocation: e.target.value })}
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
                onChange={(e) => setForm({ ...form, disposalOrTransferDate: e.target.value })}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="item-boxNumber" className="label-text">{t('transferLists.detail.boxOptional')}</label>
              <BoxNumberInput
                value={form.boxNumber}
                onChange={(val) => setForm({ ...form, boxNumber: val })}
              />
            </div>
          </div>

          <div>
            <label htmlFor="item-notes" className="label-text">{t('transferLists.detail.notes')}</label>
            <textarea
              id="item-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="input-field"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
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

      {ConfirmDialogElement}
    </div>
  );
}
