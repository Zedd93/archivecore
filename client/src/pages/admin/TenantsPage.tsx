import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useList, useCreate } from '@/hooks/useApi';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import DataTable, { Column } from '@/components/ui/DataTable';
import Pagination from '@/components/ui/Pagination';
import Modal from '@/components/ui/Modal';
import { Plus, Building2 } from 'lucide-react';

export default function TenantsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');

  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading } = useList('tenants', '/tenants', { page, limit: 20, search: debouncedSearch });
  const createTenant = useCreate('/tenants', ['tenants'], t('admin.tenants.created'));

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
    const fd = new FormData(e.currentTarget);
    await createTenant.mutateAsync({
      name: fd.get('name'),
      shortCode: fd.get('shortCode'),
      nip: fd.get('nip') || undefined,
      address: fd.get('address') || undefined,
      contactPerson: fd.get('contactPerson') || undefined,
      contactEmail: fd.get('contactEmail') || undefined,
      contactPhone: fd.get('contactPhone') || undefined,
    });
    setShowCreate(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('admin.tenants.title')}</h1>
          <p className="text-sm text-gray-500">{t('admin.tenants.subtitle')}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2"><Plus size={16} /> {t('admin.tenants.new')}</button>
      </div>

      <div className="card">
        <input type="text" placeholder={t('admin.tenants.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="input-field" aria-label={t('admin.tenants.searchPlaceholder')} />
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={data?.data || []} isLoading={isLoading} emptyMessage={t('common.noData')} />
        {data?.meta && <div className="px-4 pb-4"><Pagination page={page} limit={20} total={data.meta.total} onPageChange={setPage} /></div>}
      </div>

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title={t('admin.tenants.createModal.title')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label htmlFor="tenant-create-name" className="label-text">{t('admin.tenants.createModal.name')}</label><input id="tenant-create-name" name="name" className="input-field" required /></div>
            <div><label htmlFor="tenant-create-shortCode" className="label-text">{t('admin.tenants.createModal.shortCode')}</label><input id="tenant-create-shortCode" name="shortCode" className="input-field font-mono uppercase" required maxLength={6} minLength={3} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label htmlFor="tenant-create-nip" className="label-text">{t('admin.tenants.colNip')}</label><input id="tenant-create-nip" name="nip" className="input-field" /></div>
            <div><label htmlFor="tenant-create-contactPerson" className="label-text">{t('admin.tenants.createModal.contactPerson')}</label><input id="tenant-create-contactPerson" name="contactPerson" className="input-field" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label htmlFor="tenant-create-contactEmail" className="label-text">{t('admin.tenants.createModal.contactEmail')}</label><input id="tenant-create-contactEmail" name="contactEmail" type="email" className="input-field" /></div>
            <div><label htmlFor="tenant-create-phone" className="label-text">{t('admin.tenants.createModal.phone')}</label><input id="tenant-create-phone" name="contactPhone" className="input-field" /></div>
          </div>
          <div><label htmlFor="tenant-create-address" className="label-text">{t('admin.tenants.createModal.address')}</label><textarea id="tenant-create-address" name="address" className="input-field" rows={2} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={createTenant.isPending} className="btn-primary">{createTenant.isPending ? t('common.creating') : t('common.create')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
