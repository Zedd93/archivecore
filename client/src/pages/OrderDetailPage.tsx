import { useParams, useNavigate } from 'react-router-dom';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDetail, usePatch } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import toast from 'react-hot-toast';
import StatusBadge from '@/components/ui/StatusBadge';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import ActivityTimeline from '@/components/ui/ActivityTimeline';
import ShareButton from '@/components/ui/ShareButton';
import Modal from '@/components/ui/Modal';
import BoxPicker from '@/components/ui/BoxPicker';
import DocumentPicker from '@/components/ui/DocumentPicker';
import FolderPicker, { SelectedFolder } from '@/components/ui/FolderPicker';
import QrCameraScanner from '@/components/ui/QrCameraScanner';
import { getApiErrorMessage } from '@/utils/apiError';
import { matchOrderItemQr } from '@/utils/orderPicking';
import { Camera, CheckCircle, XCircle, Play, Package, Truck, Loader2, Clock, Plus, RotateCcw } from 'lucide-react';

// Status flow steps
const STATUS_STEPS = ['draft', 'submitted', 'approved', 'in_progress', 'ready', 'delivered', 'completed'];

interface SelectedDocument {
  id: string;
  title: string;
  source?: 'document' | 'transfer_list_item';
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const { data: order, isLoading } = useDetail('order', '/orders', id);
  const patchOrder = usePatch(
    ['order', 'orders', 'boxes', 'box', 'dashboard', 'report-boxes-status', 'search'],
    t('orders.detail.statusChanged')
  );
  const [showAddItem, setShowAddItem] = useState(false);
  const [selectedBoxes, setSelectedBoxes] = useState<{ id: string; boxNumber: string }[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<SelectedFolder[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<SelectedDocument[]>([]);
  const [addingItems, setAddingItems] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [pickingItemId, setPickingItemId] = useState<string | null>(null);
  const pickBusyRef = useRef(false);
  const lastCameraCodeRef = useRef('');

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
  const canPick = order.orderType === 'checkout' && order.status === 'in_progress' && hasPermission('order.process');
  const handledCount = order.items?.filter((item: any) => ['picked', 'delivered', 'returned'].includes(item.itemStatus)).length ?? 0;
  const remainingCount = (order.items?.length ?? 0) - handledCount;

  const updatePick = async (itemId: string, status: 'pending' | 'picked') => {
    if (!id || pickBusyRef.current) return;
    pickBusyRef.current = true;
    setPickingItemId(itemId);
    try {
      await api.patch(`/orders/${id}/items/${itemId}/status`, { status });
      await queryClient.invalidateQueries({ queryKey: ['order', id] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast.success(t(status === 'picked' ? 'orders.detail.pickedSuccess' : 'orders.detail.pickUndone'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
      await queryClient.invalidateQueries({ queryKey: ['order', id] });
    } finally {
      pickBusyRef.current = false;
      setPickingItemId(null);
    }
  };

  const processPickCode = (rawCode: string) => {
    if (!canPick || pickBusyRef.current) return;
    const match = matchOrderItemQr(order.items, rawCode);
    if (match.kind === 'invalid') {
      toast.error(t('orders.detail.invalidPickCode'));
      return;
    }
    if (match.kind === 'missing') {
      toast.error(t('orders.detail.codeNotInOrder'));
      return;
    }
    if (match.kind === 'ambiguous') {
      toast.error(t('orders.detail.ambiguousPickCode'));
      return;
    }
    if (match.item.itemStatus === 'picked') {
      toast(t('orders.detail.alreadyPicked'));
      return;
    }
    if (match.item.itemStatus !== 'pending') {
      toast.error(t('orders.detail.cannotPickItem'));
      return;
    }
    void updatePick(match.item.id, 'picked');
  };

  const handleCameraCode = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || pickBusyRef.current || lastCameraCodeRef.current === code) return;
    lastCameraCodeRef.current = code;
    processPickCode(code);
  };

  const handleAction = async (action: string) => {
    await patchOrder.mutateAsync({ url: `/orders/${id}/${action}` });
    await queryClient.invalidateQueries({ queryKey: ['order', id] });
    await queryClient.invalidateQueries({ queryKey: ['box'] });
    await queryClient.invalidateQueries({ queryKey: ['boxes'] });
  };

  const canAddItems = hasPermission('order.create') || hasPermission('order.process');

  const resetAddItemForm = () => {
    setSelectedBoxes([]);
    setSelectedFolders([]);
    setSelectedDocuments([]);
  };

  const handleAddItems = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const items = [
      ...selectedBoxes.map((box) => ({ boxId: box.id })),
      ...selectedFolders.map((folder) => ({ folderId: folder.id })),
      ...selectedDocuments.map((doc) => (
        doc.source === 'transfer_list_item'
          ? { transferListItemId: doc.id }
          : { documentId: doc.id }
      )),
    ];
    if (!id || items.length === 0) return;

    setAddingItems(true);
    try {
      await Promise.all(
        items.map((item) => api.post(`/orders/${id}/items`, item))
      );
      toast.success(t('orders.detail.itemAdded', 'Pozycja dodana do zlecenia'));
      resetAddItemForm();
      setShowAddItem(false);
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('common.genericError')));
    } finally {
      setAddingItems(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: t('orders.title'), to: '/orders' }, { label: order.orderNumber }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{order.orderNumber}</h1>
            <StatusBadge status={order.status} type="order" />
            <StatusBadge status={order.priority} type="priority" />
          </div>
          <p className="text-gray-500 mt-1">{ORDER_TYPE_LABELS[order.orderType]}</p>
        </div>
        <ShareButton entityType="order" entityId={order.id} className="w-full sm:w-auto" />
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
        <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2">
          {order.status === 'draft' && (
            <button onClick={() => handleAction('submit')} className="btn-primary" disabled={patchOrder.isPending}>
              <Play size={16} /> {t('orders.detail.submit')}
            </button>
          )}
          {order.status === 'submitted' && hasPermission('order.approve') && (
            <>
              <button onClick={() => handleAction('approve')} className="btn-primary" disabled={patchOrder.isPending}>
                <CheckCircle size={16} /> {t('orders.detail.approve')}
              </button>
              <button onClick={() => handleAction('reject')} className="btn-danger" disabled={patchOrder.isPending}>
                <XCircle size={16} /> {t('orders.detail.reject')}
              </button>
            </>
          )}
          {order.status === 'approved' && hasPermission('order.process') && (
            <button onClick={() => handleAction('process')} className="btn-primary" disabled={patchOrder.isPending}>
              <Play size={16} /> {t('orders.detail.startProgress')}
            </button>
          )}
          {order.status === 'in_progress' && hasPermission('order.process') && (
            <button onClick={() => handleAction('ready')} className="btn-primary" disabled={patchOrder.isPending || (order.orderType === 'checkout' && (order.items.length === 0 || remainingCount > 0))}>
              <Package size={16} /> {t('orders.detail.markReady')}
            </button>
          )}
          {order.status === 'ready' && hasPermission('order.process') && (
            <button onClick={() => handleAction('deliver')} className="btn-primary" disabled={patchOrder.isPending}>
              <Truck size={16} /> {t('orders.detail.deliver')}
            </button>
          )}
          {order.status === 'delivered' && hasPermission('order.complete') && (
            <button onClick={() => handleAction('complete')} className="btn-primary" disabled={patchOrder.isPending}>
              <CheckCircle size={16} /> {t('orders.detail.complete')}
            </button>
          )}
          {!['completed', 'cancelled'].includes(order.status) && (
            <button onClick={() => handleAction('cancel')} className="btn-danger" disabled={patchOrder.isPending}>
              <XCircle size={16} /> {t('common.cancel')}
            </button>
          )}
        </div>
      </div>

      {canPick && (
        <div className="card space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t('orders.detail.pickingTitle')}</h2>
            <p className="text-sm text-gray-600">{t('orders.detail.pickingProgress', { picked: handledCount, total: order.items.length })}</p>
            {remainingCount > 0 && <p className="text-xs text-amber-700 mt-1">{t('orders.detail.pickingRequired')}</p>}
          </div>
          {!isScanning ? (
            <button type="button" className="btn-primary w-full sm:w-auto flex items-center justify-center gap-2" onClick={() => { lastCameraCodeRef.current = ''; setIsScanning(true); }}>
              <Camera size={17} />{t('labels.startCamera')}
            </button>
          ) : (
            <div className="space-y-2 max-w-lg">
              <QrCameraScanner
                id="archivecore-order-pick-scanner"
                onCode={handleCameraCode}
                onError={() => { toast.error(t('labels.cameraError')); setIsScanning(false); }}
              />
              <button type="button" className="btn-secondary w-full" onClick={() => setIsScanning(false)}>{t('labels.stopCamera')}</button>
            </div>
          )}
          <form onSubmit={(event) => { event.preventDefault(); if (pickBusyRef.current) return; processPickCode(manualCode); setManualCode(''); }} className="max-w-lg">
            <label htmlFor="order-pick-code" className="label-text">{t('orders.detail.manualPickCode')}</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input id="order-pick-code" className="input-field font-mono" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="AC:... / ACF:..." />
              <button type="submit" className="btn-secondary shrink-0" disabled={!manualCode.trim() || pickingItemId !== null}>{t('orders.detail.checkCode')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Items */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{t('orders.detail.items', { count: order.items?.length || 0 })}</h2>
            {canAddItems && !['ready', 'delivered', 'completed', 'cancelled'].includes(order.status) && (
              <button type="button" onClick={() => setShowAddItem(true)} className="btn-secondary flex items-center gap-2 text-sm">
                <Plus size={14} /> {t('orders.detail.addItem', 'Dodaj pozycję')}
              </button>
            )}
          </div>
          {order.items?.length > 0 ? (
            <div className="space-y-2">
              {order.items.map((item: any) => (
                <div key={item.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="min-w-0 break-words">
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
                    {item.folder && (
                      <div className="text-sm">
                        <span className="font-mono font-medium text-yellow-700">{item.folder.folderNumber}</span>
                        <span className="text-gray-500 ml-2">{item.folder.title}</span>
                        {item.folder.box?.boxNumber && <span className="text-xs text-gray-400 ml-2">📦 {item.folder.box.boxNumber}</span>}
                      </div>
                    )}
                    {item.document && (
                      <div className="text-sm">
                        <span className="font-medium text-green-700">{item.document.title}</span>
                        {(item.document.box?.boxNumber || item.document.folder?.box?.boxNumber) && (
                          <span className="text-xs text-gray-400 ml-2">📦 {item.document.box?.boxNumber || item.document.folder?.box?.boxNumber}</span>
                        )}
                      </div>
                    )}
                    {item.transferListItem && !item.folder && (
                      <div className="text-sm">
                        <span className="font-mono font-medium text-green-700">{item.transferListItem.folderSignature}</span>
                        <span className="text-gray-500 ml-2">{item.transferListItem.folderTitle}</span>
                        {item.transferListItem.box?.boxNumber && (
                          <span className="text-xs text-gray-400 ml-2">📦 {item.transferListItem.box.boxNumber}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.itemStatus} type="orderItem" />
                    {canPick && item.itemStatus === 'pending' && (
                      <button type="button" className="btn-secondary text-xs" disabled={pickingItemId !== null} onClick={() => { void updatePick(item.id, 'picked'); }}>
                        {pickingItemId === item.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                        {t('orders.detail.markPicked')}
                      </button>
                    )}
                    {canPick && item.itemStatus === 'picked' && (
                      <button type="button" className="btn-secondary text-xs" disabled={pickingItemId !== null} onClick={() => { void updatePick(item.id, 'pending'); }}>
                        {pickingItemId === item.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                        {t('orders.detail.undoPick')}
                      </button>
                    )}
                  </div>
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
              {order.expectedReturnAt && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t('loans.expectedReturnAt')}</dt>
                  <dd>{new Date(order.expectedReturnAt).toLocaleDateString('pl-PL')}</dd>
                </div>
              )}
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

      <Modal
        isOpen={showAddItem}
        onClose={() => { setShowAddItem(false); resetAddItemForm(); }}
        title={t('orders.detail.addItemTitle', 'Dodaj pozycję do zlecenia')}
        size="lg"
      >
        <form onSubmit={handleAddItems} className="space-y-4">
          <div>
            <label className="label-text">{t('orders.createModal.boxIds')}</label>
            <BoxPicker
              value={selectedBoxes}
              onChange={setSelectedBoxes}
              placeholder={t('orders.createModal.boxIdsPlaceholder')}
            />
          </div>
          <div>
            <label className="label-text">{t('orders.createModal.folders')}</label>
            <FolderPicker
              value={selectedFolders}
              onChange={setSelectedFolders}
              placeholder={t('orders.createModal.foldersPlaceholder')}
            />
          </div>
          <div>
            <label className="label-text">{t('orders.createModal.documents')}</label>
            <DocumentPicker
              value={selectedDocuments}
              onChange={setSelectedDocuments}
              placeholder={t('orders.createModal.documentsPlaceholder')}
              includeTransferListItems={false}
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={() => { setShowAddItem(false); resetAddItemForm(); }}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={addingItems || (selectedBoxes.length + selectedFolders.length + selectedDocuments.length === 0)}
              className="btn-primary"
            >
              {addingItems ? t('common.saving', 'Zapisywanie...') : t('orders.detail.addItem', 'Dodaj pozycję')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
