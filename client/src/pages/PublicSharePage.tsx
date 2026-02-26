import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import StatusBadge from '@/components/ui/StatusBadge';
import { Loader2, Box, FileText, User, FileSpreadsheet, Clock, ShieldAlert, Link2Off, MapPin } from 'lucide-react';

interface ShareData {
  entityType: string;
  entity: any;
  expiresAt: string;
  accessCount: number;
}

export default function PublicSharePage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const [data, setData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!token) return;

    axios.get(`/api/public/share/${token}`)
      .then((res) => {
        setData(res.data);
      })
      .catch((err) => {
        if (err.response?.data?.expired) {
          setExpired(true);
        }
        setError(err.response?.data?.error || t('share.error'));
      })
      .finally(() => setLoading(false));
  }, [token, t]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin text-primary-500 mx-auto" size={40} />
          <p className="mt-4 text-gray-500">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            {expired ? (
              <>
                <Link2Off size={48} className="mx-auto text-orange-400 mb-4" />
                <h1 className="text-xl font-bold text-gray-900 mb-2">{t('share.expired')}</h1>
                <p className="text-gray-500">{t('share.expiredDesc')}</p>
              </>
            ) : (
              <>
                <ShieldAlert size={48} className="mx-auto text-red-400 mb-4" />
                <h1 className="text-xl font-bold text-gray-900 mb-2">{t('share.notFound')}</h1>
                <p className="text-gray-500">{t('share.notFoundDesc')}</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const ENTITY_ICONS: Record<string, typeof Box> = {
    box: Box,
    order: FileText,
    hr: User,
    transfer_list: FileSpreadsheet,
  };

  const EntityIcon = ENTITY_ICONS[data.entityType] || Box;
  const daysLeft = Math.max(0, Math.ceil((new Date(data.expiresAt).getTime() - Date.now()) / 86400000));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
              <EntityIcon size={18} className="text-primary-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">ArchiveCore</h1>
              <p className="text-xs text-gray-500">{t('share.sharedView')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Clock size={14} />
            <span>{t('share.expiresIn', { days: daysLeft })}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Entity type badge */}
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center gap-3">
            <EntityIcon size={20} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">{t(`share.entityTypes.${data.entityType}`)}</span>
            <span className="text-xs text-gray-400 ml-auto">{t('share.accessCount', { count: data.accessCount })}</span>
          </div>

          {/* Entity content */}
          <div className="p-6">
            {data.entityType === 'box' && <SharedBoxView entity={data.entity} />}
            {data.entityType === 'order' && <SharedOrderView entity={data.entity} />}
            {data.entityType === 'hr' && <SharedHRView entity={data.entity} />}
            {data.entityType === 'transfer_list' && <SharedTransferListView entity={data.entity} />}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-xs text-gray-400">
          {t('share.readOnly')}
        </div>
      </div>
    </div>
  );
}

// ─── Entity views ────────────────────────────────────────

