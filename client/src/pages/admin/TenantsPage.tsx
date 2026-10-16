import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useList, useCreate } from '@/hooks/useApi';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import DataTable, { Column } from '@/components/ui/DataTable';
import Pagination from '@/components/ui/Pagination';
import Modal from '@/components/ui/Modal';
import api from '@/services/api';
import toast from 'react-hot-toast';
import { getApiErrorMessage } from '@/utils/apiError';
import { useConfirm } from '@/hooks/useConfirm';
import { Plus, Building2, Loader2, Clock3 } from 'lucide-react';

interface SlaPolicy {
  orderType: string;
  priority: string;
  hours: number | '';
  isCustom?: boolean;
}

const SLA_ORDER_TYPES = [
  { code: 'checkout', labelKey: 'orders.typeIssue' },
  { code: 'return_order', labelKey: 'orders.typeReturn' },
  { code: 'transfer', labelKey: 'orders.typeTransfer' },
  { code: 'disposal', labelKey: 'orders.typeDestruction' },
  { code: 'scan', labelKey: 'orders.typeScan' },
] as const;

const SLA_PRIORITIES = ['normal', 'high', 'urgent'] as const;

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
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [tenantForm, setTenantForm] = useState<TenantFormState>(emptyTenantForm);
  const [gusLoading, setGusLoading] = useState(false);
  const [slaTenant, setSlaTenant] = useState<{ id: string; name: string } | null>(null);
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicy[]>([]);
  const [slaTargetPercent, setSlaTargetPercent] = useState<number | ''>(95);
  const [slaLoading, setSlaLoading] = useState(false);
  const [slaSaving, setSlaSaving] = useState(false);
  const slaRequest = useRef(0);
  const { confirm, ConfirmDialogElement } = useConfirm();

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
    { key: 'sla', header: 'SLA', render: (item) => (
      <button type="button" className="btn-secondary flex items-center gap-1" onClick={() => { void openSla(item); }}>
        <Clock3 size={16} />{t('admin.tenants.sla.configure')}
      </button>
    ) },
  ];

  const openSla = async (tenant: { id: string; name: string; slaTargetPercent?: number }) => {
    const request = ++slaRequest.current;
    setSlaTenant(tenant);
    setSlaPolicies([]);
    setSlaTargetPercent(tenant.slaTargetPercent ?? 95);
    setSlaLoading(true);
    try {
      const { data } = await api.get(`/tenants/${tenant.id}/sla`);
      if (request === slaRequest.current) setSlaPolicies(data.data);
    } catch (error) {
      if (request === slaRequest.current) {
        toast.error(getApiErrorMessage(error, t('admin.tenants.sla.loadError')));
        setSlaTenant(null);
      }
    } finally {
      if (request === slaRequest.current) setSlaLoading(false);
    }
  };

  const closeSla = () => {
    if (slaSaving) return;
    slaRequest.current++;
    setSlaTenant(null);
  };

  const saveSla = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!slaTenant || slaPolicies.length !== 15 || slaSaving) return;
    setSlaSaving(true);
    try {
      await api.put(`/tenants/${slaTenant.id}/sla`, {
        policies: slaPolicies.map(({ orderType, priority, hours }) => ({ orderType, priority, hours: Number(hours) })),
      });
      toast.success(t('admin.tenants.sla.saved'));
      slaRequest.current++;
      setSlaTenant(null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('admin.tenants.sla.saveError')));
    } finally {
      setSlaSaving(false);
    }
  };

  const saveSlaTarget = async () => {
    if (!slaTenant || slaTargetPercent === '' || slaTargetPercent < 1 || slaTargetPercent > 100 || !Number.isInteger(slaTargetPercent) || slaSaving) return;
    setSlaSaving(true);
    try {
      await api.put(`/tenants/${slaTenant.id}/sla-target`, { slaTargetPercent });
      await queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast.success(t('admin.tenants.sla.targetSaved'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('admin.tenants.sla.saveError')));
    } finally {
      setSlaSaving(false);
    }
  };

  const resetSla = async () => {
    if (!slaTenant || slaSaving) return;
    const tenantId = slaTenant.id;
    const request = slaRequest.current;
    const accepted = await confirm({
      title: t('admin.tenants.sla.resetTitle'),
      message: t('admin.tenants.sla.resetConfirm'),
      confirmLabel: t('admin.tenants.sla.reset'),
      variant: 'warning',
    });
    if (!accepted || request !== slaRequest.current) return;
    setSlaSaving(true);
    try {
      const { data } = await api.delete(`/tenants/${tenantId}/sla`);
      setSlaPolicies(data.data);
      toast.success(t('admin.tenants.sla.resetDone'));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('admin.tenants.sla.saveError')));
    } finally {
      setSlaSaving(false);
    }
  };

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

      <Modal isOpen={Boolean(slaTenant)} onClose={closeSla} title={t('admin.tenants.sla.title', { name: slaTenant?.name })} size="xl">
        {slaLoading ? <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div> : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-3">
              <div>
                <label htmlFor="tenant-sla-target" className="label-text">{t('admin.tenants.sla.target')}</label>
                <input id="tenant-sla-target" type="number" min={1} max={100} step={1} disabled={slaSaving} value={slaTargetPercent} onChange={(event) => setSlaTargetPercent(event.target.value === '' ? '' : Number(event.target.value))} className="input-field w-28" />
                <p className="mt-1 text-xs text-gray-500">{t('admin.tenants.sla.targetHint')}</p>
              </div>
              <button type="button" className="btn-secondary" disabled={slaSaving || slaTargetPercent === '' || slaTargetPercent < 1 || slaTargetPercent > 100 || !Number.isInteger(slaTargetPercent)} onClick={() => { void saveSlaTarget(); }}>{t('admin.tenants.sla.saveTarget')}</button>
            </div>
            <form onSubmit={saveSla} className="space-y-4">
              <p className="text-sm text-gray-600">{t('admin.tenants.sla.description')}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[580px] text-sm">
                <thead><tr className="border-b text-left"><th className="py-2 pr-3">{t('admin.tenants.sla.orderType')}</th>{SLA_PRIORITIES.map((priority) => <th key={priority} className="py-2 px-2">{t(`admin.tenants.sla.${priority}`)}</th>)}</tr></thead>
                <tbody>{SLA_ORDER_TYPES.map(({ code, labelKey }) => <tr key={code} className="border-b border-gray-100">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">{t(labelKey)}</th>
                  {SLA_PRIORITIES.map((priority) => {
                    const policy = slaPolicies.find((entry) => entry.orderType === code && entry.priority === priority);
                    return <td key={priority} className="py-2 px-2"><input
                      type="number" min={1} max={240} step={1} required
                      aria-label={`${t(labelKey)} - ${t(`admin.tenants.sla.${priority}`)}`}
                      value={policy?.hours ?? ''}
                      onChange={(event) => setSlaPolicies((current) => current.map((entry) => entry.orderType === code && entry.priority === priority ? { ...entry, hours: event.target.value === '' ? '' : Number(event.target.value) } : entry))}
                      className="input-field w-24"
                    /></td>;
                  })}
                </tr>)}</tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500">{t('admin.tenants.sla.rangeHint')}</p>
              <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
                <button type="button" className="btn-secondary" disabled={slaSaving} onClick={() => { void resetSla(); }}>{t('admin.tenants.sla.reset')}</button>
                <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={closeSla} disabled={slaSaving}>{t('common.cancel')}</button><button type="submit" className="btn-primary" disabled={slaSaving || slaPolicies.length !== 15 || slaPolicies.some((policy) => policy.hours === '')}>{slaSaving ? t('common.saving') : t('admin.tenants.sla.saveDurations')}</button></div>
              </div>
            </form>
          </div>
        )}
      </Modal>
      {ConfirmDialogElement}
    </div>
  );
}
