import { useParams, useNavigate } from 'react-router-dom';
import { useDetail, usePatch } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import StatusBadge from '@/components/ui/StatusBadge';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import ActivityTimeline from '@/components/ui/ActivityTimeline';
import ShareButton from '@/components/ui/ShareButton';
import { ArrowLeft, CheckCircle, XCircle, Play, Package, Truck, Loader2, Clock } from 'lucide-react';

// Status flow steps
const STATUS_STEPS = ['draft', 'submitted', 'approved', 'in_progress', 'ready', 'delivered', 'completed'];

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { data: order, isLoading } = useDetail('order', '/orders', id);
  const patchOrder = usePatch(['order', 'orders'], t('orders.detail.statusChanged'));

  const ORDER_TYPE_LABELS: Record<string, string> = {
    checkout: t('orders.typeIssue'), return_order: t('orders.typeReturn'),
    transfer: t('orders.typeTransfer'), disposal: t('orders.typeDestruction'),
  };

  const STEP_LABELS: Record<string, string> = {
    draft: t('orders.statusDraft'), submitted: t('orders.statusSubmitted'),
    approved: t('orders.statusApproved'), in_progress: t('orders.statusInProgress'),
    ready: t('orders.statusReady'), delivered: t('orders.statusIssued'),
    completed: t('orders.statusCompleted'),
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin" size={32} /></div>;
  if (!order) return <div className="text-center py-12 text-gray-500">{t('orders.detail.notFound')}</div>;

  const currentStepIndex = STATUS_STEPS.indexOf(order.status);
  const isCancelled = order.status === 'cancelled';
  const isRejected = order.status === 'rejected';

  const handleAction = async (action: string) => {
    await patchOrder.mutateAsync({ url: `/orders/${id}/${action}` });
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: t('orders.title'), to: '/orders' }, { label: order.orderNumber }]} />

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{order.orderNumber}</h1>
            <StatusBadge status={order.status} type="order" />
            <StatusBadge status={order.priority} type="priority" />
          </div>
          <p className="text-gray-500 mt-1">{ORDER_TYPE_LABELS[order.orderType]}</p>
        </div>
        <ShareButton entityType="order" entityId={order.id} />
      </div>

      {/* Progress Stepper */}
      {!isCancelled && !isRejected && (
        <div className="card">
          <div className="flex items-center justify-between">
            {STATUS_STEPS.map((step, i) => {
              const isActive = i === currentStepIndex;
              const isCompleted = i < currentStepIndex;
              return (
                <div key={step} className="flex items-center flex-1">
                  <div className={`flex flex-col items-center ${i > 0 ? 'flex-1' : ''}`}>
                    {i > 0 && (
                      <div className={`h-0.5 w-full mb-2 ${isCompleted ? 'bg-green-500' : 'bg-gray-200'}`} />
                    )}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      isCompleted ? 'bg-green-500 text-white' : isActive ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {isCompleted ? '✓' : i + 1}
                    </div>
                    <span className={`text-xs mt-1 ${isActive ? 'font-medium text-primary-700' : 'text-gray-500'}`}>
                      {STEP_LABELS[step]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-3">{t('common.actions')}</h2>
        <div className="flex flex-wrap gap-2">
          {order.status === 'draft' && (
            <button onClick={() => handleAction('submit')} className="btn-primary flex items-center gap-2" disabled={patchOrder.isPending}>
              <Play size={16} /> {t('orders.detail.submit')}
            </button>
          )}
          {order.status === 'submitted' && hasPermission('order.approve') && (
            <>
              <button onClick={() => handleAction('approve')} className="btn-primary flex items-center gap-2" disabled={patchOrder.isPending}>
                <CheckCircle size={16} /> {t('orders.detail.approve')}
              </button>
              <button onClick={() => handleAction('reject')} className="btn-danger flex items-center gap-2" disabled={patchOrder.isPending}>
                <XCircle size={16} /> {t('orders.detail.reject')}
              </button>
            </>
          )}
          {order.status === 'approved' && hasPermission('order.process') && (
            <button onClick={() => handleAction('process')} className="btn-primary flex items-center gap-2" disabled={patchOrder.isPending}>
              <Play size={16} /> {t('orders.detail.startProgress')}
            </button>
          )}
          {order.status === 'in_progress' && hasPermission('order.process') && (
            <button onClick={() => handleAction('ready')} className="btn-primary flex items-center gap-2" disabled={patchOrder.isPending}>
              <Package size={16} /> {t('orders.detail.markReady')}
            </button>
          )}
          {order.status === 'ready' && hasPermission('order.process') && (
            <button onClick={() => handleAction('deliver')} className="btn-primary flex items-center gap-2" disabled={patchOrder.isPending}>
              <Truck size={16} /> {t('orders.detail.deliver')}
            </button>
          )}
          {order.status === 'delivered' && hasPermission('order.complete') && (
            <button onClick={() => handleAction('complete')} className="btn-primary flex items-center gap-2" disabled={patchOrder.isPending}>
              <CheckCircle size={16} /> {t('orders.detail.complete')}
            </button>
          )}
          {!['completed', 'cancelled'].includes(order.status) && (
            <button onClick={() => handleAction('cancel')} className="btn-danger flex items-center gap-2" disabled={patchOrder.isPending}>
              <XCircle size={16} /> {t('common.cancel')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Items */}
        <div className="lg:col-span-2 card">
          <h2 className="text-lg font-semibold mb-4">{t('orders.detail.items', { count: order.items?.length || 0 })}</h2>
          {order.items?.length > 0 ? (
            <div className="space-y-2">
              {order.items.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    {item.box && (
                      <div className="text-sm">
                        <span className="font-mono font-medium text-primary-700">{item.box.boxNumber}</span>
                        <span className="text-gray-500 ml-2">{item.box.title}</span>
                        {item.box.location && <span className="text-xs text-gray-400 ml-2">📍 {item.box.location.fullPath}</span>}
                      </div>
                    )}
                    {item.hrFolder && (
                      <div className="text-sm">
                        <span className="font-medium">{item.hrFolder.employeeLastName} {item.hrFolder.employeeFirstName}</span>
                        <span className="text-gray-500 ml-2">{t('hr.title')}</span>
                      </div>
                    )}
                  </div>
                  <StatusBadge status={item.itemStatus} type="order" />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">{t('orders.detail.noItems')}</p>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('orders.detail.details')}</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('orders.requester')}</dt>
                <dd>{order.requester?.firstName} {order.requester?.lastName}</dd>
              </div>
              {order.approver && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t('orders.detail.approver')}</dt>
                  <dd>{order.approver.firstName} {order.approver.lastName}</dd>
                </div>
              )}
              {order.assignee && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t('orders.detail.handler')}</dt>
                  <dd>{order.assignee.firstName} {order.assignee.lastName}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('orders.detail.slaDeadline')}</dt>
                <dd className="flex items-center gap-1">
                  <Clock size={14} />
                  {order.slaDeadline ? new Date(order.slaDeadline).toLocaleString('pl-PL') : '—'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('boxes.createdAt')}</dt>
                <dd>{new Date(order.createdAt).toLocaleString('pl-PL')}</dd>
              </div>
              {order.completedAt && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t('orders.detail.complete')}</dt>
                  <dd>{new Date(order.completedAt).toLocaleString('pl-PL')}</dd>
                </div>
              )}
            </dl>
          </div>

          {order.notes && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('orders.createModal.notes')}</h3>
              <p className="text-sm text-gray-600">{order.notes}</p>
            </div>
          )}

          {/* Activity Timeline */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('boxes.changeHistory')}</h3>
            <ActivityTimeline entityType="order" entityId={order.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
