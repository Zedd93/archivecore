import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Box, FileSpreadsheet, Loader2, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import { normalizeDisplayText } from '@archivecore/shared';
import api from '@/services/api';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import { SkeletonDetailPage } from '@/components/ui/Skeleton';
import StatusBadge from '@/components/ui/StatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import { getApiErrorMessage, getApiErrorMessageAsync } from '@/utils/apiError';

interface FolderDetail {
  id: string;
  folderNumber: string;
  title: string;
  status: string;
  docType: string | null;
  description: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  box: { id: string; boxNumber: string; location: { fullPath: string } | null } | null;
  transferListItem: {
    id: string;
    categoryCode: string | null;
    sourceBoxNumber: string | null;
    transferList: { id: string; listNumber: string; title: string };
  } | null;
  _count: { documents: number; attachments: number };
}

function displayDate(value: string | null) {
  return value ? value.slice(0, 10) : '—';
}

export default function FolderDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [printing, setPrinting] = useState(false);
  const { data: folder, isLoading, error, refetch } = useQuery({
    queryKey: ['folder', id],
    queryFn: async () => {
      const { data } = await api.get(`/folders/${encodeURIComponent(id!)}`);
      return data.data as FolderDetail;
    },
    enabled: Boolean(id),
  });

  const printLabel = async () => {
    if (!id) return;
    setPrinting(true);
    try {
      const { data } = await api.get(`/labels/folder/${encodeURIComponent(id)}`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err: any) {
      toast.error(await getApiErrorMessageAsync(err, t('boxes.labelError')));
    } finally {
      setPrinting(false);
    }
  };

  if (isLoading) return <SkeletonDetailPage />;
  if (error || !folder) {
    return (
      <div className="card text-center py-10">
        <p className="text-gray-600">{error ? getApiErrorMessage(error, t('folders.notFound')) : t('folders.notFound')}</p>
        <button type="button" onClick={() => void refetch()} className="btn-secondary mt-4">{t('common.tryAgain')}</button>
      </div>
    );
  }

  const transferList = folder.transferListItem?.transferList;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: t('folders.title'), to: '/folders' }, { label: folder.folderNumber }]} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 break-words">{normalizeDisplayText(folder.title)}</h1>
            <StatusBadge status={folder.status} type="folder" />
          </div>
          <p className="mt-1 font-mono text-sm text-gray-500 break-all">{folder.folderNumber}</p>
        </div>
        {hasPermission('label.generate') && (
          <button type="button" onClick={printLabel} disabled={printing} className="btn-secondary flex items-center gap-2 shrink-0">
            {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
            {t('folders.printLabel')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold">{t('common.details')}</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div><dt className="text-gray-500">{t('folders.dateRange')}</dt><dd>{displayDate(folder.dateFrom)} – {displayDate(folder.dateTo)}</dd></div>
            <div><dt className="text-gray-500">{t('folders.category')}</dt><dd>{folder.transferListItem?.categoryCode || folder.docType || '—'}</dd></div>
            <div><dt className="text-gray-500">{t('folders.source')}</dt><dd>{transferList ? t('folders.sourceTransferList') : t('folders.sourceManual')}</dd></div>
            <div><dt className="text-gray-500">{t('folders.documentsCount')}</dt><dd>{folder._count.documents}</dd></div>
          </dl>
          {folder.description && (
            <div className="border-t border-gray-100 pt-4 text-sm">
              <p className="text-gray-500 mb-1">{t('common.description')}</p>
              <p className="whitespace-pre-wrap break-words">{normalizeDisplayText(folder.description)}</p>
            </div>
          )}
        </div>

        <div className="card space-y-4">
          <h2 className="text-lg font-semibold">{t('folders.storageAndSource')}</h2>
          {folder.box ? (
            <Link to={`/boxes/${folder.box.id}`} className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 hover:border-primary-300">
              <Box size={18} className="mt-0.5 text-primary-600 shrink-0" />
              <span className="min-w-0"><strong className="block text-primary-700">{folder.box.boxNumber}</strong><span className="text-sm text-gray-600 break-words">{folder.box.location?.fullPath || t('folders.noLocation')}</span></span>
            </Link>
          ) : <p className="text-sm text-gray-500">{t('folders.noBox')}</p>}
          {transferList && (
            <Link to={`/transfer-lists/${transferList.id}`} className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 hover:border-primary-300">
              <FileSpreadsheet size={18} className="mt-0.5 text-indigo-600 shrink-0" />
              <span className="min-w-0"><strong className="block text-primary-700">{transferList.listNumber}</strong><span className="text-sm text-gray-600 break-words">{normalizeDisplayText(transferList.title)}</span></span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
