import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useCreate } from '@/hooks/useApi';
import { DOC_TYPES, Permissions } from '@archivecore/shared';
import { useAuth } from '@/contexts/AuthContext';
import { getApiErrorMessage } from '@/utils/apiError';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import toast from 'react-hot-toast';
import { Plus, Clock, AlertTriangle, Loader2, Upload, FileText, CheckCircle2 } from 'lucide-react';

const RETENTION_YEAR_OPTIONS = [1, 2, 5, 10, 25, 50, 75, 100] as const;

export default function RetentionPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [showCreatePolicy, setShowCreatePolicy] = useState(false);
  const [showJrwaImport, setShowJrwaImport] = useState(false);
  const [reviewDays, setReviewDays] = useState(90);
  const [policyTenantId, setPolicyTenantId] = useState(() => localStorage.getItem('tenantId') || '');
  const [jrwaTenantId, setJrwaTenantId] = useState('');
  const [jrwaFile, setJrwaFile] = useState<File | null>(null);
  const [jrwaPreview, setJrwaPreview] = useState<any>(null);
  const [jrwaLoading, setJrwaLoading] = useState(false);
  const [jrwaImporting, setJrwaImporting] = useState(false);
  const canManageGlobalPolicies = hasPermission(Permissions.SYSTEM_CONFIG);

  const { data: policies, isLoading: polLoading } = useQuery({
    queryKey: ['retention-policies', policyTenantId],
    queryFn: async () => {
      const { data } = await api.get('/retention/policies', {
        params: policyTenantId ? { tenantId: policyTenantId } : undefined,
      });
      return data.data;
    },
  });

  const { data: tenants = [] } = useQuery({
    queryKey: ['retention-tenants'],
    queryFn: async () => {
      const { data } = await api.get('/tenants', { params: { limit: 200, isActive: true } });
      return data.data || [];
    },
    enabled: canManageGlobalPolicies,
  });

  useEffect(() => {
    if (!jrwaTenantId && policyTenantId) setJrwaTenantId(policyTenantId);
  }, [jrwaTenantId, policyTenantId]);

  const { data: reviewBoxes, isLoading: revLoading } = useQuery({
    queryKey: ['retention-review', reviewDays],
    queryFn: async () => { const { data } = await api.get('/retention/review', { params: { days: reviewDays } }); return data.data; },
  });

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
      render: (item) => item.isActive ? <span className="badge-green">{t('admin.retention.statusActive')}</span> : <span className="badge-gray">{t('admin.retention.statusInactive')}</span>,
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
        const d = new Date(item.retentionDate);
        const isExpired = d < new Date();
        return <span className={isExpired ? 'text-red-600 font-medium' : ''}>{d.toLocaleDateString('pl-PL')}</span>;
      },
    },
    { key: 'retentionPolicy', header: t('admin.retention.policies'), render: (item) => item.retentionPolicy?.name || '—' },
    { key: 'status', header: t('common.status'), render: (item) => <StatusBadge status={item.status} type="box" /> },
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
    setJrwaPreview(null);
    setJrwaLoading(false);
    setJrwaImporting(false);
  };

  const closeJrwaImport = () => {
    setShowJrwaImport(false);
    resetJrwaImport();
  };

  const createJrwaFormData = () => {
    if (!jrwaFile || !jrwaTenantId) return null;
    const formData = new FormData();
    formData.append('file', jrwaFile);
    formData.append('tenantId', jrwaTenantId);
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
      await queryClient.invalidateQueries({ queryKey: ['retention-policies'] });
      closeJrwaImport();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('admin.retention.jrwaImport.importError')));
    } finally {
      setJrwaImporting(false);
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

      {/* Policies */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">{t('admin.retention.policies')}</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            {canManageGlobalPolicies && (
              <select
                value={policyTenantId}
                onChange={(e) => setPolicyTenantId(e.target.value)}
                className="input-field sm:w-64"
                aria-label={t('admin.retention.tenantFilter')}
              >
                <option value="">{t('admin.retention.globalOnly')}</option>
                {tenants.map((tenant: any) => (
                  <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
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
        <DataTable columns={policyColumns} data={policies || []} isLoading={polLoading} emptyMessage={t('admin.retention.noPolicies')} />
      </div>

      {/* Review */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <AlertTriangle size={20} className="text-orange-500" />
            {t('admin.retention.boxesReview')}
          </h2>
          <select value={reviewDays} onChange={(e) => setReviewDays(parseInt(e.target.value))} className="input-field w-40" aria-label={t('admin.retention.boxesReview')}>
            <option value="30">{t('admin.retention.next30')}</option>
            <option value="90">{t('admin.retention.next90')}</option>
            <option value="180">{t('admin.retention.next6m')}</option>
            <option value="365">{t('admin.retention.nextYear')}</option>
          </select>
        </div>
        {revLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={24} /></div>
        ) : (
          <DataTable columns={reviewColumns} data={reviewBoxes || []} emptyMessage={t('admin.retention.noBoxesInPeriod')} />
        )}
      </div>

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

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            {t('admin.retention.jrwaImport.hint')}
          </div>

          {!jrwaPreview ? (
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeJrwaImport} className="btn-secondary">{t('common.cancel')}</button>
              <button
                type="button"
                onClick={handleJrwaPreview}
                disabled={jrwaLoading || !jrwaFile || !jrwaTenantId}
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
