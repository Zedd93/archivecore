import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { normalizeDisplayText } from '@archivecore/shared';
import api from '@/services/api';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CustodyHistory from '@/components/ui/CustodyHistory';
import { SkeletonDetailPage } from '@/components/ui/Skeleton';
import { getApiErrorMessage } from '@/utils/apiError';
import { useAuth } from '@/contexts/AuthContext';

type DocumentDetail = {
  id: string;
  title: string;
  docType: string | null;
  docDate: string | null;
  pageCount: number | null;
  description: string | null;
  folder: { id: string; folderNumber: string; title: string } | null;
  box: { id: string; boxNumber: string } | null;
};

export default function DocumentDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const { data: document, isLoading, error, refetch } = useQuery({
    queryKey: ['document', tenantId, id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await api.get<{ data: DocumentDetail }>(`/documents/${encodeURIComponent(id!)}`);
      return data.data;
    },
  });

  if (isLoading) return <SkeletonDetailPage />;
  if (error || !document) return <div className="card text-center py-10">
    <p className="text-gray-600">{error ? getApiErrorMessage(error, t('custodyHistory.documentNotFound')) : t('custodyHistory.documentNotFound')}</p>
    <button type="button" onClick={() => void refetch()} className="btn-secondary mt-4">{t('common.tryAgain')}</button>
  </div>;

  return <div className="space-y-6">
    <Breadcrumbs items={[{ label: t('boxes.documents') }, { label: normalizeDisplayText(document.title) }]} />
    <h1 className="text-2xl font-bold text-gray-900 break-words">{normalizeDisplayText(document.title)}</h1>
    <div className="card space-y-4">
      <h2 className="text-lg font-semibold">{t('common.details')}</h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div><dt className="text-gray-500">{t('boxes.documentType')}</dt><dd>{document.docType || '—'}</dd></div>
        <div><dt className="text-gray-500">{t('custodyHistory.date')}</dt><dd>{document.docDate?.slice(0, 10) || '—'}</dd></div>
        <div><dt className="text-gray-500">{t('custodyHistory.pages')}</dt><dd>{document.pageCount ?? '—'}</dd></div>
        {document.folder && <div><dt className="text-gray-500">{t('orders.detail.custody.folder')}</dt><dd><Link to={`/folders/${document.folder.id}`} className="text-primary-700 hover:underline">{document.folder.folderNumber}</Link></dd></div>}
        {document.box && <div><dt className="text-gray-500">{t('orders.detail.custody.box')}</dt><dd><Link to={`/boxes/${document.box.id}`} className="text-primary-700 hover:underline">{document.box.boxNumber}</Link></dd></div>}
      </dl>
      {document.description && <p className="border-t border-gray-100 pt-4 whitespace-pre-wrap break-words text-sm">{normalizeDisplayText(document.description)}</p>}
    </div>
    <CustodyHistory kind="document" id={document.id} />
  </div>;
}
