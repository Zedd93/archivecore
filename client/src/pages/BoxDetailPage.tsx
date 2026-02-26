import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { useDetail } from '@/hooks/useApi';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import StatusBadge from '@/components/ui/StatusBadge';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import ActivityTimeline from '@/components/ui/ActivityTimeline';
import ShareButton from '@/components/ui/ShareButton';
import { MapPin, QrCode, FileText, Printer, FileSpreadsheet, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function BoxDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: box, isLoading } = useDetail('box', '/boxes', id);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [labelLoading, setLabelLoading] = useState(false);

  // Fetch QR code via authenticated API
  useEffect(() => {
    if (!box?.id) return;
    let cancelled = false;

    api.get(`/labels/qr/${box.id}?format=png`, { responseType: 'arraybuffer' })
      .then((res) => {
        if (cancelled) return;
        const blob = new Blob([res.data], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        setQrDataUrl(url);
      })
      .catch(() => {
        // Silently fail — QR placeholder will show
      });

    return () => {
      cancelled = true;
    };
  }, [box?.id]);

  // Cleanup blob URL
  useEffect(() => {
    return () => {
      if (qrDataUrl) URL.revokeObjectURL(qrDataUrl);
    };
  }, [qrDataUrl]);

  // Download label PDF via authenticated API
  const handlePrintLabel = useCallback(async () => {
    if (!box?.id) return;
    setLabelLoading(true);
    try {
      const res = await api.get(`/labels/box/${box.id}`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      toast.error(t('boxes.labelError'));
    } finally {
      setLabelLoading(false);
    }
  }, [box?.id, t]);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin" size={32} /></div>;
  }

  if (!box) {
    return <div className="text-center py-12 text-gray-500">{t('boxes.notFound')}</div>;
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: t('boxes.title'), to: '/boxes' }, { label: box.boxNumber }]} />

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{box.boxNumber}</h1>
            <StatusBadge status={box.status} type="box" />
          </div>
          <p className="text-gray-500 mt-1">{box.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <ShareButton entityType="box" entityId={box.id} />
          <button
            onClick={handlePrintLabel}
            disabled={labelLoading}
            className="btn-secondary flex items-center gap-2"
          >
            {labelLoading ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
            {t('boxes.printLabel')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">{t('boxes.info')}</h2>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-gray-500">{t('boxes.boxNumber')}</dt>
                <dd className="text-sm font-mono font-medium mt-1">{box.boxNumber}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">{t('boxes.qrCode')}</dt>
                <dd className="text-sm font-mono mt-1">{box.qrCode}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">{t('boxes.documentType')}</dt>
                <dd className="text-sm mt-1">{box.docType || '—'}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">{t('boxes.location')}</dt>
                <dd className="text-sm mt-1 flex items-center gap-1">
                  <MapPin size={14} className="text-gray-400" />
                  {box.location?.fullPath || t('boxes.notAssigned')}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">{t('boxes.documentPeriod')}</dt>
                <dd className="text-sm mt-1">
                  {box.dateFrom ? new Date(box.dateFrom).toLocaleDateString('pl-PL') : '—'}
                  {' — '}
                  {box.dateTo ? new Date(box.dateTo).toLocaleDateString('pl-PL') : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">{t('boxes.retentionDate')}</dt>
                <dd className="text-sm mt-1">
                  {box.retentionDate ? new Date(box.retentionDate).toLocaleDateString('pl-PL') : '—'}
                </dd>
              </div>
            </dl>
            {box.description && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <dt className="text-sm text-gray-500 mb-1">{t('common.description')}</dt>
                <dd className="text-sm text-gray-700">{box.description}</dd>
              </div>
            )}
          </div>

          {/* Folders */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{t('boxes.foldersCount', { count: box.folders?.length || 0 })}</h2>
            </div>
            {box.folders?.length > 0 ? (
              <div className="space-y-2">
                {box.folders.map((folder: any) => (
                  <div key={folder.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-3">
                      <FileText size={18} className="text-gray-400" />
                      <div>
                        <div className="text-sm font-medium">{folder.folderNumber}</div>
                        <div className="text-xs text-gray-500">{folder.title}</div>
                      </div>
                    </div>
                    <StatusBadge status={folder.status} type="box" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">{t('boxes.noFolders')}</p>
            )}
          </div>

          {/* Transfer List Items */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {t('boxes.transferItemsCount', { count: box.transferListItems?.length || 0 })}
              </h2>
            </div>
            {box.transferListItems?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{t('boxes.ordinalNo')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{t('boxes.folderSign')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase min-w-[200px]">{t('boxes.folderTitle')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{t('boxes.dateRange')}</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">{t('boxes.category')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{t('boxes.transferList')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {box.transferListItems.map((item: any) => (
                      <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.ordinalNumber}</td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-sm font-medium text-gray-900">{item.folderSignature}</span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-gray-900 line-clamp-2">{item.folderTitle}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">
                          {item.dateFrom ? new Date(item.dateFrom).getFullYear() : '—'}
                          {' – '}
                          {item.dateTo ? new Date(item.dateTo).getFullYear() : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-bold ${
                            item.categoryCode === 'A' ? 'bg-red-100 text-red-700' :
                            item.categoryCode?.startsWith('BE') ? 'bg-orange-100 text-orange-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {item.categoryCode}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {item.transferList ? (
                            <button
                              onClick={() => navigate(`/transfer-lists/${item.transferList.id}`)}
                              className="text-xs text-primary-600 hover:text-primary-800 flex items-center gap-1"
                            >
                              <FileSpreadsheet size={12} />
                              {item.transferList.listNumber}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400">{t('boxes.noTransferItems')}</p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* QR Code */}
          <div className="card text-center">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('boxes.qrCode')}</h3>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR code for box ${box.boxNumber}`}
                className="w-40 h-40 mx-auto border rounded-lg"
              />
            ) : (
              <div className="w-40 h-40 mx-auto border rounded-lg bg-gray-50 flex items-center justify-center">
                <QrCode size={48} className="text-gray-300" />
              </div>
            )}
            <p className="text-xs text-gray-500 mt-2 font-mono">{box.qrCode}</p>
          </div>

          {/* Stats */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('boxes.statistics')}</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('boxes.folders')}</span>
                <span className="font-medium">{box._count?.folders || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('boxes.documents')}</span>
                <span className="font-medium">{box._count?.documents || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('boxes.attachments')}</span>
                <span className="font-medium">{box._count?.attachments || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('boxes.transferListItems')}</span>
                <span className="font-medium">{box._count?.transferListItems || 0}</span>
              </div>
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('boxes.changeHistory')}</h3>
            <ActivityTimeline entityType="box" entityId={box.id} />
          </div>

          {/* Metadata */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('boxes.metadata')}</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">{t('boxes.client')}</span>
                <span>{box.tenant?.name || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{t('boxes.createdAt')}</span>
                <span>{new Date(box.createdAt).toLocaleDateString('pl-PL')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{t('boxes.updatedAt')}</span>
                <span>{new Date(box.updatedAt).toLocaleDateString('pl-PL')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
