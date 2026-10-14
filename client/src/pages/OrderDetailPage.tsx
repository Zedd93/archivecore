import { Link, useParams, useNavigate } from 'react-router-dom';
import { Fragment, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import OfflineScanPanel from '@/components/ui/OfflineScanPanel';
import SignaturePad from '@/components/ui/SignaturePad';
import axios from 'axios';
import { scanFeedbackStyles, useScanFeedback } from '@/hooks/useScanFeedback';
import { getApiErrorMessage, getApiErrorMessageAsync } from '@/utils/apiError';
import { matchOrderItemQr } from '@/utils/orderPicking';
import { getOrderItemPickBox, getOrderItemPickLocation, sortOrderItemsByPickRoute } from '@/utils/orderPickRoute';
import { useOfflineWarehouseScans } from '@/hooks/useOfflineWarehouseScans';
import { Camera, CheckCircle, XCircle, Play, Package, Truck, Loader2, Clock, Plus, RotateCcw, Volume2, VolumeX, Upload, Download, MapPin } from 'lucide-react';

// Status flow steps
const STATUS_STEPS = ['draft', 'submitted', 'approved', 'in_progress', 'ready', 'delivered', 'completed'];

interface SelectedDocument {
  id: string;
  title: string;
  source?: 'document' | 'transfer_list_item';
}

interface OrderPickScanItem {
  id: string;
  itemStatus: string;
  boxId?: string | null;
  folderId?: string | null;
  box?: { qrCode?: string | null; boxNumber?: string } | null;
  folder?: { folderNumber?: string } | null;
  transferListItem?: { folderSignature?: string } | null;
  document?: { title?: string } | null;
  hrFolder?: { employeeFirstName?: string; employeeLastName?: string } | null;
}

type BoxCondition = '' | 'intact' | 'damaged' | 'unverified';
type HandoverBoxCheck = { condition: BoxCondition; sealNumber: string; conditionNote: string };
type HandoverPhoto = {
  id: string;
  boxId: string | null;
  box: { boxNumber: string } | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  checksumSha256: string;
  uploadedAt: string;
  uploadedBy: { firstName: string; lastName: string };
};
type CustodyTimelineEvent = {
  id: string;
  eventType: 'handover' | 'receipt' | 'return_event' | 'transfer';
  eventAt: string;
  notes: string | null;
  recipientName: string | null;
  box: { id: string; boxNumber: string } | null;
  folder: { id: string; folderNumber: string; title: string } | null;
  document: { id: string; title: string } | null;
  hrFolder: { id: string; employeeFirstName: string; employeeLastName: string } | null;
  performedBy: { firstName: string; lastName: string } | null;
  fromUser: { firstName: string; lastName: string } | null;
  toUser: { firstName: string; lastName: string } | null;
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const activeTenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const offlineScans = useOfflineWarehouseScans(user?.id || '', activeTenantId, 'issue', id || '');
  const { data: order, isLoading } = useDetail('order', '/orders', id);
  const { data: custodyEvents = [], isLoading: custodyLoading, isError: custodyError } = useQuery<CustodyTimelineEvent[]>({
    queryKey: ['order-custody', activeTenantId, id],
    queryFn: async () => { const { data } = await api.get(`/orders/${id}/custody`); return data.data; },
    enabled: Boolean(id && order),
  });
  const { data: handoverPhotos = [], isLoading: photosLoading, isError: photosError } = useQuery<HandoverPhoto[]>({
    queryKey: ['order-handover-photos', activeTenantId, id],
    queryFn: async () => { const { data } = await api.get(`/orders/${id}/handover/photos`); return data.data; },
    enabled: Boolean(id && order?.handoverProof),
  });
  const patchOrder = usePatch(
    ['order', 'orders', 'warehouse-tasks', 'boxes', 'box', 'dashboard', 'report-boxes-status', 'search'],
    t('orders.detail.statusChanged')
  );
  const [showAddItem, setShowAddItem] = useState(false);
  const [selectedBoxes, setSelectedBoxes] = useState<{ id: string; boxNumber: string }[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<SelectedFolder[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<SelectedDocument[]>([]);
  const [addingItems, setAddingItems] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const { feedback: scanFeedback, soundEnabled, startCameraSound, toggleSound, showFeedback: showScanFeedback } = useScanFeedback(isScanning);
  const [manualCode, setManualCode] = useState('');
  const [pickingItemId, setPickingItemId] = useState<string | null>(null);
  const [scanItemId, setScanItemId] = useState<string | null>(null);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [uploadingScan, setUploadingScan] = useState(false);
  const [downloadingScan, setDownloadingScan] = useState<string | null>(null);
  const [showHandover, setShowHandover] = useState(false);
  const [handoverPhotoFile, setHandoverPhotoFile] = useState<File | null>(null);
  const [handoverPhotoBoxId, setHandoverPhotoBoxId] = useState('');
  const [uploadingHandoverPhoto, setUploadingHandoverPhoto] = useState(false);
  const [downloadingHandoverPhoto, setDownloadingHandoverPhoto] = useState<string | null>(null);
  const handoverPhotoInputRef = useRef<HTMLInputElement>(null);
  const [recipientName, setRecipientName] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [handoverLocation, setHandoverLocation] = useState<{ latitude: number; longitude: number; accuracyMeters: number } | null>(null);
  const [boxChecks, setBoxChecks] = useState<Record<string, HandoverBoxCheck>>({});
  const [isLocating, setIsLocating] = useState(false);
  const locationRequestRef = useRef(0);
  const pickBusyRef = useRef(false);
  const lastCameraCodeRef = useRef({ code: '', retryAt: 0 });

  const ORDER_TYPE_LABELS: Record<string, string> = {
    checkout: t('orders.typeIssue'), return_order: t('orders.typeReturn'),
    transfer: t('orders.typeTransfer'), disposal: t('orders.typeDestruction'), scan: t('orders.typeScan'),
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
  const missingScanCount = order.orderType === 'scan' ? order.items.filter((item: any) => !item.scanFile).length : 0;
  const displayItems = canPick ? sortOrderItemsByPickRoute(order.items || []) : order.items || [];
  const handoverBoxes = [...new Map<string, { id: string; number: string }>((order.items || [])
    .filter((item: any) => item.boxId && item.box)
    .map((item: any): [string, { id: string; number: string }] => [item.boxId, { id: item.boxId, number: item.box.boxNumber }])).values()];
  const boxChecksReady = handoverBoxes.every((box) => {
    const check = boxChecks[box.id];
    return check?.condition && (check.condition !== 'damaged' || check.conditionNote.trim().length >= 3);
  });

  const allowCameraRetry = (code: string) => {
    if (lastCameraCodeRef.current.code === code.trim()) {
      lastCameraCodeRef.current.retryAt = Date.now() + 5000;
    }
  };

  const updatePick = async (itemId: string, status: 'pending' | 'picked', scannedLabel?: string, scannedCode?: string) => {
    if (!id || pickBusyRef.current) return;
    pickBusyRef.current = true;
    setPickingItemId(itemId);
    try {
      await api.patch(`/orders/${id}/items/${itemId}/status`, { status });
      await queryClient.invalidateQueries({ queryKey: ['order', id] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      if (scannedLabel) showScanFeedback('success', t('orders.detail.scannedItem', { item: scannedLabel }));
      else toast.success(t(status === 'picked' ? 'orders.detail.pickedSuccess' : 'orders.detail.pickUndone'));
    } catch (error) {
      const message = getApiErrorMessage(error, t('common.genericError'));
      if (scannedLabel) {
        if (scannedCode && status === 'picked' && (!navigator.onLine || (axios.isAxiosError(error) && !error.response && error.code !== 'ERR_CANCELED'))) {
          const saved = offlineScans.stage(scannedCode);
          showScanFeedback(saved === 'unavailable' ? 'error' : 'warning', t(`offlineScans.${saved}`));
        } else {
          showScanFeedback('error', message);
          if (scannedCode) allowCameraRetry(scannedCode);
        }
      } else {
        toast.error(message);
      }
      await queryClient.invalidateQueries({ queryKey: ['order', id] });
    } finally {
      pickBusyRef.current = false;
      setPickingItemId(null);
    }
  };

  const processPickCode = (rawCode: string) => {
    if (!canPick || pickBusyRef.current || offlineScans.syncing) return;
    const match = matchOrderItemQr<OrderPickScanItem>(order.items, rawCode);
    if (match.kind === 'invalid') {
      showScanFeedback('error', t('orders.detail.invalidPickCode'));
      allowCameraRetry(rawCode);
      return;
    }
    if (match.kind === 'missing') {
      showScanFeedback('warning', t('orders.detail.codeNotInOrder'));
      allowCameraRetry(rawCode);
      return;
    }
    if (match.kind === 'ambiguous') {
      showScanFeedback('warning', t('orders.detail.ambiguousPickCode'));
      allowCameraRetry(rawCode);
      return;
    }
    if (match.item.itemStatus === 'picked') {
      showScanFeedback('duplicate', t('orders.detail.alreadyPicked'));
      return;
    }
    if (match.item.itemStatus !== 'pending') {
      showScanFeedback('error', t('orders.detail.cannotPickItem'));
      allowCameraRetry(rawCode);
      return;
    }
    const item = match.item;
    const label = item.box?.boxNumber || item.folder?.folderNumber || item.transferListItem?.folderSignature
      || item.document?.title || [item.hrFolder?.employeeFirstName, item.hrFolder?.employeeLastName].filter(Boolean).join(' ')
      || t('orders.detail.pickedSuccess');
    if (!navigator.onLine) {
      const saved = offlineScans.stage(rawCode.trim());
      showScanFeedback(saved === 'unavailable' ? 'error' : 'warning', t(`offlineScans.${saved}`));
      if (saved === 'unavailable') allowCameraRetry(rawCode);
      return;
    }
    void updatePick(item.id, 'picked', label, rawCode);
  };

  const syncOfflinePicks = async () => {
    if (!id || pickBusyRef.current || !canPick) return;
    pickBusyRef.current = true;
    try {
      await offlineScans.verify(async (code) => {
        try {
          const { data } = await api.get(`/orders/${id}`);
          const latest = data.data;
          if (latest.orderType !== 'checkout' || latest.status !== 'in_progress') {
            showScanFeedback('error', t('orders.detail.cannotPickItem'));
            return false;
          }
          const match = matchOrderItemQr<OrderPickScanItem>(latest.items, code);
          if (match.kind !== 'match') {
            showScanFeedback('error', t('orders.detail.codeNotInOrder'));
            return false;
          }
          if (match.item.itemStatus === 'pending') {
            setPickingItemId(match.item.id);
            await api.patch(`/orders/${id}/items/${match.item.id}/status`, { status: 'picked' });
          } else if (match.item.itemStatus !== 'picked') {
            showScanFeedback('error', t('orders.detail.cannotPickItem'));
            return false;
          }
          offlineScans.remove(code);
          await queryClient.invalidateQueries({ queryKey: ['order', id] });
          showScanFeedback('success', t('orders.detail.pickedSuccess'));
        } catch (error) {
          showScanFeedback('error', getApiErrorMessage(error, t('common.genericError')));
        } finally {
          setPickingItemId(null);
        }
        return false;
      });
    } finally {
      pickBusyRef.current = false;
    }
  };

  const handleCameraCode = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || pickBusyRef.current || (lastCameraCodeRef.current.code === code && Date.now() < lastCameraCodeRef.current.retryAt)) return;
    lastCameraCodeRef.current = { code, retryAt: Number.POSITIVE_INFINITY };
    processPickCode(code);
  };

  const handleAction = async (action: string, proof?: {
    recipientName: string;
    signatureData?: string;
    latitude?: number;
    longitude?: number;
    accuracyMeters?: number;
    boxChecks?: Array<{ boxId: string; condition: Exclude<BoxCondition, ''>; sealNumber?: string; conditionNote?: string }>;
  }) => {
    await patchOrder.mutateAsync({ url: `/orders/${id}/${action}`, ...(proof ? { proof } : {}) });
    await queryClient.invalidateQueries({ queryKey: ['order', id] });
    await queryClient.invalidateQueries({ queryKey: ['order-custody', activeTenantId, id] });
    await queryClient.invalidateQueries({ queryKey: ['box'] });
    await queryClient.invalidateQueries({ queryKey: ['boxes'] });
  };

  const closeHandover = () => {
    locationRequestRef.current += 1;
    setIsLocating(false);
    setShowHandover(false);
    setRecipientName('');
    setSignatureData(null);
    setHandoverLocation(null);
    setBoxChecks({});
  };

  const requestHandoverLocation = () => {
    if (!navigator.geolocation) { toast.error(t('orders.detail.locationUnavailable')); return; }
    const requestId = ++locationRequestRef.current;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestId !== locationRequestRef.current) return;
        setHandoverLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        });
        setIsLocating(false);
      },
      () => {
        if (requestId !== locationRequestRef.current) return;
        setIsLocating(false);
        toast.error(t('orders.detail.locationUnavailable'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const confirmHandover = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = recipientName.trim();
    if (name.length < 2 || patchOrder.isPending || !boxChecksReady) return;
    if (signatureData && signatureData.length > 160_000) { toast.error(t('orders.detail.signatureTooLarge')); return; }
    try {
      const checks = handoverBoxes.map((box) => {
        const check = boxChecks[box.id];
        return {
          boxId: box.id,
          condition: check.condition as Exclude<BoxCondition, ''>,
          ...(check.sealNumber.trim() ? { sealNumber: check.sealNumber.trim() } : {}),
          ...(check.conditionNote.trim() ? { conditionNote: check.conditionNote.trim() } : {}),
        };
      });
      await handleAction('deliver', { recipientName: name, ...(signatureData ? { signatureData } : {}), ...(handoverLocation || {}), boxChecks: checks });
      closeHandover();
    } catch {
      // The mutation displays the server error; keep the form open for retry.
    }
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
      ...(order.orderType === 'scan' ? [] : selectedBoxes.map((box) => ({ boxId: box.id }))),
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

  const handleScanUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id || !scanItemId || !scanFile || uploadingScan) return;
    if (scanFile.type !== 'application/pdf' || scanFile.size > 25 * 1024 * 1024) {
      toast.error(t('orders.detail.scanUploadError'));
      return;
    }
    setUploadingScan(true);
    try {
      const form = new FormData();
      form.append('file', scanFile);
      await api.post(`/orders/${id}/items/${scanItemId}/scan`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      await queryClient.invalidateQueries({ queryKey: ['order', id] });
      setScanItemId(null);
      setScanFile(null);
      toast.success(t('orders.detail.scanSaved'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('orders.detail.scanUploadError')));
    } finally {
      setUploadingScan(false);
    }
  };

  const downloadScan = async (itemId: string) => {
    if (!id || downloadingScan) return;
    setDownloadingScan(itemId);
    try {
      const { data } = await api.get(`/orders/${id}/items/${itemId}/scan`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `archivecore-skan-${itemId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(await getApiErrorMessageAsync(error, t('orders.detail.scanDownloadError')));
    } finally {
      setDownloadingScan(null);
    }
  };

  const uploadHandoverPhoto = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id || !handoverPhotoFile || uploadingHandoverPhoto) return;
    if (!['image/jpeg', 'image/png'].includes(handoverPhotoFile.type) || handoverPhotoFile.size > 5 * 1024 * 1024) {
      toast.error(t('orders.detail.handoverPhotoInvalid'));
      return;
    }
    setUploadingHandoverPhoto(true);
    try {
      const payload = new FormData();
      payload.append('file', handoverPhotoFile);
      if (handoverPhotoBoxId) payload.append('boxId', handoverPhotoBoxId);
      await api.post(`/orders/${id}/handover/photos`, payload);
      setHandoverPhotoFile(null);
      if (handoverPhotoInputRef.current) handoverPhotoInputRef.current.value = '';
      setHandoverPhotoBoxId('');
      await queryClient.invalidateQueries({ queryKey: ['order-handover-photos', activeTenantId, id] });
      toast.success(t('orders.detail.handoverPhotoUploaded'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('orders.detail.handoverPhotoUploadError')));
    } finally {
      setUploadingHandoverPhoto(false);
    }
  };

  const downloadHandoverPhoto = async (photo: HandoverPhoto) => {
    if (!id || downloadingHandoverPhoto) return;
    setDownloadingHandoverPhoto(photo.id);
    try {
      const { data } = await api.get(`/orders/${id}/handover/photos/${photo.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `archivecore-przekazanie-${photo.id}.${photo.mimeType === 'image/png' ? 'png' : 'jpg'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(await getApiErrorMessageAsync(error, t('orders.detail.handoverPhotoDownloadError')));
    } finally {
      setDownloadingHandoverPhoto(null);
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
      <OfflineScanPanel codes={offlineScans.codes} verifiedCodes={offlineScans.verifiedCodes} online={offlineScans.online} syncing={offlineScans.syncing}
        onRemove={offlineScans.remove} onSync={() => { void syncOfflinePicks(); }} savesOnSync />

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
            <button onClick={() => handleAction('ready')} className="btn-primary" disabled={patchOrder.isPending || offlineScans.codes.length > 0 || (order.orderType === 'checkout' && (order.items.length === 0 || remainingCount > 0)) || (order.orderType === 'scan' && (order.items.length === 0 || missingScanCount > 0))}>
              <Package size={16} /> {t('orders.detail.markReady')}
            </button>
          )}
          {order.status === 'ready' && hasPermission('order.process') && (
            <button onClick={() => {
              if (['checkout', 'return_order'].includes(order.orderType)) {
                locationRequestRef.current += 1;
                setRecipientName('');
                setSignatureData(null);
                setHandoverLocation(null);
                setBoxChecks(Object.fromEntries(handoverBoxes.map((box) => [box.id, { condition: '', sealNumber: '', conditionNote: '' }])));
                setIsLocating(false);
                setShowHandover(true);
              } else void handleAction('deliver');
            }} className="btn-primary" disabled={patchOrder.isPending}>
              <Truck size={16} /> {t(order.orderType === 'scan' ? 'orders.detail.scanDelivered' : 'orders.detail.deliver')}
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

      {order.orderType === 'scan' && order.status === 'in_progress' && missingScanCount > 0 && (
        <p role="status" className="text-sm text-amber-700">{t('orders.detail.scanReadyHint')}</p>
      )}

      {canPick && (
        <div className="card space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t('orders.detail.pickingTitle')}</h2>
            <p className="text-sm text-gray-600">{t('orders.detail.pickingProgress', { picked: handledCount, total: order.items.length })}</p>
            <p className="text-xs text-gray-500 mt-1">{t('orders.detail.pickRouteHint')}</p>
            {remainingCount > 0 && <p className="text-xs text-amber-700 mt-1">{t('orders.detail.pickingRequired')}</p>}
          </div>
          {!isScanning ? (
            <button type="button" className="btn-primary w-full sm:w-auto flex items-center justify-center gap-2" onClick={() => { startCameraSound(); lastCameraCodeRef.current = { code: '', retryAt: 0 }; setIsScanning(true); }}>
              <Camera size={17} />{t('labels.startCamera')}
            </button>
          ) : (
            <div className="space-y-2 max-w-lg">
              <QrCameraScanner
                id="archivecore-order-pick-scanner"
                onCode={handleCameraCode}
                onError={() => { showScanFeedback('error', t('labels.cameraError')); setIsScanning(false); }}
              />
              <button type="button" className="btn-secondary w-full" onClick={() => setIsScanning(false)}>{t('labels.stopCamera')}</button>
            </div>
          )}
          <button type="button" className="btn-secondary w-full sm:w-auto" aria-pressed={soundEnabled} onClick={toggleSound}>
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}{t(soundEnabled ? 'inventory.muteSound' : 'inventory.unmuteSound')}
          </button>
          {scanFeedback && (
            <div role="status" aria-live="polite" className={`rounded-lg border px-4 py-3 text-sm font-semibold break-words ${scanFeedbackStyles[scanFeedback.kind]}`}>
              {t(`orders.detail.scanResult.${scanFeedback.kind}`)}: {scanFeedback.message}
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
              {displayItems.map((item: any, index: number) => {
                const locationPath = getOrderItemPickLocation(item);
                const previousPath = index > 0 ? getOrderItemPickLocation(displayItems[index - 1]) : null;
                const pickBox = getOrderItemPickBox(item);
                return <Fragment key={item.id}>
                  {canPick && (index === 0 || locationPath !== previousPath) && (
                    <h3 className="text-sm font-semibold text-gray-800 pt-3 break-words">
                      {locationPath || t('orders.detail.pickLocationUnknown')}
                    </h3>
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="min-w-0 break-words">
                      {item.box && (
                        <div className="text-sm">
                          <span className="font-mono font-medium text-primary-700">{item.box.boxNumber}</span>
                          <span className="text-gray-500 ml-2">{item.box.title}</span>
                          {!canPick && item.box.location && <span className="text-xs text-gray-400 ml-2">📍 {item.box.location.fullPath}</span>}
                        </div>
                      )}
                      {item.hrFolder && (
                        <div className="text-sm">
                          <span className="font-medium">{item.hrFolder.employeeLastName} {item.hrFolder.employeeFirstName}</span>
                          <span className="text-gray-500 ml-2">{t('hr.title')}</span>
                          {item.hrFolder.box?.boxNumber && <span className="text-xs text-gray-400 ml-2">{item.hrFolder.box.boxNumber}</span>}
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
                          {pickBox?.boxNumber && (
                            <span className="text-xs text-gray-400 ml-2">📦 {pickBox.boxNumber}</span>
                          )}
                        </div>
                      )}
                      {!canPick && locationPath && !item.box && <p className="text-xs text-gray-500 mt-1">{locationPath}</p>}
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
                      {order.orderType === 'scan' && item.scanFile && (
                        <span className="text-xs text-gray-600 break-all">{item.scanFile.fileName} · {t('orders.detail.scanPages')}: {item.scanFile.pageCount}</span>
                      )}
                      {order.orderType === 'scan' && !item.scanFile && order.status === 'in_progress' && hasPermission('order.process') && (
                        <button type="button" className="btn-secondary text-xs" onClick={() => setScanItemId(item.id)}><Upload size={14} />{t('orders.detail.scanUpload')}</button>
                      )}
                      {order.orderType === 'scan' && item.scanFile && ['delivered', 'completed'].includes(order.status) && (
                        <button type="button" className="btn-secondary text-xs" disabled={downloadingScan === item.id} onClick={() => downloadScan(item.id)}><Download size={14} />{t('orders.detail.scanDownload')}</button>
                      )}
                      {order.orderType === 'scan' && item.scanFile && !['delivered', 'completed'].includes(order.status) && (
                        <span className="text-xs text-gray-500">{t('orders.detail.scanAvailableAfterDelivery')}</span>
                      )}
                    </div>
                  </div>
                </Fragment>;
              })}
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

          {order.handoverProof && (
            <div className="card space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">{t('orders.detail.handoverProof')}</h3>
              <p className="text-sm">{t('orders.detail.recipientName')}: <strong>{order.handoverProof.recipientName}</strong></p>
              <p className="text-sm text-gray-600">{t('orders.detail.recordedAt')}: {new Date(order.handoverProof.recordedAt).toLocaleString()}</p>
              <p className="text-sm text-gray-600">{t('orders.detail.recordedBy')}: {order.handoverProof.recordedBy.firstName} {order.handoverProof.recordedBy.lastName}</p>
              {order.handoverProof.latitude != null && order.handoverProof.longitude != null && order.handoverProof.accuracyMeters != null && (
                <p className="text-sm text-gray-600">{t('orders.detail.handoverLocation')}: {order.handoverProof.latitude.toFixed(5)}, {order.handoverProof.longitude.toFixed(5)} (±{Math.round(order.handoverProof.accuracyMeters)} m)</p>
              )}
              {order.handoverProof.signatureData && <div>
                <p className="text-sm text-gray-600 mb-1">{t('orders.detail.signature')}</p>
                <img src={order.handoverProof.signatureData} alt={t('orders.detail.signatureImage')} className="max-w-full max-h-36 rounded border border-gray-200 bg-white" />
              </div>}
              {order.handoverProof.boxChecks?.length > 0 && <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">{t('orders.detail.boxConditionTitle')}</p>
                {order.handoverProof.boxChecks.map((check: any) => <div key={check.boxId} className="rounded border border-gray-200 p-2 text-sm">
                  <strong>{check.box.boxNumber}</strong>: {t(`orders.detail.boxCondition.${check.condition}`)}
                  {check.sealNumber && <p>{t('orders.detail.sealNumber')}: {check.sealNumber}</p>}
                  {check.conditionNote && <p className="break-words">{t('orders.detail.conditionNote')}: {check.conditionNote}</p>}
                </div>)}
              </div>}
              <p className="text-xs text-gray-500">{t('orders.detail.handoverProofHint')}</p>
              <div className="border-t border-gray-200 pt-3 space-y-3">
                <h4 className="text-sm font-semibold text-gray-700">{t('orders.detail.handoverPhotos')} ({handoverPhotos.length})</h4>
                {photosLoading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
                {photosError && <p className="text-sm text-red-600">{t('orders.detail.handoverPhotoLoadError')}</p>}
                {handoverPhotos.map((photo) => <div key={photo.id} className="rounded border border-gray-200 p-2 text-sm space-y-1">
                  <p className="break-all font-medium">{photo.fileName}</p>
                  <p className="text-gray-600">{photo.box?.boxNumber || t('orders.detail.wholeHandover')} · {new Date(photo.uploadedAt).toLocaleString()} · {photo.uploadedBy.firstName} {photo.uploadedBy.lastName}</p>
                  <button type="button" className="btn-secondary text-xs" disabled={Boolean(downloadingHandoverPhoto)} onClick={() => { void downloadHandoverPhoto(photo); }}>
                    <Download size={14} /> {t('orders.detail.handoverPhotoDownload')}
                  </button>
                </div>)}
                {hasPermission('order.process') && handoverPhotos.length < 10 && <form onSubmit={(event) => { void uploadHandoverPhoto(event); }} className="space-y-2">
                  <label className="block text-sm font-medium">{t('orders.detail.handoverPhotoUpload')}
                    <input ref={handoverPhotoInputRef} type="file" accept="image/jpeg,image/png" className="mt-1 block w-full text-sm" onChange={(event) => setHandoverPhotoFile(event.target.files?.[0] || null)} />
                  </label>
                  {(order.handoverProof.boxChecks?.length || 0) > 0 && <label className="block text-sm">{t('orders.detail.handoverPhotoTarget')}
                    <select className="input mt-1 w-full" value={handoverPhotoBoxId} onChange={(event) => setHandoverPhotoBoxId(event.target.value)}>
                      <option value="">{t('orders.detail.wholeHandover')}</option>
                      {order.handoverProof.boxChecks.map((check: any) => <option key={check.boxId} value={check.boxId}>{check.box.boxNumber}</option>)}
                    </select>
                  </label>}
                  <button type="submit" className="btn-primary" disabled={!handoverPhotoFile || uploadingHandoverPhoto}>{uploadingHandoverPhoto && <Loader2 size={16} className="animate-spin" />}{t('orders.detail.handoverPhotoUploadButton')}</button>
                  <p className="text-xs text-gray-500">{t('orders.detail.handoverPhotoHint')}</p>
                </form>}
              </div>
            </div>
          )}

          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">{t('orders.detail.custody.title')}</h3>
            {custodyLoading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
            {custodyError && <p className="text-sm text-red-600">{t('orders.detail.custody.loadError')}</p>}
            {!custodyLoading && !custodyError && custodyEvents.length === 0 && <p className="text-sm text-gray-500">{t('orders.detail.custody.empty')}</p>}
            <ol className="max-h-96 overflow-y-auto divide-y divide-gray-100">
              {custodyEvents.map((event) => <li key={event.id} className="py-3 text-sm space-y-1">
                <p className="font-medium">{t(`orders.detail.custody.${event.eventType}`)} · {new Date(event.eventAt).toLocaleString()}</p>
                <p className="break-words">
                  {event.box && <Link to={`/boxes/${event.box.id}`} className="text-primary-700 hover:underline">{t('orders.detail.custody.box')}: {event.box.boxNumber}</Link>}
                  {event.folder && <Link to={`/folders/${event.folder.id}`} className="text-primary-700 hover:underline">{t('orders.detail.custody.folder')}: {event.folder.folderNumber} · {event.folder.title}</Link>}
                  {event.document && <span>{t('orders.detail.custody.document')}: {event.document.title}</span>}
                  {event.hrFolder && <Link to={`/hr/${event.hrFolder.id}`} className="text-primary-700 hover:underline">{t('orders.detail.custody.hrFolder')}: {event.hrFolder.employeeFirstName} {event.hrFolder.employeeLastName}</Link>}
                </p>
                {event.performedBy && <p className="text-gray-600">{t('orders.detail.custody.operator')}: {event.performedBy.firstName} {event.performedBy.lastName}</p>}
                {event.recipientName && <p className="text-gray-600">{t('orders.detail.custody.recipient')}: {event.recipientName}</p>}
                {event.notes && <p className="text-gray-600 break-words">{event.notes}</p>}
              </li>)}
            </ol>
          </div>

          {/* Activity Timeline */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('boxes.changeHistory')}</h3>
            <ActivityTimeline entityType="order" entityId={order.id} />
          </div>
        </div>
      </div>

      <Modal isOpen={showHandover} onClose={() => { if (!patchOrder.isPending) closeHandover(); }} title={t('orders.detail.handoverTitle')}>
        <form onSubmit={(event) => { void confirmHandover(event); }} className="space-y-4">
          <p className="text-sm text-gray-600">{t('orders.detail.handoverIntro')}</p>
          <div>
            <label htmlFor="handover-recipient" className="label-text">{t('orders.detail.recipientName')}</label>
            <input id="handover-recipient" className="input-field" required minLength={2} maxLength={120}
              value={recipientName} onChange={(event) => setRecipientName(event.target.value)} />
          </div>
          <SignaturePad onChange={setSignatureData} disabled={patchOrder.isPending} />
          {handoverBoxes.length > 0 && <div className="space-y-3">
            <p className="label-text">{t('orders.detail.boxConditionTitle')}</p>
            <p className="text-xs text-gray-500">{t('orders.detail.boxConditionHint')}</p>
            {handoverBoxes.map((box) => {
              const check = boxChecks[box.id] || { condition: '', sealNumber: '', conditionNote: '' };
              const update = (patch: Partial<HandoverBoxCheck>) => setBoxChecks((current) => ({ ...current, [box.id]: { ...current[box.id], ...patch } }));
              return <fieldset key={box.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <legend className="px-1 font-medium">{box.number}</legend>
                <div>
                  <label htmlFor={`condition-${box.id}`} className="label-text">{t('orders.detail.boxConditionLabel')}</label>
                  <select id={`condition-${box.id}`} className="input-field" required value={check.condition} disabled={patchOrder.isPending}
                    onChange={(event) => update({ condition: event.target.value as BoxCondition })}>
                    <option value="">{t('orders.detail.chooseCondition')}</option>
                    <option value="intact">{t('orders.detail.boxCondition.intact')}</option>
                    <option value="damaged">{t('orders.detail.boxCondition.damaged')}</option>
                    <option value="unverified">{t('orders.detail.boxCondition.unverified')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor={`seal-${box.id}`} className="label-text">{t('orders.detail.sealNumber')}</label>
                  <input id={`seal-${box.id}`} className="input-field" maxLength={100} value={check.sealNumber} disabled={patchOrder.isPending}
                    onChange={(event) => update({ sealNumber: event.target.value })} />
                </div>
                <div>
                  <label htmlFor={`condition-note-${box.id}`} className="label-text">{t('orders.detail.conditionNote')}</label>
                  <textarea id={`condition-note-${box.id}`} className="input-field" rows={2} maxLength={1000}
                    required={check.condition === 'damaged'} minLength={check.condition === 'damaged' ? 3 : undefined}
                    value={check.conditionNote} disabled={patchOrder.isPending}
                    onChange={(event) => update({ conditionNote: event.target.value })} />
                </div>
              </fieldset>;
            })}
          </div>}
          <div className="space-y-2">
            <button type="button" className="btn-secondary" disabled={isLocating || patchOrder.isPending} onClick={requestHandoverLocation}>
              {isLocating ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
              {t('orders.detail.captureLocation')}
            </button>
            {handoverLocation && <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>{handoverLocation.latitude.toFixed(5)}, {handoverLocation.longitude.toFixed(5)} (±{Math.round(handoverLocation.accuracyMeters)} m)</span>
              <button type="button" className="text-primary-700 underline" onClick={() => setHandoverLocation(null)}>{t('orders.detail.removeLocation')}</button>
            </div>}
            <p className="text-xs text-gray-500">{t('orders.detail.locationOptional')}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={patchOrder.isPending} onClick={closeHandover}>{t('common.cancel')}</button>
            <button type="submit" className="btn-primary" disabled={patchOrder.isPending || recipientName.trim().length < 2 || !boxChecksReady}>
              {patchOrder.isPending && <Loader2 size={16} className="animate-spin" />}{t('orders.detail.confirmHandover')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showAddItem}
        onClose={() => { setShowAddItem(false); resetAddItemForm(); }}
        title={t('orders.detail.addItemTitle', 'Dodaj pozycję do zlecenia')}
        size="lg"
      >
        <form onSubmit={handleAddItems} className="space-y-4">
          {order.orderType !== 'scan' && <div>
            <label className="label-text">{t('orders.createModal.boxIds')}</label>
            <BoxPicker
              value={selectedBoxes}
              onChange={setSelectedBoxes}
              placeholder={t('orders.createModal.boxIdsPlaceholder')}
            />
          </div>}
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
              disabled={addingItems || ((order.orderType === 'scan' ? 0 : selectedBoxes.length) + selectedFolders.length + selectedDocuments.length === 0)}
              className="btn-primary"
            >
              {addingItems ? t('common.saving', 'Zapisywanie...') : t('orders.detail.addItem', 'Dodaj pozycję')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(scanItemId)} onClose={() => { if (!uploadingScan) { setScanItemId(null); setScanFile(null); } }} title={t('orders.detail.scanUpload')} size="md">
        <form onSubmit={handleScanUpload} className="space-y-4">
          <div>
            <label htmlFor="order-scan-file" className="label-text">{t('orders.detail.scanFile')}</label>
            <input id="order-scan-file" type="file" accept="application/pdf" className="input-field" required onChange={(event) => setScanFile(event.target.files?.[0] || null)} />
          </div>
          <p className="text-xs text-gray-500">{t('orders.detail.scanPageHint')}</p>
          <button type="submit" className="btn-primary" disabled={!scanFile || uploadingScan}>{uploadingScan ? t('common.saving') : t('orders.detail.scanSave')}</button>
        </form>
      </Modal>
    </div>
  );
}
