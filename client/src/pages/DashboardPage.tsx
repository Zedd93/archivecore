import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useDashboardKPIs, useList } from '@/hooks/useApi';
import { useTranslation } from 'react-i18next';
import KPICard from '@/components/ui/KPICard';
import Modal from '@/components/ui/Modal';
import api from '@/services/api';
import { getApiErrorMessage } from '@/utils/apiError';
import toast from 'react-hot-toast';
import { Box, ClipboardList, UserCircle, MapPin, AlertTriangle, Clock, Users, Archive, FolderOpen, FilePlus2 } from 'lucide-react';
import { Loader2 } from 'lucide-react';

const CATEGORY_OPTIONS = ['A', 'B2', 'B5', 'B10', 'B15', 'B20', 'B25', 'B50', 'BE5', 'BE10', 'BE25', 'BE50', 'Bc'];

const initialFolderForm = {
  transferListId: '',
  folderSignature: '',
  folderTitle: '',
  dateFrom: '',
  dateTo: '',
  categoryCode: 'B10',
  folderCount: 1,
  storageLocation: '',
  disposalOrTransferDate: '',
  boxNumber: '',
  notes: '',
};

export default function DashboardPage() {
  const { data: kpis, isLoading } = useDashboardKPIs();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderForm, setFolderForm] = useState(initialFolderForm);
  const [creatingFolder, setCreatingFolder] = useState(false);

  const { data: transferListsResult, isLoading: transferListsLoading } = useList(
    'dashboard-transfer-lists-draft',
    '/transfer-lists',
    { page: 1, limit: 100, status: 'draft' },
    { enabled: showNewFolder }
  );

  const transferLists = transferListsResult?.data || [];

  const updateFolderForm = (field: keyof typeof initialFolderForm, value: string | number) => {
    setFolderForm((prev) => ({ ...prev, [field]: value }));
  };

  const resetFolderForm = () => {
    setFolderForm(initialFolderForm);
  };

  const handleCreateFolder = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!folderForm.transferListId) return;

    setCreatingFolder(true);
    try {
      await api.post(`/transfer-lists/${folderForm.transferListId}/items`, {
        folderSignature: folderForm.folderSignature,
        folderTitle: folderForm.folderTitle.trim(),
        categoryCode: folderForm.categoryCode,
        folderCount: Number(folderForm.folderCount),
        dateFrom: folderForm.dateFrom || null,
        dateTo: folderForm.dateTo || null,
        disposalOrTransferDate: folderForm.disposalOrTransferDate || null,
        storageLocation: folderForm.storageLocation || null,
        notes: folderForm.notes || null,
        boxNumber: folderForm.boxNumber || null,
      });

      toast.success(t('dashboard.folderCreated'));
      await queryClient.invalidateQueries({ queryKey: ['transfer-list-items'] });
      await queryClient.invalidateQueries({ queryKey: ['transfer-list'] });
      await queryClient.invalidateQueries({ queryKey: ['transfer-lists'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      const targetListId = folderForm.transferListId;
      resetFolderForm();
      setShowNewFolder(false);
      navigate(`/transfer-lists/${targetListId}`);
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('common.genericError')));
    } finally {
      setCreatingFolder(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-primary-500" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('dashboard.subtitle')}</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <KPICard
          title={t('dashboard.totalBoxes')}
          value={kpis?.totalBoxes ?? 0}
          icon={<Box size={24} />}
          color="blue"
          change={`${kpis?.activeBoxes ?? 0} ${t('dashboard.activeBoxes')}`}
        />
        <KPICard
          title={t('dashboard.totalFolders')}
          value={kpis?.totalFolders ?? 0}
          icon={<FolderOpen size={24} />}
          color="purple"
        />
        <KPICard
          title={t('boxes.statusIssued')}
          value={kpis?.checkedOutBoxes ?? 0}
          icon={<Archive size={24} />}
          color="yellow"
        />
        <KPICard
          title={t('dashboard.hrRecords')}
          value={kpis?.totalHRFolders ?? 0}
          icon={<UserCircle size={24} />}
          color="blue"
        />
        <KPICard
          title={t('dashboard.activeOrders')}
          value={kpis?.activeOrders ?? 0}
          icon={<ClipboardList size={24} />}
          color="green"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title={t('dashboard.overdueSla')}
          value={kpis?.overdueOrders ?? 0}
          icon={<AlertTriangle size={24} />}
          color="red"
          changeType={kpis?.overdueOrders > 0 ? 'negative' : 'neutral'}
          change={kpis?.overdueOrders > 0 ? t('dashboard.needsAttention') : t('dashboard.allGood')}
        />
        <KPICard
          title={t('locations.title')}
          value={kpis?.totalLocations ?? 0}
          icon={<MapPin size={24} />}
          color="blue"
          change={t('dashboard.occupancy', { occupancy: kpis?.occupancyRate ?? 0 })}
        />
        <KPICard
          title={t('boxes.statusForDestruction')}
          value={kpis?.pendingDisposal ?? 0}
          icon={<Clock size={24} />}
          color="yellow"
        />
        <KPICard
          title={t('dashboard.activeUsers')}
          value={kpis?.totalUsers ?? 0}
          icon={<Users size={24} />}
          color="green"
        />
      </div>

      {/* Quick actions */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.quickActions')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <a href="/boxes?action=create" className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-all">
            <Box size={24} className="text-primary-600" />
            <span className="text-sm font-medium text-gray-700">{t('dashboard.newBox')}</span>
          </a>
          <button
            type="button"
            onClick={() => setShowNewFolder(true)}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-all"
          >
            <FilePlus2 size={24} className="text-primary-600" />
            <span className="text-sm font-medium text-gray-700">{t('dashboard.newFolder')}</span>
          </button>
          <a href="/orders?action=create" className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-all">
            <ClipboardList size={24} className="text-primary-600" />
            <span className="text-sm font-medium text-gray-700">{t('dashboard.newOrder')}</span>
          </a>
          <a href="/hr?action=create" className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-all">
            <UserCircle size={24} className="text-primary-600" />
            <span className="text-sm font-medium text-gray-700">{t('dashboard.newHr')}</span>
          </a>
          <a href="/search" className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-all">
            <MapPin size={24} className="text-primary-600" />
            <span className="text-sm font-medium text-gray-700">{t('dashboard.search')}</span>
          </a>
        </div>
      </div>

      <Modal
        isOpen={showNewFolder}
        onClose={() => { setShowNewFolder(false); resetFolderForm(); }}
        title={t('dashboard.newFolderTitle')}
        size="lg"
      >
        <form onSubmit={handleCreateFolder} className="space-y-4">
          <div>
            <label htmlFor="dashboard-folder-list" className="label-text">{t('dashboard.transferListForFolder')}</label>
            <select
              id="dashboard-folder-list"
              value={folderForm.transferListId}
              onChange={(e) => updateFolderForm('transferListId', e.target.value)}
              className="input-field"
              required
              disabled={transferListsLoading}
            >
              <option value="">{transferListsLoading ? t('common.loading') : t('dashboard.chooseTransferList')}</option>
              {transferLists.map((list: any) => (
                <option key={list.id} value={list.id}>
                  {list.listNumber} - {list.title}
                </option>
              ))}
            </select>
            {!transferListsLoading && transferLists.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">{t('dashboard.noDraftTransferLists')}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="dashboard-folder-signature" className="label-text">{t('transferLists.detail.folderSign')}</label>
              <input
                id="dashboard-folder-signature"
                type="text"
                data-autofocus
                value={folderForm.folderSignature}
                onChange={(e) => updateFolderForm('folderSignature', e.target.value)}
                className="input-field"
                placeholder={t('transferLists.detail.folderSignPlaceholder')}
                required
              />
            </div>
            <div>
              <label htmlFor="dashboard-folder-category" className="label-text">{t('transferLists.detail.category')}</label>
              <select
                id="dashboard-folder-category"
                value={folderForm.categoryCode}
                onChange={(e) => updateFolderForm('categoryCode', e.target.value)}
                className="input-field"
                required
              >
                {CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="dashboard-folder-title" className="label-text">{t('transferLists.detail.folderTitle')}</label>
            <input
              id="dashboard-folder-title"
              type="text"
              value={folderForm.folderTitle}
              onChange={(e) => updateFolderForm('folderTitle', e.target.value)}
              className="input-field"
              placeholder={t('transferLists.detail.folderTitlePlaceholder')}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="dashboard-folder-date-from" className="label-text">{t('transferLists.detail.dateFrom')}</label>
              <input
                id="dashboard-folder-date-from"
                type="date"
                value={folderForm.dateFrom}
                onChange={(e) => updateFolderForm('dateFrom', e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="dashboard-folder-date-to" className="label-text">{t('transferLists.detail.dateTo')}</label>
              <input
                id="dashboard-folder-date-to"
                type="date"
                value={folderForm.dateTo}
                onChange={(e) => updateFolderForm('dateTo', e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="dashboard-folder-count" className="label-text">{t('transferLists.detail.folderCount')}</label>
              <input
                id="dashboard-folder-count"
                type="number"
                min={1}
                value={folderForm.folderCount}
                onChange={(e) => updateFolderForm('folderCount', parseInt(e.target.value) || 1)}
                className="input-field"
              />
            </div>
          </div>

          <div>
            <label htmlFor="dashboard-folder-storage" className="label-text">{t('transferLists.detail.storageLocation')}</label>
            <input
              id="dashboard-folder-storage"
              type="text"
              value={folderForm.storageLocation}
              onChange={(e) => updateFolderForm('storageLocation', e.target.value)}
              className="input-field"
              placeholder={t('transferLists.detail.storageLocationPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="dashboard-folder-disposal-date" className="label-text">{t('transferLists.detail.destructionDate')}</label>
              <input
                id="dashboard-folder-disposal-date"
                type="date"
                value={folderForm.disposalOrTransferDate}
                onChange={(e) => updateFolderForm('disposalOrTransferDate', e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="dashboard-folder-box" className="label-text">{t('transferLists.detail.boxOptional')}</label>
              <input
                id="dashboard-folder-box"
                type="text"
                value={folderForm.boxNumber}
                onChange={(e) => updateFolderForm('boxNumber', e.target.value)}
                className="input-field"
                placeholder={t('transferLists.detail.boxPlaceholder')}
              />
              <p className="mt-1 text-xs text-gray-500">{t('transferLists.detail.localBoxNumberHint')}</p>
            </div>
          </div>

          <div>
            <label htmlFor="dashboard-folder-notes" className="label-text">{t('transferLists.detail.notes')}</label>
            <textarea
              id="dashboard-folder-notes"
              value={folderForm.notes}
              onChange={(e) => updateFolderForm('notes', e.target.value)}
              className="input-field"
              rows={2}
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowNewFolder(false); resetFolderForm(); }}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={creatingFolder || transferLists.length === 0}
            >
              {creatingFolder ? t('common.creating') : t('dashboard.createFolder')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
