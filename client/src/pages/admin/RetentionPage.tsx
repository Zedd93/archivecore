import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useCreate } from '@/hooks/useApi';
import { DOC_TYPES, Permissions, RoleCode } from '@archivecore/shared';
import { useAuth } from '@/contexts/AuthContext';
import { getApiErrorMessage, getApiErrorMessageAsync } from '@/utils/apiError';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import Pagination from '@/components/ui/Pagination';
import StatusBadge from '@/components/ui/StatusBadge';
import DocumentationLegalHoldControl from '@/components/retention/DocumentationLegalHoldControl';
import toast from 'react-hot-toast';
import { Plus, Clock, AlertTriangle, Loader2, Upload, FileText, CheckCircle2, Download, Image } from 'lucide-react';

const RETENTION_YEAR_OPTIONS = [1, 2, 5, 10, 25, 50, 75, 100] as const;

export default function RetentionPage() {
  const { t } = useTranslation();
  const { hasPermission, user } = useAuth();
  const queryClient = useQueryClient();
  const [showCreatePolicy, setShowCreatePolicy] = useState(false);
  const [showJrwaImport, setShowJrwaImport] = useState(false);
  const [showDisposalProposal, setShowDisposalProposal] = useState(false);
  const [reviewDays, setReviewDays] = useState(90);
  const [duePage, setDuePage] = useState(1);
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const [approvedPage, setApprovedPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const [downloadingConfirmation, setDownloadingConfirmation] = useState<string | null>(null);
  const [evidenceBatchId, setEvidenceBatchId] = useState<string | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceInputKey, setEvidenceInputKey] = useState(0);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [downloadingEvidence, setDownloadingEvidence] = useState<string | null>(null);
  const [selectedDueIds, setSelectedDueIds] = useState<Set<string>>(new Set());
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(new Set());
  const [selectedApprovedIds, setSelectedApprovedIds] = useState<Set<string>>(new Set());
  const [disposalAction, setDisposalAction] = useState<'review' | 'approve' | 'reject' | 'ap-decision' | 'complete' | null>(null);
  const [decisionText, setDecisionText] = useState('');
  const [apDecision, setApDecision] = useState<'consent_received' | 'not_required'>('consent_received');
  const [apReference, setApReference] = useState('');
  const [apDate, setApDate] = useState('');
  const [protocolReference, setProtocolReference] = useState('');
  const [methodDescription, setMethodDescription] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [executionNote, setExecutionNote] = useState('');
  const [completionConfirmed, setCompletionConfirmed] = useState(false);
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [proposalNotes, setProposalNotes] = useState('');
  const [proposalSubmitting, setProposalSubmitting] = useState(false);
  const [policyTenantId, setPolicyTenantId] = useState(() => localStorage.getItem('tenantId') || '');
  const [jrwaTenantId, setJrwaTenantId] = useState('');
  const [jrwaFile, setJrwaFile] = useState<File | null>(null);
  const [jrwaLabel, setJrwaLabel] = useState('');
  const [jrwaValidFrom, setJrwaValidFrom] = useState('');
  const [jrwaVersionFilter, setJrwaVersionFilter] = useState('current');
  const [jrwaPreview, setJrwaPreview] = useState<any>(null);
  const [jrwaLoading, setJrwaLoading] = useState(false);
  const [jrwaImporting, setJrwaImporting] = useState(false);
  const canManageGlobalPolicies = hasPermission(Permissions.SYSTEM_CONFIG);
  const canManageRetention = hasPermission(Permissions.RETENTION_MANAGE);
  const canInitiateDisposal = hasPermission(Permissions.DISPOSAL_INITIATE);
  const activeTenantId = localStorage.getItem('tenantId') || '';
  const canApproveDisposal = hasPermission(Permissions.DISPOSAL_APPROVE)
    && user?.tenantId === activeTenantId
    && user.roles.some((role) => role === RoleCode.TENANT_LEADERSHIP || role === RoleCode.ADMIN_TENANT);
  const canCompleteDisposal = hasPermission(Permissions.DISPOSAL_COMPLETE);
  const canMarkApNotRequired = user?.roles.includes(RoleCode.SUPER_ADMIN);
  const reviewLimit = 25;

  const { data: policies, isLoading: polLoading } = useQuery({
    queryKey: ['retention-policies', policyTenantId],
    queryFn: async () => {
      const { data } = await api.get('/retention/policies', {
        params: policyTenantId ? { tenantId: policyTenantId } : undefined,
      });
      return data.data;
    },
    enabled: canManageRetention,
  });

  const { data: tenants = [] } = useQuery({
    queryKey: ['retention-tenants'],
    queryFn: async () => {
      const { data } = await api.get('/tenants', { params: { limit: 200, isActive: true } });
      return data.data || [];
    },
    enabled: canManageGlobalPolicies,
  });

  const { data: jrwaVersions = [] } = useQuery({
    queryKey: ['jrwa-versions', policyTenantId],
    queryFn: async () => {
      const { data } = await api.get('/retention/policies/jrwa/versions', {
        params: policyTenantId ? { tenantId: policyTenantId } : undefined,
      });
      return data.data || [];
    },
    enabled: canManageRetention && Boolean(policyTenantId || !canManageGlobalPolicies),
  });

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentJrwaVersion = jrwaVersions.find((version: any) =>
    version.validFrom.slice(0, 10) <= today && (!version.validTo || version.validTo.slice(0, 10) >= today)
  );
  const visiblePolicies = (policies || []).filter((policy: any) => {
    if (jrwaVersionFilter === 'all') return true;
    if (jrwaVersionFilter === 'legacy') return Boolean(policy.jrwaCode && !policy.jrwaVersionId);
    if (jrwaVersionFilter === 'current') {
      if (!policy.jrwaVersionId) return !policy.jrwaCode || !currentJrwaVersion;
      return policy.jrwaVersionId === currentJrwaVersion?.id;
    }
    return policy.jrwaVersionId === jrwaVersionFilter;
  });

  useEffect(() => {
    if (!jrwaTenantId && policyTenantId) setJrwaTenantId(policyTenantId);
  }, [jrwaTenantId, policyTenantId]);

  const { data: dueBoxes, isLoading: dueLoading, isError: dueError } = useQuery({
    queryKey: ['retention-review', activeTenantId, 'due', duePage],
    queryFn: async () => { const { data } = await api.get('/retention/review', { params: { scope: 'due', page: duePage, limit: reviewLimit } }); return data.data; },
    enabled: Boolean(activeTenantId) && canInitiateDisposal,
  });

  const { data: approvedBoxes, isLoading: approvedLoading, isError: approvedError } = useQuery({
    queryKey: ['retention-approved', activeTenantId, approvedPage],
    queryFn: async () => { const { data } = await api.get('/retention/disposal/approved', { params: { page: approvedPage, limit: reviewLimit } }); return data.data; },
    enabled: Boolean(activeTenantId) && (canApproveDisposal || canCompleteDisposal),
  });

  const { data: completedDisposals, isLoading: completedLoading, isError: completedError } = useQuery({
    queryKey: ['retention-completed', activeTenantId, completedPage],
    queryFn: async () => { const { data } = await api.get('/retention/disposal/completed', { params: { page: completedPage, limit: reviewLimit } }); return data.data; },
    enabled: Boolean(activeTenantId) && (canApproveDisposal || canCompleteDisposal),
  });

  const { data: evidence = [], isLoading: evidenceLoading, isError: evidenceError } = useQuery({
    queryKey: ['retention-evidence', activeTenantId, evidenceBatchId],
    queryFn: async () => { const { data } = await api.get(`/retention/disposal/completed/${encodeURIComponent(evidenceBatchId!)}/evidence`); return data.data; },
    enabled: Boolean(activeTenantId && evidenceBatchId),
  });

  const { data: upcomingBoxes, isLoading: upcomingLoading, isError: upcomingError } = useQuery({
    queryKey: ['retention-review', activeTenantId, 'upcoming', reviewDays, upcomingPage],
    queryFn: async () => { const { data } = await api.get('/retention/review', { params: { scope: 'upcoming', days: reviewDays, page: upcomingPage, limit: reviewLimit } }); return data.data; },
    enabled: Boolean(activeTenantId) && canInitiateDisposal,
  });

  const { data: pendingBoxes, isLoading: pendingLoading, isError: pendingError } = useQuery({
    queryKey: ['retention-pending', activeTenantId, pendingPage],
    queryFn: async () => { const { data } = await api.get('/retention/disposal/pending', { params: { page: pendingPage, limit: reviewLimit } }); return data.data; },
    enabled: Boolean(activeTenantId) && (canInitiateDisposal || canApproveDisposal),
  });

  useEffect(() => {
    setEvidenceBatchId(null);
    setEvidenceFile(null);
    setSelectedDueIds(new Set());
    setSelectedPendingIds(new Set());
    setSelectedApprovedIds(new Set());
    setDuePage(1);
    setUpcomingPage(1);
    setPendingPage(1);
    setApprovedPage(1);
    setCompletedPage(1);
  }, [activeTenantId]);

  const createPolicy = useCreate('/retention/policies', ['retention-policies'], t('admin.retention.policyCreated'));

  const formatRetentionYears = (years: number | null, item?: any) => {
    if (item?.isPermanent || item?.archivalCategory === 'A') return t('admin.retention.permanent');
    if (!years) return t('admin.retention.noFixedPeriod');
    const mod10 = years % 10;
    const mod100 = years % 100;
    if (years === 1) return t('admin.retention.yearOne', { count: years });
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
      return t('admin.retention.yearFew', { count: years });
    }
    return t('admin.retention.years', { count: years });
  };

  const policyColumns: Column<any>[] = [
    { key: 'jrwaCode', header: t('admin.retention.jrwaCode'), render: (item) => item.jrwaCode ? <span className="font-mono font-medium">{item.jrwaCode}</span> : '—' },
    { key: 'seriesHold', header: t('admin.retention.seriesHold'), render: (item) => item.jrwaCode && item.tenantId
      ? <DocumentationLegalHoldControl
          path={`/retention/policies/${item.id}/series`}
          held={Boolean(item.seriesLegalHold)}
          holdReason={item.seriesLegalHoldReason || null}
          onChanged={() => queryClient.invalidateQueries({ queryKey: ['retention-policies'] })}
          compact
        />
      : '—' },
    { key: 'jrwaVersion', header: t('admin.retention.jrwaVersion'), render: (item) => item.jrwaVersion
      ? <span>{item.jrwaVersion.label} ({item.jrwaVersion.validFrom.slice(0, 10)} – {item.jrwaVersion.validTo?.slice(0, 10) || '…'})</span>
      : item.jrwaCode ? t('admin.retention.jrwaLegacy') : '—' },
    { key: 'name', header: t('common.name'), render: (item) => <span className="font-medium">{item.name}</span> },
    { key: 'docType', header: t('admin.retention.createModal.docType'), render: (item) => item.docType ? t(`docTypes.${item.docType}`, { defaultValue: item.docType }) : t('common.all') },
    { key: 'archivalCategory', header: t('admin.retention.archivalCategory'), render: (item) => item.archivalCategory || '—' },
    {
      key: 'scope',
      header: t('admin.retention.scope'),
      render: (item) => item.tenantId
        ? <span className="badge-blue">{item.tenant?.shortCode || t('admin.retention.scopeTenant')}</span>
        : <span className="badge-purple">{t('admin.retention.scopeGlobal')}</span>,
    },
    { key: 'retentionYears', header: t('admin.retention.createModal.period'), render: (item) => formatRetentionYears(item.retentionYears, item) },
    {
      key: 'retentionTrigger',
      header: t('admin.retention.createModal.trigger'),
      render: (item) => item.retentionTrigger === 'end_date' ? t('admin.retention.createModal.triggerEndDate') : item.retentionTrigger === 'creation_date' ? t('admin.retention.createModal.triggerCreationDate') : item.retentionTrigger,
    },
    {
      key: 'isActive',
      header: t('common.status'),
      render: (item) => {
        if (item.jrwaVersion?.validFrom.slice(0, 10) > today) return <span className="badge-blue">{t('admin.retention.jrwaFuture')}</span>;
        if (item.jrwaVersion?.validTo?.slice(0, 10) < today) return <span className="badge-gray">{t('admin.retention.jrwaHistorical')}</span>;
        return item.isActive ? <span className="badge-green">{t('admin.retention.statusActive')}</span> : <span className="badge-gray">{t('admin.retention.statusInactive')}</span>;
      },
    },
    { key: '_count', header: t('boxes.title'), render: (item) => item._count?.boxes ?? 0 },
  ];

  const reviewColumns: Column<any>[] = [
    { key: 'boxNumber', header: t('boxes.boxNumber'), render: (item) => <span className="font-mono font-medium text-primary-700">{item.boxNumber}</span> },
    { key: 'title', header: t('common.title') },
    { key: 'location', header: t('boxes.location'), render: (item) => item.location?.fullPath || '—' },
    {
      key: 'retentionDate',
      header: t('boxes.retentionDate'),
      render: (item) => {
        if (!item.retentionDate) return '—';
        const d = new Date(item.retentionDate);
        const isExpired = d < new Date();
        return <span className={isExpired ? 'text-red-600 font-medium' : ''}>{d.toLocaleDateString('pl-PL')}</span>;
      },
    },
    { key: 'retentionPolicy', header: t('admin.retention.policies'), render: (item) => item.retentionPolicy?.name || '—' },
    { key: 'status', header: t('common.status'), render: (item) => <div className="flex flex-wrap gap-1"><StatusBadge status={item.status} type="box" />{item.legalHold && <span className="badge-red">{t('boxes.legalHold')}</span>}</div> },
    { key: 'disposalStep', header: t('admin.retention.disposal.step'), render: (item) => item.status === 'pending_disposal'
      ? t(item.disposalReviewedAt ? 'admin.retention.disposal.reviewed' : 'admin.retention.disposal.awaitingReview')
      : item.status === 'approved_disposal'
        ? t(item.apDecision === 'consent_received' ? 'admin.retention.disposal.apReceived' : item.apDecision === 'not_required' ? 'admin.retention.disposal.apNotRequired' : 'admin.retention.disposal.awaitingAp')
        : '—' },
  ];

  const downloadConfirmation = async (id: string) => {
    if (downloadingConfirmation) return;
    setDownloadingConfirmation(id);
    try {
      const { data } = await api.get(`/retention/disposal/completed/${encodeURIComponent(id)}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `archivecore-brakowanie-${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(await getApiErrorMessageAsync(error, t('admin.retention.disposal.downloadError')));
    } finally {
      setDownloadingConfirmation(null);
    }
  };

  const uploadEvidence = async () => {
    if (!evidenceBatchId || !evidenceFile || uploadingEvidence) return;
    if (!['image/jpeg', 'image/png'].includes(evidenceFile.type) || evidenceFile.size > 5 * 1024 * 1024) {
      toast.error(t('admin.retention.disposal.evidenceInvalid'));
      return;
    }
    setUploadingEvidence(true);
    try {
      const form = new FormData();
      form.append('file', evidenceFile);
      await api.post(`/retention/disposal/completed/${encodeURIComponent(evidenceBatchId)}/evidence`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setEvidenceFile(null);
      setEvidenceInputKey((key) => key + 1);
      await queryClient.invalidateQueries({ queryKey: ['retention-evidence', activeTenantId, evidenceBatchId] });
      toast.success(t('admin.retention.disposal.evidenceUploaded'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('admin.retention.disposal.evidenceUploadError')));
    } finally {
      setUploadingEvidence(false);
    }
  };

  const downloadEvidence = async (id: string, fileName: string) => {
    if (!evidenceBatchId || downloadingEvidence) return;
    setDownloadingEvidence(id);
    try {
      const { data } = await api.get(`/retention/disposal/completed/${encodeURIComponent(evidenceBatchId)}/evidence/${encodeURIComponent(id)}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(await getApiErrorMessageAsync(error, t('admin.retention.disposal.evidenceDownloadError')));
    } finally {
      setDownloadingEvidence(null);
    }
  };

  const completedColumns: Column<any>[] = [
    { key: 'completedAt', header: t('admin.retention.disposal.completedAt'), render: (item) => new Date(item.completedAt).toLocaleString('pl-PL') },
    { key: 'protocolReference', header: t('admin.retention.disposal.protocolReference') },
    { key: 'boxCount', header: t('boxes.title') },
    { key: 'completedBy', header: t('admin.retention.disposal.completedBy') },
    { key: 'download', header: t('admin.retention.disposal.confirmation'), render: (item) => <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary text-xs" disabled={downloadingConfirmation === item.id} onClick={() => downloadConfirmation(item.id)}><Download size={14} />{t('admin.retention.disposal.download')}</button><button type="button" className="btn-secondary text-xs" onClick={() => setEvidenceBatchId(item.id)}><Image size={14} />{t('admin.retention.disposal.evidence')}</button></div> },
  ];

  const handleCreatePolicy = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createPolicy.mutateAsync({
      scope: canManageGlobalPolicies ? fd.get('scope') || 'tenant' : 'tenant',
      name: fd.get('name'),
      docType: fd.get('docType') || undefined,
      retentionYears: parseInt(fd.get('retentionYears') as string),
      retentionTrigger: fd.get('retentionTrigger') || 'end_date',
      description: fd.get('description') || undefined,
    });
    setShowCreatePolicy(false);
  };

  const resetJrwaImport = () => {
    setJrwaFile(null);
    setJrwaLabel('');
    setJrwaValidFrom('');
    setJrwaPreview(null);
    setJrwaLoading(false);
    setJrwaImporting(false);
  };

  const closeJrwaImport = () => {
    setShowJrwaImport(false);
    resetJrwaImport();
  };

  const createJrwaFormData = () => {
    if (!jrwaFile || !jrwaTenantId || !jrwaLabel.trim() || !jrwaValidFrom) return null;
    const formData = new FormData();
    formData.append('file', jrwaFile);
    formData.append('tenantId', jrwaTenantId);
    formData.append('label', jrwaLabel.trim());
    formData.append('validFrom', jrwaValidFrom);
    return formData;
  };

  const handleJrwaPreview = async () => {
    const formData = createJrwaFormData();
    if (!formData) {
      toast.error(t('admin.retention.jrwaImport.required'));
      return;
    }
    setJrwaLoading(true);
    try {
      const { data } = await api.post('/retention/policies/jrwa/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setJrwaPreview(data.data);
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('admin.retention.jrwaImport.previewError')));
    } finally {
      setJrwaLoading(false);
    }
  };

  const handleJrwaImport = async () => {
    const formData = createJrwaFormData();
    if (!formData) return;
    setJrwaImporting(true);
    try {
      const { data } = await api.post('/retention/policies/jrwa/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(t('admin.retention.jrwaImport.success', {
        created: data.data.created,
        updated: data.data.updated,
      }));
      setPolicyTenantId(jrwaTenantId);
      setJrwaVersionFilter('current');
      await queryClient.invalidateQueries({ queryKey: ['retention-policies'] });
      await queryClient.invalidateQueries({ queryKey: ['jrwa-versions'] });
      closeJrwaImport();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('admin.retention.jrwaImport.importError')));
    } finally {
      setJrwaImporting(false);
    }
  };

  const handleDisposalProposal = async () => {
    if (!selectedDueIds.size) return;
    setProposalSubmitting(true);
    try {
      await api.post('/retention/disposal/initiate', {
        boxIds: [...selectedDueIds],
        notes: proposalNotes.trim() || undefined,
      });
      toast.success(t('admin.retention.disposal.proposed', { count: selectedDueIds.size }));
      setSelectedDueIds(new Set());
      setDuePage(1);
      setPendingPage(1);
      setProposalNotes('');
      setShowDisposalProposal(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['retention-review'] }),
        queryClient.invalidateQueries({ queryKey: ['retention-pending'] }),
        queryClient.invalidateQueries({ queryKey: ['boxes'] }),
      ]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, t('admin.retention.disposal.proposalError')));
    } finally {
      setProposalSubmitting(false);
    }
  };

  const handleDisposalDecision = async () => {
    if (!disposalAction) return;
    const boxIds = [...(['complete', 'ap-decision'].includes(disposalAction) ? selectedApprovedIds : selectedPendingIds)];
    if (!boxIds.length) return;
    if (disposalAction === 'review' && decisionText.trim().length < 5) return;
    if (disposalAction === 'reject' && decisionText.trim().length < 5) return;
    if (disposalAction === 'ap-decision' && (apDecision === 'consent_received'
      ? apReference.trim().length < 3 || !apDate
      : decisionText.trim().length < 10)) return;
    if (disposalAction === 'complete' && (protocolReference.trim().length < 3 || !completionConfirmed)) return;
    const parsedWeight = weightKg.trim() ? Number(weightKg) : undefined;
    if (disposalAction === 'complete' && (
      (methodDescription.trim().length > 0 && methodDescription.trim().length < 3) ||
      (parsedWeight !== undefined && (!Number.isFinite(parsedWeight) || parsedWeight <= 0 || parsedWeight > 100000))
    )) {
      toast.error(t('admin.retention.disposal.invalidExecutionDetails'));
      return;
    }
    setDecisionSubmitting(true);
    try {
      await api.post(`/retention/disposal/${disposalAction}`, {
        boxIds,
        ...(disposalAction === 'review' ? { notes: decisionText.trim() } : {}),
        ...(disposalAction === 'approve' && decisionText.trim() ? { notes: decisionText.trim() } : {}),
        ...(disposalAction === 'reject' ? { reason: decisionText.trim() } : {}),
        ...(disposalAction === 'ap-decision' ? apDecision === 'consent_received'
          ? { decision: apDecision, reference: apReference.trim(), decisionDate: apDate }
          : { decision: apDecision, reason: decisionText.trim() } : {}),
        ...(disposalAction === 'complete' ? {
          protocolReference: protocolReference.trim(),
          ...(methodDescription.trim() ? { methodDescription: methodDescription.trim() } : {}),
          ...(parsedWeight !== undefined ? { weightKg: parsedWeight } : {}),
          ...(executionNote.trim() ? { executionNote: executionNote.trim() } : {}),
          confirmed: true,
        } : {}),
      });
      toast.success(t(`admin.retention.disposal.${disposalAction}Success`, { count: boxIds.length }));
      setSelectedPendingIds(new Set());
      setSelectedApprovedIds(new Set());
      setDecisionText('');
      setApReference('');
      setApDate('');
      setProtocolReference('');
      setMethodDescription('');
      setWeightKg('');
      setExecutionNote('');
      setCompletionConfirmed(false);
      setDisposalAction(null);
      setPendingPage(1);
      setApprovedPage(1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['retention-pending'] }),
        queryClient.invalidateQueries({ queryKey: ['retention-approved'] }),
        queryClient.invalidateQueries({ queryKey: ['retention-completed'] }),
        queryClient.invalidateQueries({ queryKey: ['retention-review'] }),
        queryClient.invalidateQueries({ queryKey: ['boxes'] }),
        queryClient.invalidateQueries({ queryKey: ['locations-tree'] }),
        queryClient.invalidateQueries({ queryKey: ['report-boxes-status'] }),
        queryClient.invalidateQueries({ queryKey: ['report-occupancy'] }),
        queryClient.invalidateQueries({ queryKey: ['report-retention'] }),
      ]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, t('admin.retention.disposal.decisionError')));
    } finally {
      setDecisionSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Clock size={24} className="text-primary-600" /> {t('admin.retention.title')}
        </h1>
        <p className="text-sm text-gray-500">{t('admin.retention.subtitle')}</p>
      </div>

      {!activeTenantId && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {t('admin.retention.disposal.selectTenant')}
        </div>
      )}

      {/* Policies */}
      {canManageRetention && <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">{t('admin.retention.policies')}</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            {canManageGlobalPolicies && (
              <select
                value={policyTenantId}
                onChange={(e) => { setPolicyTenantId(e.target.value); setJrwaVersionFilter('current'); }}
                className="input-field sm:w-64"
                aria-label={t('admin.retention.tenantFilter')}
              >
                <option value="">{t('admin.retention.globalOnly')}</option>
                {tenants.map((tenant: any) => (
                  <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                ))}
              </select>
            )}
            {policyTenantId && (
              <select value={jrwaVersionFilter} onChange={(e) => setJrwaVersionFilter(e.target.value)} className="input-field sm:w-64" aria-label={t('admin.retention.jrwaVersionFilter')}>
                <option value="current">{t('admin.retention.jrwaCurrent')}</option>
                <option value="all">{t('admin.retention.jrwaAll')}</option>
                <option value="legacy">{t('admin.retention.jrwaLegacy')}</option>
                {jrwaVersions.map((version: any) => (
                  <option key={version.id} value={version.id}>{version.label} ({version.validFrom.slice(0, 10)})</option>
                ))}
              </select>
            )}
            {canManageGlobalPolicies && (
              <button onClick={() => setShowJrwaImport(true)} className="btn-secondary w-full sm:w-auto">
                <Upload size={16} /> {t('admin.retention.importJrwa')}
              </button>
            )}
            <button onClick={() => setShowCreatePolicy(true)} className="btn-primary w-full sm:w-auto">
              <Plus size={16} /> {t('admin.retention.newPolicy')}
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-3">{t('admin.retention.seriesHoldHint')}</p>
        <DataTable columns={policyColumns} data={visiblePolicies} isLoading={polLoading} emptyMessage={t('admin.retention.noPolicies')} />
      </div>}

      {activeTenantId && canInitiateDisposal && (
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2"><AlertTriangle size={20} className="text-orange-500" />{t('admin.retention.disposal.dueTitle')}</h2>
              <p className="text-sm text-gray-500 mt-1">{t('admin.retention.disposal.dueHint')}</p>
            </div>
            <button type="button" onClick={() => setShowDisposalProposal(true)} disabled={selectedDueIds.size === 0} className="btn-primary">
              {t('admin.retention.disposal.propose', { count: selectedDueIds.size })}
            </button>
          </div>
          {dueError ? <p role="alert" className="text-sm text-red-700">{t('admin.retention.disposal.loadError')}</p> : <DataTable columns={reviewColumns} data={dueBoxes?.data || []} isLoading={dueLoading} emptyMessage={t('admin.retention.disposal.noDue')} selectable selectedIds={selectedDueIds} onSelectionChange={setSelectedDueIds} />}
          <Pagination page={duePage} limit={reviewLimit} total={dueBoxes?.total || 0} onPageChange={setDuePage} />
        </div>
      )}

      {activeTenantId && (canInitiateDisposal || canApproveDisposal) && (
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
            <h2 className="text-lg font-semibold">{t('admin.retention.disposal.pendingTitle')}</h2>
            <div className="flex flex-wrap gap-2">
              {canInitiateDisposal && <button type="button" className="btn-secondary" disabled={!selectedPendingIds.size || (pendingBoxes?.data || []).some((box: any) => selectedPendingIds.has(box.id) && box.disposalReviewedAt)} onClick={() => setDisposalAction('review')}>{t('admin.retention.disposal.review', { count: selectedPendingIds.size })}</button>}
              {canApproveDisposal && <button type="button" className="btn-primary" disabled={!selectedPendingIds.size || (pendingBoxes?.data || []).some((box: any) => selectedPendingIds.has(box.id) && !box.disposalReviewedAt)} onClick={() => setDisposalAction('approve')}>{t('admin.retention.disposal.approve', { count: selectedPendingIds.size })}</button>}
              {canApproveDisposal && <>
              <button type="button" className="btn-secondary" disabled={!selectedPendingIds.size} onClick={() => setDisposalAction('reject')}>{t('admin.retention.disposal.reject', { count: selectedPendingIds.size })}</button>
              </>}
            </div>
          </div>
          <p className="text-sm text-gray-500 mb-4">{t('admin.retention.disposal.pendingHint')}</p>
          {pendingError ? <p role="alert" className="text-sm text-red-700">{t('admin.retention.disposal.loadError')}</p> : <DataTable columns={reviewColumns} data={pendingBoxes?.data || []} isLoading={pendingLoading} emptyMessage={t('admin.retention.disposal.noPending')} selectable={canInitiateDisposal || canApproveDisposal} selectedIds={selectedPendingIds} onSelectionChange={setSelectedPendingIds} />}
          <Pagination page={pendingPage} limit={reviewLimit} total={pendingBoxes?.total || 0} onPageChange={(page) => { setSelectedPendingIds(new Set()); setPendingPage(page); }} />
        </div>
      )}

      {activeTenantId && (canApproveDisposal || canCompleteDisposal) && (
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
            <h2 className="text-lg font-semibold">{t('admin.retention.disposal.approvedTitle')}</h2>
            {canCompleteDisposal && <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" disabled={!selectedApprovedIds.size || (approvedBoxes?.data || []).some((box: any) => selectedApprovedIds.has(box.id) && box.apDecision)} onClick={() => setDisposalAction('ap-decision')}>{t('admin.retention.disposal.apDecision', { count: selectedApprovedIds.size })}</button>
              <button type="button" className="btn-primary" disabled={!selectedApprovedIds.size || (approvedBoxes?.data || []).some((box: any) => selectedApprovedIds.has(box.id) && !box.apDecision)} onClick={() => setDisposalAction('complete')}>{t('admin.retention.disposal.complete', { count: selectedApprovedIds.size })}</button>
            </div>}
          </div>
          <p className="text-sm text-gray-500 mb-4">{t('admin.retention.disposal.approvedHint')}</p>
          {approvedError ? <p role="alert" className="text-sm text-red-700">{t('admin.retention.disposal.loadError')}</p> : <DataTable columns={reviewColumns} data={approvedBoxes?.data || []} isLoading={approvedLoading} emptyMessage={t('admin.retention.disposal.noApproved')} selectable={canCompleteDisposal} selectedIds={selectedApprovedIds} onSelectionChange={setSelectedApprovedIds} />}
          <Pagination page={approvedPage} limit={reviewLimit} total={approvedBoxes?.total || 0} onPageChange={(page) => { setSelectedApprovedIds(new Set()); setApprovedPage(page); }} />
        </div>
      )}

      {activeTenantId && (canApproveDisposal || canCompleteDisposal) && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-1">{t('admin.retention.disposal.completedTitle')}</h2>
          <p className="text-sm text-gray-500 mb-4">{t('admin.retention.disposal.completedHint')}</p>
          {completedError ? <p role="alert" className="text-sm text-red-700">{t('admin.retention.disposal.loadError')}</p> : <DataTable columns={completedColumns} data={completedDisposals?.data || []} isLoading={completedLoading} emptyMessage={t('admin.retention.disposal.noCompleted')} />}
          <Pagination page={completedPage} limit={reviewLimit} total={completedDisposals?.total || 0} onPageChange={setCompletedPage} />
        </div>
      )}

      {/* Upcoming retention dates */}
      {activeTenantId && canInitiateDisposal && (
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle size={20} className="text-orange-500" />
              {t('admin.retention.boxesReview')}
            </h2>
            <select value={reviewDays} onChange={(e) => { setReviewDays(parseInt(e.target.value)); setUpcomingPage(1); }} className="input-field w-full sm:w-40" aria-label={t('admin.retention.boxesReview')}>
              <option value="30">{t('admin.retention.next30')}</option>
              <option value="90">{t('admin.retention.next90')}</option>
              <option value="180">{t('admin.retention.next6m')}</option>
              <option value="365">{t('admin.retention.nextYear')}</option>
            </select>
          </div>
          {upcomingError ? <p role="alert" className="text-sm text-red-700">{t('admin.retention.disposal.loadError')}</p> : <DataTable columns={reviewColumns} data={upcomingBoxes?.data || []} isLoading={upcomingLoading} emptyMessage={t('admin.retention.noBoxesInPeriod')} />}
          <Pagination page={upcomingPage} limit={reviewLimit} total={upcomingBoxes?.total || 0} onPageChange={setUpcomingPage} />
        </div>
      )}

      <Modal isOpen={showDisposalProposal} onClose={() => setShowDisposalProposal(false)} title={t('admin.retention.disposal.proposalTitle')} size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">{t('admin.retention.disposal.proposalHint', { count: selectedDueIds.size })}</p>
          <div>
            <label htmlFor="disposal-proposal-notes" className="label-text">{t('admin.retention.disposal.notes')}</label>
            <textarea id="disposal-proposal-notes" value={proposalNotes} onChange={(e) => setProposalNotes(e.target.value)} className="input-field" rows={3} maxLength={1000} />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button type="button" onClick={() => setShowDisposalProposal(false)} className="btn-secondary">{t('common.cancel')}</button>
            <button type="button" onClick={handleDisposalProposal} disabled={!selectedDueIds.size || proposalSubmitting} className="btn-primary">
              {proposalSubmitting ? t('common.processing') : t('admin.retention.disposal.confirmProposal')}
            </button>
          </div>
        </div>
      </Modal>

      {disposalAction && <Modal isOpen onClose={() => setDisposalAction(null)} title={t(`admin.retention.disposal.${disposalAction}Title`)} size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">{t(`admin.retention.disposal.${disposalAction}Hint`, { count: ['complete', 'ap-decision'].includes(disposalAction) ? selectedApprovedIds.size : selectedPendingIds.size })}</p>
          {disposalAction === 'complete' ? <>
            <div>
              <label htmlFor="disposal-protocol" className="label-text">{t('admin.retention.disposal.protocolReference')} *</label>
              <input id="disposal-protocol" className="input-field" value={protocolReference} onChange={(e) => setProtocolReference(e.target.value)} maxLength={200} />
            </div>
            <div>
              <label htmlFor="disposal-method" className="label-text">{t('admin.retention.disposal.methodDescription')}</label>
              <input id="disposal-method" className="input-field" value={methodDescription} onChange={(e) => setMethodDescription(e.target.value)} maxLength={200} />
            </div>
            <div>
              <label htmlFor="disposal-weight" className="label-text">{t('admin.retention.disposal.weightKg')}</label>
              <input id="disposal-weight" type="number" min="0.01" max="100000" step="any" className="input-field" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
            </div>
            <div>
              <label htmlFor="disposal-execution-note" className="label-text">{t('admin.retention.disposal.executionNote')}</label>
              <textarea id="disposal-execution-note" className="input-field" rows={2} maxLength={1000} value={executionNote} onChange={(e) => setExecutionNote(e.target.value)} />
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-1" checked={completionConfirmed} onChange={(e) => setCompletionConfirmed(e.target.checked)} />
              <span>{t('admin.retention.disposal.completionConfirmation')}</span>
            </label>
          </> : disposalAction === 'ap-decision' ? <div className="space-y-3">
            <label htmlFor="ap-decision" className="label-text">{t('admin.retention.disposal.apDecisionType')}</label>
            <select id="ap-decision" className="input-field" value={apDecision} onChange={(e) => setApDecision(e.target.value as 'consent_received' | 'not_required')}>
              <option value="consent_received">{t('admin.retention.disposal.apReceived')}</option>
              {canMarkApNotRequired && <option value="not_required">{t('admin.retention.disposal.apNotRequired')}</option>}
            </select>
            {apDecision === 'consent_received' ? <>
              <label htmlFor="ap-reference" className="label-text">{t('admin.retention.disposal.apReference')} *</label>
              <input id="ap-reference" className="input-field" value={apReference} onChange={(e) => setApReference(e.target.value)} maxLength={200} />
              <label htmlFor="ap-date" className="label-text">{t('admin.retention.disposal.apDate')} *</label>
              <input id="ap-date" type="date" max={today} className="input-field" value={apDate} onChange={(e) => setApDate(e.target.value)} />
            </> : <>
              <label htmlFor="disposal-decision-text" className="label-text">{t('admin.retention.disposal.apReason')} *</label>
              <textarea id="disposal-decision-text" className="input-field" value={decisionText} onChange={(e) => setDecisionText(e.target.value)} rows={3} maxLength={1000} />
            </>}
          </div> : <div>
            <label htmlFor="disposal-decision-text" className="label-text">{t(disposalAction === 'reject' ? 'admin.retention.disposal.rejectReason' : disposalAction === 'review' ? 'admin.retention.disposal.reviewNotes' : 'admin.retention.disposal.approvalNotes')}{disposalAction === 'reject' || disposalAction === 'review' ? ' *' : ''}</label>
            <textarea id="disposal-decision-text" className="input-field" value={decisionText} onChange={(e) => setDecisionText(e.target.value)} rows={3} maxLength={1000} />
          </div>}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setDisposalAction(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn-primary" onClick={handleDisposalDecision} disabled={decisionSubmitting || (['reject', 'review'].includes(disposalAction) && decisionText.trim().length < 5) || (disposalAction === 'ap-decision' && (apDecision === 'consent_received' ? apReference.trim().length < 3 || !apDate : decisionText.trim().length < 10)) || (disposalAction === 'complete' && (protocolReference.trim().length < 3 || !completionConfirmed))}>
              {decisionSubmitting ? t('common.processing') : t(`admin.retention.disposal.${disposalAction}Confirm`)}
            </button>
          </div>
        </div>
      </Modal>}

      <Modal isOpen={Boolean(evidenceBatchId)} onClose={() => { setEvidenceBatchId(null); setEvidenceFile(null); }} title={t('admin.retention.disposal.evidenceTitle')} size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{t('admin.retention.disposal.evidenceHint')}</p>
          {evidenceError && <p role="alert" className="text-sm text-red-700">{t('admin.retention.disposal.evidenceLoadError')}</p>}
          {evidenceLoading ? <p className="text-sm text-gray-500">{t('common.loading')}</p> : !evidenceError && evidence.length === 0 ? <p className="text-sm text-gray-500">{t('admin.retention.disposal.noEvidence')}</p> : (
            <ul className="space-y-2">
              {evidence.map((photo: any) => <li key={photo.id} className="rounded border border-gray-200 p-3 text-sm">
                <div className="font-medium break-all">{photo.fileName}</div>
                <div className="text-xs text-gray-500">{new Date(photo.uploadedAt).toLocaleString('pl-PL')} · SHA-256: <span className="font-mono break-all">{photo.checksumSha256}</span></div>
                <button type="button" className="btn-secondary mt-2 text-xs" disabled={downloadingEvidence === photo.id} onClick={() => downloadEvidence(photo.id, photo.fileName)}><Download size={14} />{t('admin.retention.disposal.downloadPhoto')}</button>
              </li>)}
            </ul>
          )}
          {canCompleteDisposal && !evidenceError && evidence.length < 5 && <div className="border-t border-gray-200 pt-4 space-y-3">
            <label htmlFor="disposal-evidence-file" className="label-text">{t('admin.retention.disposal.addEvidence')}</label>
            <input key={evidenceInputKey} id="disposal-evidence-file" type="file" accept="image/jpeg,image/png" className="input-field" onChange={(event) => setEvidenceFile(event.target.files?.[0] || null)} />
            <button type="button" className="btn-primary" disabled={!evidenceFile || uploadingEvidence} onClick={uploadEvidence}>{uploadingEvidence ? t('common.processing') : t('admin.retention.disposal.uploadEvidence')}</button>
          </div>}
        </div>
      </Modal>

      {/* Create Policy Modal */}
      <Modal isOpen={showCreatePolicy} onClose={() => setShowCreatePolicy(false)} title={t('admin.retention.createModal.title')} size="md">
        <form onSubmit={handleCreatePolicy} className="space-y-4">
          <div><label htmlFor="retention-create-name" className="label-text">{t('common.name')} *</label><input id="retention-create-name" name="name" className="input-field" required /></div>
          {canManageGlobalPolicies ? (
            <div>
              <label htmlFor="retention-create-scope" className="label-text">{t('admin.retention.scope')}</label>
              <select id="retention-create-scope" name="scope" className="input-field" defaultValue="global">
                <option value="global">{t('admin.retention.scopeGlobal')}</option>
                <option value="tenant">{t('admin.retention.scopeTenant')}</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">{t('admin.retention.scopeHint')}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              {t('admin.retention.tenantOnlyHint')}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="retention-create-docType" className="label-text">{t('admin.retention.createModal.docType')}</label>
              <select id="retention-create-docType" name="docType" className="input-field">
                <option value="">{t('common.all')}</option>
                {DOC_TYPES.map((dt) => (
                  <option key={dt} value={dt}>{t(`docTypes.${dt}`, { defaultValue: dt })}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="retention-create-period" className="label-text">{t('admin.retention.createModal.period')} *</label>
              <select id="retention-create-period" name="retentionYears" className="input-field" required defaultValue="10">
                {RETENTION_YEAR_OPTIONS.map((years) => (
                  <option key={years} value={years}>{formatRetentionYears(years)}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="retention-create-trigger" className="label-text">{t('admin.retention.createModal.trigger')}</label>
            <select id="retention-create-trigger" name="retentionTrigger" className="input-field">
              <option value="end_date">{t('admin.retention.createModal.triggerEndDate')}</option>
              <option value="creation_date">{t('admin.retention.createModal.triggerCreationDate')}</option>
            </select>
          </div>
          <div><label htmlFor="retention-create-description" className="label-text">{t('admin.retention.createModal.description')}</label><textarea id="retention-create-description" name="description" className="input-field" rows={3} /></div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowCreatePolicy(false)} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={createPolicy.isPending} className="btn-primary">{createPolicy.isPending ? t('common.creating') : t('common.create')}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showJrwaImport} onClose={closeJrwaImport} title={t('admin.retention.jrwaImport.title')} size="xl">
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="jrwa-tenant" className="label-text">{t('admin.retention.jrwaImport.tenant')} *</label>
              <select
                id="jrwa-tenant"
                value={jrwaTenantId}
                onChange={(e) => { setJrwaTenantId(e.target.value); setJrwaPreview(null); }}
                className="input-field"
                required
              >
                <option value="">{t('admin.retention.jrwaImport.selectTenant')}</option>
                {tenants.map((tenant: any) => (
                  <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.shortCode})</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="jrwa-file" className="label-text">{t('admin.retention.jrwaImport.file')} *</label>
              <input
                id="jrwa-file"
                type="file"
                accept=".docx"
                onChange={(e) => { setJrwaFile(e.target.files?.[0] || null); setJrwaPreview(null); }}
                className="input-field"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="jrwa-label" className="label-text">{t('admin.retention.jrwaImport.versionLabel')} *</label>
              <input id="jrwa-label" className="input-field" value={jrwaLabel} onChange={(e) => { setJrwaLabel(e.target.value); setJrwaPreview(null); }} maxLength={120} required />
            </div>
            <div>
              <label htmlFor="jrwa-valid-from" className="label-text">{t('admin.retention.jrwaImport.validFrom')} *</label>
              <input id="jrwa-valid-from" type="date" className="input-field" value={jrwaValidFrom} onChange={(e) => { setJrwaValidFrom(e.target.value); setJrwaPreview(null); }} required />
            </div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            {t('admin.retention.jrwaImport.hint')}
          </div>

          {!jrwaPreview ? (
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeJrwaImport} className="btn-secondary">{t('common.cancel')}</button>
              <button
                type="button"
                onClick={handleJrwaPreview}
                disabled={jrwaLoading || !jrwaFile || !jrwaTenantId || !jrwaLabel.trim() || !jrwaValidFrom}
                className="btn-primary"
              >
                {jrwaLoading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                {t('admin.retention.jrwaImport.preview')}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-green-50 p-3"><div className="text-2xl font-bold text-green-700">{jrwaPreview.summary.valid}</div><div className="text-xs text-green-700">{t('admin.retention.jrwaImport.valid')}</div></div>
                <div className="rounded-lg bg-purple-50 p-3"><div className="text-2xl font-bold text-purple-700">{jrwaPreview.summary.permanent}</div><div className="text-xs text-purple-700">{t('admin.retention.jrwaImport.permanent')}</div></div>
                <div className="rounded-lg bg-amber-50 p-3"><div className="text-2xl font-bold text-amber-700">{jrwaPreview.summary.review}</div><div className="text-xs text-amber-700">{t('admin.retention.jrwaImport.review')}</div></div>
                <div className="rounded-lg bg-gray-50 p-3"><div className="text-2xl font-bold text-gray-700">{jrwaPreview.summary.skipped}</div><div className="text-xs text-gray-700">{t('admin.retention.jrwaImport.skipped')}</div></div>
              </div>

              <div className="max-h-80 overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">{t('admin.retention.jrwaCode')}</th>
                      <th className="px-3 py-2 text-left">{t('common.name')}</th>
                      <th className="px-3 py-2 text-left">{t('admin.retention.createModal.docType')}</th>
                      <th className="px-3 py-2 text-left">{t('admin.retention.archivalCategory')}</th>
                      <th className="px-3 py-2 text-left">{t('admin.retention.createModal.period')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {jrwaPreview.rows.map((row: any) => (
                      <tr key={`${row.jrwaCode}-${row.rowNumber}`}>
                        <td className="px-3 py-2 font-mono font-medium">{row.jrwaCode}</td>
                        <td className="px-3 py-2">{row.name}</td>
                        <td className="px-3 py-2">{t(`docTypes.${row.docType}`, { defaultValue: row.docType })}</td>
                        <td className="px-3 py-2 font-medium">{row.archivalCategory}</td>
                        <td className="px-3 py-2">{formatRetentionYears(row.retentionYears, row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
                <button type="button" onClick={() => setJrwaPreview(null)} className="btn-secondary">{t('common.back')}</button>
                <button type="button" onClick={handleJrwaImport} disabled={jrwaImporting} className="btn-primary">
                  {jrwaImporting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {t('admin.retention.jrwaImport.submit', { count: jrwaPreview.summary.valid })}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
