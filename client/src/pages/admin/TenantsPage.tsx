import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useList, useCreate } from '@/hooks/useApi';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import DataTable, { Column } from '@/components/ui/DataTable';
import Pagination from '@/components/ui/Pagination';
import Modal from '@/components/ui/Modal';
import api from '@/services/api';
import toast from 'react-hot-toast';
import { getApiErrorMessage } from '@/utils/apiError';
import { Plus, Building2, Loader2 } from 'lucide-react';

interface TenantFormState {
  name: string;
  shortCode: string;
  nip: string;
  address: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  regon: string;
}

const emptyTenantForm: TenantFormState = {
  name: '',
  shortCode: '',
  nip: '',
  address: '',
  contactPerson: '',
  contactEmail: '',
  contactPhone: '',
  regon: '',
};

export default function TenantsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [tenantForm, setTenantForm] = useState<TenantFormState>(emptyTenantForm);
  const [gusLoading, setGusLoading] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading } = useList('tenants', '/tenants', { page, limit: 20, search: debouncedSearch });
  const createTenant = useCreate('/tenants', ['tenants'], t('admin.tenants.created'));

  const setTenantField = (field: keyof TenantFormState, value: string) => {
    setTenantForm(prev => ({ ...prev, [field]: value }));
  };

  const columns: Column<any>[] = [
    {
      key: 'name',
      header: t('admin.tenants.colName'),
      render: (item) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary-50 rounded-lg flex items-center justify-center">
            <Building2 size={16} className="text-primary-600" />
          </div>
          <div>
            <div className="font-medium">{item.name}</div>
            <div className="text-xs text-gray-500 font-mono">{item.shortCode}</div>
          </div>
        </div>
      ),
    },
    { key: 'nip', header: t('admin.tenants.colNip'), render: (item) => item.nip || '—' },
    { key: 'contactPerson', header: t('admin.tenants.colContact'), render: (item) => item.contactPerson || '—' },
    { key: 'contactEmail', header: t('common.email'), render: (item) => item.contactEmail || '—' },
    {
      key: 'isActive',
      header: t('common.status'),
      render: (item) => item.isActive ? <span className="badge-green">{t('common.active')}</span> : <span className="badge-red">{t('common.inactive')}</span>,
    },
    { key: 'boxes', header: t('admin.tenants.colBoxes'), render: (item) => item._count?.boxes ?? 0 },
    { key: 'users', header: t('admin.tenants.colUsers'), render: (item) => item._count?.users ?? 0 },
    { key: 'hrFolders', header: t('admin.tenants.colHr'), render: (item) => item._count?.hrFolders ?? 0 },
  ];

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await createTenant.mutateAsync({
      name: tenantForm.name,
      shortCode: tenantForm.shortCode,
      nip: tenantForm.nip || undefined,
      address: tenantForm.address || undefined,
      contactPerson: tenantForm.contactPerson || undefined,
      contactEmail: tenantForm.contactEmail || undefined,
      contactPhone: tenantForm.contactPhone || undefined,
      configJson: tenantForm.regon ? { gus: { regon: tenantForm.regon } } : undefined,
    });
    setShowCreate(false);
    setTenantForm(emptyTenantForm);
  };

  const handleCloseCreate = () => {
    setShowCreate(false);
    setTenantForm(emptyTenantForm);
  };

  const handleFetchGus = async () => {
    const nip = tenantForm.nip.replace(/\D/g, '');
    if (nip.length !== 10) {
      toast.error(t('admin.tenants.gus.invalidNip'));
      return;
    }

    setGusLoading(true);
    try {
      const { data } = await api.get(`/tenants/gus/${nip}`);
      const gus = data.data;
      setTenantForm(prev => ({
        ...prev,
        name: gus.name || prev.name,
        nip: gus.nip || nip,
        address: gus.address || prev.address,
        regon: gus.regon || prev.regon,
      }));
      toast.success(t('admin.tenants.gus.loaded'));
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('admin.tenants.gus.error')));
    } finally {
      setGusLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('admin.tenants.title')}</h1>
          <p className="text-sm text-gray-500">{t('admin.tenants.subtitle')}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary w-full sm:w-auto"><Plus size={16} /> {t('admin.tenants.new')}</button>
      </div>

      <div className="card">
        <input type="text" placeholder={t('admin.tenants.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="input-field" aria-label={t('admin.tenants.searchPlaceholder')} />
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={data?.data || []} isLoading={isLoading} emptyMessage={t('common.noData')} />
        {data?.meta && <div className="px-4 pb-4"><Pagination page={page} limit={20} total={data.meta.total} onPageChange={setPage} /></div>}
      </div>

      <Modal isOpen={showCreate} onClose={handleCloseCreate} title={t('admin.tenants.createModal.title')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label htmlFor="tenant-create-name" className="label-text">{t('admin.tenants.createModal.name')}</label><input id="tenant-create-name" name="name" value={tenantForm.name} onChange={(e) => setTenantField('name', e.target.value)} className="input-field" required /></div>
            <div><label htmlFor="tenant-create-shortCode" className="label-text">{t('admin.tenants.createModal.shortCode')}</label><input id="tenant-create-shortCode" name="shortCode" value={tenantForm.shortCode} onChange={(e) => setTenantField('shortCode', e.target.value.toUpperCase())} className="input-field font-mono uppercase" required maxLength={6} minLength={3} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="tenant-create-nip" className="label-text">{t('admin.tenants.colNip')}</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input id="tenant-create-nip" name="nip" value={tenantForm.nip} onChange={(e) => setTenantField('nip', e.target.value)} className="input-field" />
                <button type="button" onClick={handleFetchGus} disabled={gusLoading || tenantForm.nip.replace(/\D/g, '').length !== 10} className="btn-secondary whitespace-nowrap">
                  {gusLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                  {t('admin.tenants.gus.fetch')}
                </button>
              </div>
              {tenantForm.regon && <p className="mt-1 text-xs text-gray-500">REGON: {tenantForm.regon}</p>}
            </div>
            <div><label htmlFor="tenant-create-contactPerson" className="label-text">{t('admin.tenants.createModal.contactPerson')}</label><input id="tenant-create-contactPerson" name="contactPerson" value={tenantForm.contactPerson} onChange={(e) => setTenantField('contactPerson', e.target.value)} className="input-field" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label htmlFor="tenant-create-contactEmail" className="label-text">{t('admin.tenants.createModal.contactEmail')}</label><input id="tenant-create-contactEmail" name="contactEmail" type="email" value={tenantForm.contactEmail} onChange={(e) => setTenantField('contactEmail', e.target.value)} className="input-field" /></div>
            <div><label htmlFor="tenant-create-phone" className="label-text">{t('admin.tenants.createModal.phone')}</label><input id="tenant-create-phone" name="contactPhone" value={tenantForm.contactPhone} onChange={(e) => setTenantField('contactPhone', e.target.value)} className="input-field" /></div>
          </div>
          <div><label htmlFor="tenant-create-address" className="label-text">{t('admin.tenants.createModal.address')}</label><textarea id="tenant-create-address" name="address" value={tenantForm.address} onChange={(e) => setTenantField('address', e.target.value)} className="input-field" rows={3} /></div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={handleCloseCreate} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={createTenant.isPending} className="btn-primary">{createTenant.isPending ? t('common.creating') : t('common.create')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
