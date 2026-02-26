import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useList, useCreate } from '@/hooks/useApi';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import DataTable, { Column } from '@/components/ui/DataTable';
import Pagination from '@/components/ui/Pagination';
import Modal from '@/components/ui/Modal';
import { Plus, UserCheck, UserX, Shield } from 'lucide-react';

export default function UsersPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState({ search: '', isActive: '' });

  const debouncedSearch = useDebouncedValue(filters.search, 300);

  const { data, isLoading } = useList('users', '/users', { page, limit: 20, search: debouncedSearch, isActive: filters.isActive });
  const createUser = useCreate('/users', ['users'], t('admin.users.created'));

  const columns: Column<any>[] = [
    {
      key: 'name',
      header: t('admin.users.colUser'),
      render: (item) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
            <span className="text-xs font-medium">{item.firstName?.[0]}{item.lastName?.[0]}</span>
          </div>
          <div>
            <div className="font-medium">{item.firstName} {item.lastName}</div>
            <div className="text-xs text-gray-500">{item.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'roles',
      header: t('admin.users.colRoles'),
      render: (item) => (
        <div className="flex gap-1 flex-wrap">
          {item.userRoles?.map((ur: any) => (
            <span key={ur.role.id} className="badge-blue text-xs">{ur.role.code}</span>
          ))}
        </div>
      ),
    },
    {
      key: 'tenant',
      header: t('admin.users.colTenant'),
      render: (item) => item.tenant?.name || <span className="text-gray-400 italic">{t('admin.users.globalSA')}</span>,
    },
    {
      key: 'isActive',
      header: t('admin.users.colStatus'),
      render: (item) => item.isActive ? (
        <span className="badge-green flex items-center gap-1 w-fit"><UserCheck size={12} /> {t('admin.users.statusActive')}</span>
      ) : (
        <span className="badge-red flex items-center gap-1 w-fit"><UserX size={12} /> {t('admin.users.statusInactive')}</span>
      ),
    },
    {
      key: 'mfaEnabled',
      header: t('admin.users.col2fa'),
      render: (item) => item.mfaEnabled ? <Shield size={16} className="text-green-500" /> : <span className="text-gray-300">—</span>,
    },
    {
      key: 'lastLoginAt',
      header: t('admin.users.lastLogin'),
      render: (item) => item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString('pl-PL') : '—',
    },
  ];

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createUser.mutateAsync({
      email: fd.get('email'),
      password: fd.get('password'),
      firstName: fd.get('firstName'),
      lastName: fd.get('lastName'),
      phone: fd.get('phone') || undefined,
      tenantId: fd.get('tenantId') || undefined,
    });
    setShowCreate(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('admin.users.title')}</h1>
          <p className="text-sm text-gray-500">{t('admin.users.subtitle')}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> {t('admin.users.new')}
        </button>
      </div>

      <div className="card">
        <div className="flex items-center gap-4">
          <input type="text" placeholder={t('admin.users.searchPlaceholder')} value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="input-field flex-1" aria-label={t('admin.users.searchPlaceholder')} />
          <select value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value })} className="input-field w-36" aria-label={t('common.all')}>
            <option value="">{t('common.all')}</option>
            <option value="true">{t('admin.users.active')}</option>
            <option value="false">{t('admin.users.inactive')}</option>
          </select>
        </div>
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={data?.data || []} isLoading={isLoading} emptyMessage={t('admin.users.empty')} />
        {data?.meta && <div className="px-4 pb-4"><Pagination page={page} limit={20} total={data.meta.total} onPageChange={setPage} /></div>}
      </div>

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title={t('admin.users.createModal.title')} size="md">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label htmlFor="user-create-firstName" className="label-text">{t('admin.users.createModal.firstName')}</label><input id="user-create-firstName" name="firstName" className="input-field" required /></div>
            <div><label htmlFor="user-create-lastName" className="label-text">{t('admin.users.createModal.lastName')}</label><input id="user-create-lastName" name="lastName" className="input-field" required /></div>
          </div>
          <div><label htmlFor="user-create-email" className="label-text">{t('admin.users.createModal.email')}</label><input id="user-create-email" name="email" type="email" className="input-field" required /></div>
          <div><label htmlFor="user-create-password" className="label-text">{t('admin.users.createModal.password')}</label><input id="user-create-password" name="password" type="password" className="input-field" required minLength={12} /></div>
          <div><label htmlFor="user-create-phone" className="label-text">{t('admin.users.createModal.phone')}</label><input id="user-create-phone" name="phone" className="input-field" /></div>
          <div><label htmlFor="user-create-tenantId" className="label-text">{t('admin.users.createModal.tenantId')}</label><input id="user-create-tenantId" name="tenantId" className="input-field" placeholder={t('admin.users.createModal.tenantIdPlaceholder')} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={createUser.isPending} className="btn-primary">{createUser.isPending ? t('common.creating') : t('admin.users.createModal.submit')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