function SharedBoxView({ entity }: { entity: any }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold text-gray-900">{entity.boxNumber}</h2>
        <StatusBadge status={entity.status} type="box" />
      </div>
      {entity.title && <p className="text-gray-600">{entity.title}</p>}

      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-gray-500">{t('boxes.boxNumber')}</dt>
          <dd className="text-sm font-mono font-medium mt-1">{entity.boxNumber}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('boxes.qrCode')}</dt>
          <dd className="text-sm font-mono mt-1">{entity.qrCode}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('boxes.documentType')}</dt>
          <dd className="text-sm mt-1">{entity.docType || '—'}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('boxes.location')}</dt>
          <dd className="text-sm mt-1 flex items-center gap-1">
            <MapPin size={14} className="text-gray-400" />
            {entity.location?.fullPath || t('boxes.notAssigned')}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('boxes.documentPeriod')}</dt>
          <dd className="text-sm mt-1">
            {entity.dateFrom ? new Date(entity.dateFrom).toLocaleDateString('pl-PL') : '—'}
            {' — '}
            {entity.dateTo ? new Date(entity.dateTo).toLocaleDateString('pl-PL') : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('boxes.retentionDate')}</dt>
          <dd className="text-sm mt-1">
            {entity.retentionDate ? new Date(entity.retentionDate).toLocaleDateString('pl-PL') : '—'}
          </dd>
        </div>
      </dl>

      {entity.description && (
        <div className="pt-4 border-t border-gray-100">
          <dt className="text-sm text-gray-500 mb-1">{t('common.description')}</dt>
          <dd className="text-sm text-gray-700">{entity.description}</dd>
        </div>
      )}

      {entity._count && (
        <div className="pt-4 border-t border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('boxes.statistics')}</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-lg font-bold text-gray-900">{entity._count.folders || 0}</div>
              <div className="text-xs text-gray-500">{t('boxes.folders')}</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-lg font-bold text-gray-900">{entity._count.documents || 0}</div>
              <div className="text-xs text-gray-500">{t('boxes.documents')}</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-lg font-bold text-gray-900">{entity._count.transferListItems || 0}</div>
              <div className="text-xs text-gray-500">{t('boxes.transferListItems')}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SharedOrderView({ entity }: { entity: any }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold text-gray-900">{entity.orderNumber}</h2>
        <StatusBadge status={entity.status} type="order" />
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-gray-500">{t('orders.type')}</dt>
          <dd className="text-sm mt-1">{entity.type}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('orders.priority')}</dt>
          <dd className="text-sm mt-1">{entity.priority}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('orders.requester')}</dt>
          <dd className="text-sm mt-1">
            {entity.requester ? `${entity.requester.firstName} ${entity.requester.lastName}` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('orders.assignee')}</dt>
          <dd className="text-sm mt-1">
            {entity.assignee ? `${entity.assignee.firstName} ${entity.assignee.lastName}` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('orders.dueDate')}</dt>
          <dd className="text-sm mt-1">
            {entity.dueDate ? new Date(entity.dueDate).toLocaleDateString('pl-PL') : '—'}
          </dd>
        </div>
      </dl>

      {entity.notes && (
        <div className="pt-4 border-t border-gray-100">
          <dt className="text-sm text-gray-500 mb-1">{t('common.notes')}</dt>
          <dd className="text-sm text-gray-700">{entity.notes}</dd>
        </div>
      )}

      {entity.items?.length > 0 && (
        <div className="pt-4 border-t border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            {t('orders.items')} ({entity.items.length})
          </h3>
          <div className="space-y-2">
            {entity.items.map((item: any) => (
              <div key={item.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Box size={16} className="text-gray-400" />
                <div>
                  <div className="text-sm font-medium">{item.box?.boxNumber || '—'}</div>
                  <div className="text-xs text-gray-500">{item.box?.title || ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SharedHRView({ entity }: { entity: any }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold text-gray-900">
          {entity.employeeFirstName} {entity.employeeLastName}
        </h2>
        <StatusBadge status={entity.employmentStatus} type="employment" />
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-gray-500">{t('hr.department')}</dt>
          <dd className="text-sm mt-1">{entity.department || '—'}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('hr.position')}</dt>
          <dd className="text-sm mt-1">{entity.position || '—'}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('hr.storageForm')}</dt>
          <dd className="text-sm mt-1">{entity.storageForm || '—'}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('hr.retentionPeriod')}</dt>
          <dd className="text-sm mt-1">{entity.retentionPeriod ? `${entity.retentionPeriod} lat` : '—'}</dd>
        </div>
      </dl>
    </div>
  );
}

function SharedTransferListView({ entity }: { entity: any }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold text-gray-900">{entity.listNumber}</h2>
        <StatusBadge status={entity.status} type="box" />
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-gray-500">{t('transferLists.listNumber')}</dt>
          <dd className="text-sm font-mono mt-1">{entity.listNumber}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('transferLists.category')}</dt>
          <dd className="text-sm mt-1">{entity.category || '—'}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('common.date')}</dt>
          <dd className="text-sm mt-1">
            {entity.createdAt ? new Date(entity.createdAt).toLocaleDateString('pl-PL') : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t('transferLists.itemsCount')}</dt>
          <dd className="text-sm mt-1">{entity._count?.items || 0}</dd>
        </div>
      </dl>

      {entity.description && (
        <div className="pt-4 border-t border-gray-100">
          <dt className="text-sm text-gray-500 mb-1">{t('common.description')}</dt>
          <dd className="text-sm text-gray-700">{entity.description}</dd>
        </div>
      )}
    </div>
  );
}
