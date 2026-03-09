import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useList, useCreate } from '@/hooks/useApi';
import { useExport } from '@/hooks/useExport';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import api from '@/services/api';
import Pagination from '@/components/ui/Pagination';
import Modal from '@/components/ui/Modal';
import toast from 'react-hot-toast';
import {
  FileText, Plus, Search, Filter, Upload, FileSpreadsheet,
  ArrowUpFromLine, Loader2, Trash2, Download,
} from 'lucide-react';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { TRANSFER_LIST_STATUS_COLORS as STATUS_COLORS } from '@/constants/statusColors';

export default function TransferListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const STATUS_LABELS: Record<string, string> = {
    draft: t('transferLists.statusDraft'),
    confirmed: t('transferLists.statusConfirmed'),
    archived: t('transferLists.statusArchived'),
  };

  // Create form
  const [title, setTitle] = useState('');
  const [transferringUnit, setTransferringUnit] = useState('');
  const [receivingUnit, setReceivingUnit] = useState('');
  const [transferDate, setTransferDate] = useState('');
  const [notes, setNotes] = useState('');

  // Import form
  const [importTitle, setImportTitle] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importTransferringUnit, setImportTransferringUnit] = useState('');
  const [importReceivingUnit, setImportReceivingUnit] = useState('');

  const { confirm, ConfirmDialogElement } = useConfirm();
  const canWrite = hasPermission('transfer_list.write');
  const canImport = hasPermission('transfer_list.import');

  const params: any = { page, limit: 20 };
  if (search) params.search = search;
  if (statusFilter) params.status = statusFilter;

  const { data: result, isLoading, refetch } = useList('transfer-lists', '/transfer-lists', params);
  const createMutation = useCreate('/transfer-lists', ['transfer-lists'], t('transferLists.created'));
  const { exportData, isExporting } = useExport({ endpoint: '/export/transfer-lists', defaultFilename: 'spisy_zo.xlsx' });

  const lists = result?.data || [];
  const pagination = (result as any)?.pagination;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created: any = await createMutation.mutateAsync({
        title,
        transferringUnit: transferringUnit || undefined,
        receivingUnit: receivingUnit || undefined,
        transferDate: transferDate || undefined,
        notes: notes || undefined,
      });
      setShowCreate(false);
      resetForm();
      if (created?.id) navigate(`/transfer-lists/${created.id}`);
    } catch {
      // Error handled by mutation onError callback
    }
  };

  const resetForm = () => {
    setTitle('');
    setTransferringUnit('');
    setReceivingUnit('');
    setTransferDate('');
    setNotes('');
  };

  const resetImportForm = () => {
    setImportTitle('');
    setImportFile(null);
    setImportTransferringUnit('');
    setImportReceivingUnit('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Import flow: create list + import file ────────────
  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) {
      toast.error(t('transferLists.importModal.fileLabel'));
      return;
    }

    setImporting(true);
    try {
      // 1. Create new transfer list
      const created: any = await createMutation.mutateAsync({
        title: importTitle || `Import z ${importFile.name}`,
        transferringUnit: importTransferringUnit || undefined,
        receivingUnit: importReceivingUnit || undefined,
      });

      if (!created?.id) {
        toast.error(t('transferLists.importModal.createError'));
        return;
      }

      // 2. Upload file to import endpoint
      const formData = new FormData();
      formData.append('file', importFile);

      const { data } = await api.post(`/transfer-lists/${created.id}/import`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      toast.success(t('transferLists.importModal.importSuccess', { count: data.data.imported }));
      setShowImport(false);
      resetImportForm();
      refetch();
      navigate(`/transfer-lists/${created.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('transferLists.importModal.importError'));
    } finally {
      setImporting(false);
    }
  };

  // ─── Quick import: drop file on empty state ────────────
  const handleQuickImport = useCallback(async (file: File) => {
    if (!canImport) return;
    setImportFile(file);
    setImportTitle(`Import z ${file.name}`);
    setShowImport(true);
  }, [canImport]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv'))) {
      handleQuickImport(file);
    } else {
      toast.error(t('common.supportedFormats'));
    }
  }, [handleQuickImport, t]);

  // ─── Selection helpers ────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === lists.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(lists.map((l: any) => l.id)));
    }
  };

  const handleBulkDelete = async () => {
    const selectedLists = lists.filter((l: any) => selectedIds.has(l.id));
    const nonDraft = selectedLists.filter((l: any) => l.status !== 'draft');

    if (nonDraft.length > 0) {
      toast.error(t('transferLists.cannotDelete', { count: nonDraft.length }));
      return;
    }

    const ok = await confirm({
      title: t('transferLists.confirmDelete'),
      message: t('transferLists.confirmDeleteMsg', { count: selectedIds.size }),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!ok) return;

    setDeleting(true);
    let successCount = 0;
    let errorCount = 0;

    for (const id of selectedIds) {
      try {
        await api.delete(`/transfer-lists/${id}`);
        successCount++;
      } catch {
        errorCount++;
      }
    }

    if (successCount > 0) toast.success(t('transferLists.deleted', { count: successCount }));
    if (errorCount > 0) toast.error(t('transferLists.deleteError', { count: errorCount }));

    setSelectedIds(new Set());
    setDeleting(false);
    refetch();
  };

  const columns = [
    {
      key: 'listNumber',
      header: t('transferLists.number'),
      render: (row: any) => (
        <span className="font-mono text-sm font-medium text-primary-700">{row.listNumber}</span>
      ),
    },
    {
      key: 'title',
      header: t('transferLists.listTitle'),
      render: (row: any) => (
        <div>
          <div className="font-medium text-gray-900 truncate max-w-xs">{row.title}</div>
          {row.transferringUnit && (
            <div className="text-xs text-gray-500 mt-0.5">
              {row.transferringUnit} → {row.receivingUnit || '—'}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'transferDate',
      header: t('transferLists.transferDate'),
      render: (row: any) =>
        row.transferDate
          ? new Date(row.transferDate).toLocaleDateString('pl-PL')
          : '—',
    },
    {
      key: 'items',
      header: t('transferLists.items'),
      render: (row: any) => (
        <span className="font-medium">{row._count?.items ?? 0}</span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row: any) => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-600'}`}>
          {STATUS_LABELS[row.status] || row.status}
        </span>
      ),
    },
    {
      key: 'createdBy',
      header: t('transferLists.createdBy'),
      render: (row: any) =>
        row.createdBy
          ? `${row.createdBy.firstName} ${row.createdBy.lastName}`
          : '—',
    },
    {
      key: 'createdAt',
      header: t('transferLists.createdDate'),
      render: (row: any) => new Date(row.createdAt).toLocaleDateString('pl-PL'),
    },
  ];

  return (
    <div
      className="space-y-6"
      onDragOver={(e) => { e.preventDefault(); if (canImport) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-primary-500/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl shadow-2xl p-12 text-center border-2 border-dashed border-primary-400">
            <ArrowUpFromLine size={48} className="mx-auto text-primary-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-900">{t('transferLists.dropFile')}</h2>
            <p className="text-gray-500 mt-2">{t('transferLists.dropFileDesc')}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
            <FileText size={20} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('transferLists.title')}</h1>
            <p className="text-sm text-gray-500">{t('transferLists.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => exportData({ format: 'xlsx', search, status: statusFilter })}
            disabled={isExporting}
            className="btn-secondary flex items-center gap-2"
          >
            {isExporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            <span className="hidden sm:inline">{t('common.export')}</span>
          </button>
          {canImport && (
            <button
              onClick={() => setShowImport(true)}
              className="btn-secondary flex items-center gap-2"
            >
              <Upload size={18} />
              <span className="hidden sm:inline">{t('transferLists.importFromFile')}</span>
            </button>
          )}
          {canWrite && (
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
              <Plus size={18} />
              <span className="hidden sm:inline">{t('transferLists.newList')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[250px]">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={t('transferLists.searchPlaceholder')}
              className="input-field pl-10"
              aria-label={t('transferLists.searchPlaceholder')}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="input-field w-auto"
              aria-label={t('transferLists.allStatuses')}
            >
              <option value="">{t('transferLists.allStatuses')}</option>
              <option value="draft">{t('transferLists.statusDraft')}</option>
              <option value="confirmed">{t('transferLists.statusConfirmed')}</option>
              <option value="archived">{t('transferLists.statusArchived')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Empty state with import CTA */}
      {!isLoading && lists.length === 0 && !search && !statusFilter && (
        <div className="card p-12 text-center">
          <FileSpreadsheet size={56} className="mx-auto text-gray-300 mb-4" />
          <h2 className="text-lg font-semibold text-gray-700">{t('transferLists.empty')}</h2>
          <p className="text-gray-500 mt-2 max-w-md mx-auto">
            {t('transferLists.emptyDesc')}
          </p>
          <div className="flex items-center justify-center gap-3 mt-6">
            {canImport && (
              <button
                onClick={() => setShowImport(true)}
                className="btn-primary flex items-center gap-2 text-base px-6 py-3"
              >
                <Upload size={20} />
                {t('transferLists.importFromExcel')}
              </button>
            )}
            {canWrite && (
              <button
                onClick={() => setShowCreate(true)}
                className="btn-secondary flex items-center gap-2"
              >
                <Plus size={18} />
                {t('transferLists.createEmpty')}
              </button>
            )}
          </div>
          {canImport && (
            <p className="text-xs text-gray-400 mt-4">
              {t('common.supportedFormats')}
            </p>
          )}
        </div>
      )}

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && canWrite && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm text-red-800 font-medium">
            {t('transferLists.selectedCount', { count: selectedIds.size })}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="btn-secondary text-sm py-1.5 px-3"
            >
              {t('common.deselect')}
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white text-sm py-1.5 px-4 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {deleting ? t('common.deleting') : t('transferLists.deleteSelected')}
            </button>
          </div>
        </div>
      )}

      {/* Table (only show when there are results or searching) */}
      {(lists.length > 0 || search || statusFilter) && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {canWrite && (
                    <th className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={lists.length > 0 && selectedIds.size === lists.length}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </th>
                  )}
                  {columns.map((col) => (
                    <th key={col.key} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={columns.length + (canWrite ? 1 : 0)} className="p-0">
                      <SkeletonTable rows={8} columns={6} />
                    </td>
                  </tr>
                ) : lists.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + (canWrite ? 1 : 0)} className="px-3 py-12 text-center text-gray-400">
                      {t('transferLists.noMatch')}
                    </td>
                  </tr>
                ) : (
                  lists.map((row: any) => (
                    <tr
                      key={row.id}
                      className={`hover:bg-gray-50 transition-colors cursor-pointer ${selectedIds.has(row.id) ? 'bg-primary-50/50' : ''}`}
                      onClick={() => navigate(`/transfer-lists/${row.id}`)}
                    >
                      {canWrite && (
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.id)}
                            onChange={() => toggleSelect(row.id)}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                        </td>
                      )}
                      {columns.map((col) => (
                        <td key={col.key} className="px-3 py-2.5">
                          {col.render ? col.render(row) : (row as any)[col.key]}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {pagination && pagination.totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-100">
              <Pagination
                page={pagination.page}
                total={pagination.total}
                limit={pagination.limit}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>
      )}

      {/* ─── Import Modal ──────────────────────────────────── */}
      <Modal
        isOpen={showImport}
        onClose={() => { setShowImport(false); resetImportForm(); }}
        title={t('transferLists.importModal.title')}
        size="lg"
      >
        <form onSubmit={handleImport} className="space-y-5">
          {/* File upload area */}
          <div>
            <label htmlFor="import-file" className="label-text">{t('transferLists.importModal.fileLabel')}</label>
            <div
              className={`mt-1 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                importFile
                  ? 'border-green-300 bg-green-50'
                  : 'border-gray-300 bg-gray-50 hover:border-primary-400 hover:bg-primary-50'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
              role="button"
              tabIndex={0}
              aria-label={importFile ? importFile.name : t('transferLists.importModal.fileClick')}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setImportFile(file);
                    if (!importTitle) setImportTitle(`Import z ${file.name}`);
                  }
                }}
              />
              {importFile ? (
                <div>
                  <FileSpreadsheet size={32} className="mx-auto text-green-600 mb-2" />
                  <p className="font-medium text-green-800">{importFile.name}</p>
                  <p className="text-xs text-green-600 mt-1">
                    {(importFile.size / 1024).toFixed(0)} KB — {t('transferLists.importModal.fileClick')}
                  </p>
                </div>
              ) : (
                <div>
                  <Upload size={32} className="mx-auto text-gray-400 mb-2" />
                  <p className="font-medium text-gray-700">{t('transferLists.importModal.fileClick')}</p>
                  <p className="text-xs text-gray-500 mt-1">{t('common.supportedFormats')}</p>
                </div>
              )}
            </div>
          </div>

          {/* Expected columns info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs font-medium text-blue-800 mb-1">{t('transferLists.importModal.expectedColumns')}</p>
            <p className="text-xs text-blue-700">
              {t('transferLists.importModal.columnsList')}
            </p>
            <p className="text-xs text-blue-600 mt-1">
              {t('transferLists.importModal.autoDetect')}
            </p>
          </div>

          <div>
            <label htmlFor="import-title" className="label-text">{t('transferLists.importModal.titleLabel')}</label>
            <input
              id="import-title"
              type="text"
              value={importTitle}
              onChange={(e) => setImportTitle(e.target.value)}
              className="input-field"
              placeholder={t('transferLists.importModal.titlePlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="import-senderUnit" className="label-text">{t('transferLists.importModal.senderLabel')}</label>
              <input
                id="import-senderUnit"
                type="text"
                value={importTransferringUnit}
                onChange={(e) => setImportTransferringUnit(e.target.value)}
                className="input-field"
                placeholder={t('transferLists.importModal.senderPlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="import-receiverUnit" className="label-text">{t('transferLists.importModal.receiverLabel')}</label>
              <input
                id="import-receiverUnit"
                type="text"
                value={importReceivingUnit}
                onChange={(e) => setImportReceivingUnit(e.target.value)}
                className="input-field"
                placeholder={t('transferLists.importModal.receiverPlaceholder')}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowImport(false); resetImportForm(); }}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-primary flex items-center gap-2"
              disabled={importing || !importFile}
            >
              {importing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t('transferLists.importModal.submitting')}
                </>
              ) : (
                <>
                  <Upload size={16} />
                  {t('transferLists.importModal.submit')}
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ─── Create Empty Modal ─────────────────────────────── */}
      <Modal
        isOpen={showCreate}
        onClose={() => { setShowCreate(false); resetForm(); }}
        title={t('transferLists.createModal.title')}
        size="lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label htmlFor="create-list-title" className="label-text">{t('transferLists.listTitle')} *</label>
            <input
              id="create-list-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-field"
              placeholder={t('transferLists.importModal.titlePlaceholder')}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="create-list-senderUnit" className="label-text">{t('transferLists.senderUnit')}</label>
              <input
                id="create-list-senderUnit"
                type="text"
                value={transferringUnit}
                onChange={(e) => setTransferringUnit(e.target.value)}
                className="input-field"
                placeholder={t('transferLists.importModal.senderPlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="create-list-receiverUnit" className="label-text">{t('transferLists.receiverUnit')}</label>
              <input
                id="create-list-receiverUnit"
                type="text"
                value={receivingUnit}
                onChange={(e) => setReceivingUnit(e.target.value)}
                className="input-field"
                placeholder={t('transferLists.importModal.receiverPlaceholder')}
              />
            </div>
          </div>

          <div>
            <label htmlFor="create-list-transferDate" className="label-text">{t('transferLists.transferDate')}</label>
            <input
              id="create-list-transferDate"
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
              className="input-field"
            />
          </div>

          <div>
            <label htmlFor="create-list-notes" className="label-text">{t('transferLists.createModal.notes')}</label>
            <textarea
              id="create-list-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input-field"
              rows={2}
              placeholder={t('transferLists.createModal.notesPlaceholder')}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowCreate(false); resetForm(); }}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? t('common.creating') : t('transferLists.createModal.submit')}
            </button>
          </div>
        </form>
      </Modal>

      {ConfirmDialogElement}
    </div>
  );
}
