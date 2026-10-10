import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useList, useCreate } from '@/hooks/useApi';
import { useExport } from '@/hooks/useExport';
import { createHRFolderSchema } from '@archivecore/shared';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import DataTable, { Column } from '@/components/ui/DataTable';
import Pagination from '@/components/ui/Pagination';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import BoxPicker from '@/components/ui/BoxPicker';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/services/api';
import { Plus, ShieldAlert, Download, Loader2 } from 'lucide-react';

type SelectedBox = {
  id: string;
  boxNumber: string;
  title?: string;
  location?: { fullPath?: string | null } | null;
};

const emptyCreateForm = {
  tenantId: '',
  firstName: '',
  lastName: '',
  pesel: '',
  idNumber: '',
  department: '',
  position: '',
  employmentStart: '',
  employmentEnd: '',
  employmentStatus: 'active',
  riaStatus: 'unknown',
  riaSubmittedAt: '',
  retentionReviewRequired: false,
  storageForm: 'paper',
};

export default function HRListPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState({ search: '', employmentStatus: '', department: '', retentionBasis: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [createForm, setCreateForm] = useState({ ...emptyCreateForm, tenantId: localStorage.getItem('tenantId') || '' });
  const [selectedBoxes, setSelectedBoxes] = useState<SelectedBox[]>([]);
  const canSelectTenant = !user?.tenantId && (hasPermission('tenant.manage') || hasPermission('tenant.switch'));
  const startYear = Number(createForm.employmentStart.slice(0, 4));
  const isTransitional = startYear >= 1999 && startYear < 2019;

  const { data, isLoading } = useList('hr', '/hr', { page, limit: 20, ...filters });
  const createHR = useCreate('/hr', ['hr'], t('common.success'));
  const { exportData, isExporting } = useExport({ endpoint: '/export/hr', defaultFilename: 'akta_osobowe.xlsx' });
  const { data: tenants } = useQuery({
    queryKey: ['hr-tenant-options'],
    queryFn: async () => {
      const { data } = await api.get('/tenants', { params: { page: 1, limit: 100 } });
      return data.data as Array<{ id: string; name: string; shortCode: string }>;
    },
    enabled: canSelectTenant && showCreate,
  });

  const columns: Column<any>[] = [
    {
      key: 'employee',
      header: t('hr.employee'),
      render: (item) => (
        <div>
          <div className="font-medium">{item.employeeLastName} {item.employeeFirstName}</div>
          <div className="text-xs text-gray-500">{item.employeeIdNumber || '—'}</div>
        </div>
      ),
    },
    {
      key: 'employmentStatus',
      header: t('hr.status'),
      render: (item) => <StatusBadge status={item.employmentStatus} type="employment" />,
    },
    { key: 'department', header: t('hr.createModal.department'), render: (item) => item.department || '—' },
    { key: 'position', header: t('hr.createModal.position'), render: (item) => item.position || '—' },
    {
      key: 'retentionPeriod',
      header: t('hr.retention'),
      render: (item) => item.retentionBasis === 'needs_review'
        ? <span className="badge-yellow">{t('hr.needsReview')}</span>
        : item.retentionPeriod === 'fifty_years' ? t('hr.retention50') : t('hr.retention10'),
    },
    {
      key: 'storageForm',
      header: t('hr.form'),
      render: (item) => item.storageForm === 'digital' ? t('hr.formElectronic') : item.storageForm === 'hybrid' ? t('hr.formHybrid') : t('hr.formPaper'),
    },
    {
      key: 'litigationHold',
      header: '',
      render: (item) => item.litigationHold ? (
        <span className="flex items-center gap-1 text-red-600"><ShieldAlert size={14} /> {t('hr.legalHold')}</span>
      ) : null,
    },
    {
      key: '_count',
      header: t('hr.parts'),
      render: (item) => item._count?.parts ?? 5,
    },
    {
      key: 'box',
      header: t('hr.box'),
      render: (item) => item.box ? (
        <span className="text-xs font-mono text-primary-700">{item.box.boxNumber}</span>
      ) : '—',
    },
  ];

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormErrors({});
    if (canSelectTenant && !createForm.tenantId) {
      setFormErrors({ tenantId: t('locations.tenantPlaceholder') });
      return;
    }
    const payload = {
      employeeFirstName: createForm.firstName.trim(),
      employeeLastName: createForm.lastName.trim(),
      employeePesel: createForm.pesel.trim(),
      employeeIdNumber: createForm.idNumber.trim() || undefined,
      department: createForm.department.trim() || undefined,
      position: createForm.position.trim() || undefined,
      employmentStart: createForm.employmentStart || undefined,
      employmentEnd: createForm.employmentEnd || undefined,
      employmentStatus: createForm.employmentEnd ? 'terminated' : createForm.employmentStatus,
      riaStatus: isTransitional ? createForm.riaStatus : 'unknown',
      riaSubmittedAt: isTransitional && createForm.riaStatus === 'submitted' ? createForm.riaSubmittedAt || undefined : undefined,
      retentionReviewRequired: createForm.retentionReviewRequired,
      storageForm: createForm.storageForm,
      boxId: selectedBoxes[0]?.id || undefined,
    };
    const validation = createHRFolderSchema.safeParse(payload);

    if (!validation.success) {
      const nextErrors: Record<string, string> = {};
      validation.error.errors.forEach((err) => {
        const field = err.path[0]?.toString();
        if (field && !nextErrors[field]) nextErrors[field] = err.message;
      });
      setFormErrors(nextErrors);
      return;
    }

    const previousTenantId = localStorage.getItem('tenantId');
    if (canSelectTenant && createForm.tenantId) localStorage.setItem('tenantId', createForm.tenantId);
    if (canSelectTenant) {
      try {
        await createHR.mutateAsync(validation.data);
      } finally {
        if (previousTenantId) localStorage.setItem('tenantId', previousTenantId);
        else localStorage.removeItem('tenantId');
      }
    } else {
      await createHR.mutateAsync(validation.data);
    }
    setCreateForm({ ...emptyCreateForm, tenantId: localStorage.getItem('tenantId') || '' });
    setSelectedBoxes([]);
    setShowCreate(false);
  };

  const closeCreateModal = () => {
    setFormErrors({});
    setSelectedBoxes([]);
    setCreateForm({ ...emptyCreateForm, tenantId: localStorage.getItem('tenantId') || '' });
    setShowCreate(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('hr.title')}</h1>
          <p className="text-sm text-gray-500">{t('hr.subtitle')}</p>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          <button
            onClick={() => exportData({ format: 'xlsx', ...filters })}
            disabled={isExporting}
            className="btn-secondary flex-1 sm:flex-none"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            <span className="hidden sm:inline">{t('common.export')}</span>
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex-1 sm:flex-none">
            <Plus size={16} /> <span className="hidden sm:inline">{t('hr.newRecord')}</span>
          </button>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <input type="text" placeholder={t('hr.searchPlaceholder')} value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="input-field w-full sm:flex-1" aria-label={t('hr.searchPlaceholder')} />
          <select value={filters.employmentStatus} onChange={(e) => setFilters({ ...filters, employmentStatus: e.target.value })} className="input-field w-full sm:w-40" aria-label={t('hr.allStatuses')}>
            <option value="">{t('hr.allStatuses')}</option>
            <option value="active">{t('hr.statusEmployed')}</option>
            <option value="terminated">{t('hr.statusTerminated')}</option>
            <option value="retired">{t('hr.statusRetired')}</option>
          </select>
          <select value={filters.retentionBasis} onChange={(e) => { setPage(1); setFilters({ ...filters, retentionBasis: e.target.value }); }} className="input-field w-full sm:w-48" aria-label={t('hr.retentionFilter')}>
            <option value="">{t('hr.allRetention')}</option>
            <option value="needs_review">{t('hr.needsReview')}</option>
            <option value="verified">{t('hr.calculated')}</option>
          </select>
        </div>
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={data?.data || []} isLoading={isLoading} onRowClick={(item) => navigate(`/hr/${item.id}`)} emptyMessage={t('hr.empty')} />
        {data?.meta && <div className="px-4 pb-4"><Pagination page={page} limit={20} total={data.meta.total} onPageChange={setPage} /></div>}
      </div>

      <Modal isOpen={showCreate} onClose={closeCreateModal} title={t('hr.createModal.title')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4" noValidate>
          {canSelectTenant && (
            <div>
              <label htmlFor="hr-create-tenantId" className="label-text">{t('locations.tenant')} *</label>
              <select
                id="hr-create-tenantId"
                value={createForm.tenantId}
                onChange={(e) => {
                  setCreateForm({ ...createForm, tenantId: e.target.value });
                  setSelectedBoxes([]);
                }}
                className="input-field"
                required
              >
                <option value="">{t('locations.tenantPlaceholder')}</option>
                {tenants?.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.shortCode})</option>
                ))}
              </select>
              {formErrors.tenantId && <p className="text-xs text-red-600 mt-1">{formErrors.tenantId}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="hr-create-firstName" className="label-text">{t('hr.createModal.firstName')} *</label>
              <input id="hr-create-firstName" value={createForm.firstName} onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })} className="input-field" required aria-invalid={!!formErrors.employeeFirstName} />
              {formErrors.employeeFirstName && <p className="text-xs text-red-600 mt-1">{formErrors.employeeFirstName}</p>}
            </div>
            <div>
              <label htmlFor="hr-create-lastName" className="label-text">{t('hr.createModal.lastName')} *</label>
              <input id="hr-create-lastName" value={createForm.lastName} onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })} className="input-field" required aria-invalid={!!formErrors.employeeLastName} />
              {formErrors.employeeLastName && <p className="text-xs text-red-600 mt-1">{formErrors.employeeLastName}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="hr-create-pesel" className="label-text">{t('hr.createModal.pesel')} *</label>
              <input id="hr-create-pesel" value={createForm.pesel} onChange={(e) => setCreateForm({ ...createForm, pesel: e.target.value })} className="input-field font-mono" required maxLength={11} inputMode="numeric" pattern="\d{11}" placeholder="00000000000" aria-invalid={!!formErrors.employeePesel} />
              {formErrors.employeePesel && <p className="text-xs text-red-600 mt-1">{formErrors.employeePesel}</p>}
              <p className="text-xs text-gray-400 mt-1">{t('hr.createModal.peselEncrypted')}</p>
            </div>
            <div>
              <label htmlFor="hr-create-docNumber" className="label-text">{t('hr.createModal.docNumber')}</label>
              <input id="hr-create-docNumber" value={createForm.idNumber} onChange={(e) => setCreateForm({ ...createForm, idNumber: e.target.value })} className="input-field" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="hr-create-department" className="label-text">{t('hr.createModal.department')}</label>
              <input id="hr-create-department" value={createForm.department} onChange={(e) => setCreateForm({ ...createForm, department: e.target.value })} className="input-field" />
            </div>
            <div>
              <label htmlFor="hr-create-position" className="label-text">{t('hr.createModal.position')}</label>
              <input id="hr-create-position" value={createForm.position} onChange={(e) => setCreateForm({ ...createForm, position: e.target.value })} className="input-field" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="hr-create-hireDate" className="label-text">{t('hr.createModal.hireDate')}</label>
              <input id="hr-create-hireDate" type="date" value={createForm.employmentStart} onChange={(e) => {
                const year = Number(e.target.value.slice(0, 4));
                setCreateForm({ ...createForm, employmentStart: e.target.value, ...(year >= 1999 && year < 2019 ? {} : { riaStatus: 'unknown', riaSubmittedAt: '' }) });
              }} className="input-field" />
            </div>
            <div>
              <label htmlFor="hr-create-endDate" className="label-text">{t('hr.endDate')}</label>
              <input id="hr-create-endDate" type="date" value={createForm.employmentEnd} onChange={(e) => setCreateForm({ ...createForm, employmentEnd: e.target.value })} className="input-field" aria-invalid={!!formErrors.employmentEnd} />
              {formErrors.employmentEnd && <p className="text-xs text-red-600 mt-1">{formErrors.employmentEnd}</p>}
            </div>
            <div>
              <label htmlFor="hr-create-storageForm" className="label-text">{t('hr.storageForm')}</label>
              <select id="hr-create-storageForm" value={createForm.storageForm} onChange={(e) => setCreateForm({ ...createForm, storageForm: e.target.value })} className="input-field">
                <option value="paper">{t('hr.formPaper')}</option>
                <option value="digital">{t('hr.formElectronic')}</option>
                <option value="hybrid">{t('hr.formHybrid')}</option>
              </select>
            </div>
          </div>
          {isTransitional && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="hr-create-ria-status" className="label-text">{t('hr.riaStatus')}</label>
              <select id="hr-create-ria-status" value={createForm.riaStatus} onChange={(e) => setCreateForm({ ...createForm, riaStatus: e.target.value, riaSubmittedAt: '' })} className="input-field">
                <option value="unknown">{t('hr.riaUnknown')}</option>
                <option value="not_submitted">{t('hr.riaNotSubmitted')}</option>
                <option value="submitted">{t('hr.riaSubmitted')}</option>
              </select>
            </div>
            {createForm.riaStatus === 'submitted' && <div>
              <label htmlFor="hr-create-ria-date" className="label-text">{t('hr.riaSubmittedAt')} *</label>
              <input id="hr-create-ria-date" type="date" value={createForm.riaSubmittedAt} onChange={(e) => setCreateForm({ ...createForm, riaSubmittedAt: e.target.value })} className="input-field" aria-invalid={!!formErrors.riaSubmittedAt} />
              {formErrors.riaSubmittedAt && <p className="text-xs text-red-600 mt-1">{formErrors.riaSubmittedAt}</p>}
            </div>}
          </div>}
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={createForm.retentionReviewRequired} onChange={(e) => setCreateForm({ ...createForm, retentionReviewRequired: e.target.checked })} />
            <span>{t('hr.manualReviewRequired')}</span>
          </label>
          <p className="text-xs text-amber-700">{t('hr.retentionHint')}</p>
          <div>
            <label className="label-text">{t('hr.box')}</label>
            <BoxPicker
              value={selectedBoxes}
              onChange={setSelectedBoxes}
              maxSelected={1}
              tenantId={canSelectTenant ? createForm.tenantId : undefined}
              showLocation
              placeholder={t('orders.boxSearchPlaceholder')}
            />
            {selectedBoxes[0]?.location?.fullPath && (
              <p className="text-xs text-gray-500 mt-1">{t('boxes.location')}: {selectedBoxes[0].location.fullPath}</p>
            )}
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={closeCreateModal} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={createHR.isPending} className="btn-primary">
              {createHR.isPending ? t('common.creating') : t('common.create')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
