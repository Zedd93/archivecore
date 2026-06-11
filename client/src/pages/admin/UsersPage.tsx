import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useList, useCreate, usePatch } from '@/hooks/useApi';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import DataTable, { Column } from '@/components/ui/DataTable';
import Pagination from '@/components/ui/Pagination';
import Modal from '@/components/ui/Modal';
import { Plus, UserCheck, UserX, Shield } from 'lucide-react';
import { RoleCode, ROLE_LABELS } from '@archivecore/shared';
import { useAuth } from '@/contexts/AuthContext';

export default function UsersPage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState({ search: '', isActive: '' });
  const [roleCode, setRoleCode] = useState('');
  const [accessUser, setAccessUser] = useState<any | null>(null);
  const [accessRoleCode, setAccessRoleCode] = useState('');
  const [accessTenantId, setAccessTenantId] = useState('');
  const [accessDepartment, setAccessDepartment] = useState('');

  const debouncedSearch = useDebouncedValue(filters.search, 300);

  const queryClient = useQueryClient();
  const { data, isLoading } = useList('users', '/users', { page, limit: 20, search: debouncedSearch, isActive: filters.isActive });
  const canSelectTenant = !user?.tenantId && (hasPermission('tenant.manage') || hasPermission('tenant.switch'));
  const { data: tenants } = useList('user-tenant-options', '/tenants', { page: 1, limit: 100 }, { enabled: canSelectTenant });
  const createUser = useCreate('/users', ['users'], t('admin.users.created'));
  const updateAccess = usePatch(['users'], t('admin.users.accessUpdated'));

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
            <span key={ur.role.id} className="badge-blue text-xs">{ur.role.name}</span>
          ))}
          {!item.userRoles?.length && <span className="text-xs text-red-500">{t('admin.users.unassigned')}</span>}
        </div>
      ),
    },
    {
      key: 'tenant',
      header: t('admin.users.colTenant'),
      render: (item) => {
        if (item.tenant?.name) return item.tenant.name;
        if (item.userRoles?.some((ur: any) => ur.role.code === RoleCode.SUPER_ADMIN)) {
          return <span className="text-gray-400 italic">{t('admin.users.globalSA')}</span>;
        }
        if (item.userRoles?.some((ur: any) => ur.role.code === RoleCode.DOXART_ADMIN)) {
          return <span className="text-gray-400 italic">{t('admin.users.globalDoxart')}</span>;
        }
        return '—';
      },
    },
    {
      key: 'department',
      header: t('admin.users.colDepartment'),
      render: (item) => item.department || '—',
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
    {
      key: 'access',
      header: t('admin.users.colAccess'),
      render: (item) => (
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => {
            setAccessUser(item);
            setAccessRoleCode(item.userRoles?.[0]?.role.code || '');
            setAccessTenantId(item.tenantId || '');
            setAccessDepartment(item.department || '');
          }}
        >
          {t('admin.users.editAccess')}
        </button>
      ),
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
      roleCode,
      tenantId: roleCode === RoleCode.TENANT_LEADERSHIP || roleCode === RoleCode.TENANT_EMPLOYEE
        ? fd.get('tenantId') || undefined
        : undefined,
      department: roleCode === RoleCode.TENANT_EMPLOYEE ? fd.get('department') || undefined : undefined,
    });
    setShowCreate(false);
    setRoleCode('');
    setFilters({ search: '', isActive: '' });
    setPage(1);
    // Explicitly invalidate all user queries to ensure the list refreshes
    await queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('admin.users.title')}</h1>
          <p className="text-sm text-gray-500">{t('admin.users.subtitle')}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary w-full sm:w-auto">
          <Plus size={16} /> {t('admin.users.new')}
        </button>
      </div>

      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <input type="text" placeholder={t('admin.users.searchPlaceholder')} value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="input-field w-full sm:flex-1" aria-label={t('admin.users.searchPlaceholder')} />
          <select value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value })} className="input-field w-full sm:w-36" aria-label={t('common.all')}>
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
          <div>
            <label htmlFor="user-create-role" className="label-text">{t('admin.users.createModal.role')}</label>
            <select id="user-create-role" name="roleCode" value={roleCode} onChange={(e) => setRoleCode(e.target.value)} className="input-field" required>
              <option value="">{t('admin.users.createModal.chooseRole')}</option>
              <option value={RoleCode.SUPER_ADMIN}>{ROLE_LABELS[RoleCode.SUPER_ADMIN]}</option>
              <option value={RoleCode.DOXART_ADMIN}>{ROLE_LABELS[RoleCode.DOXART_ADMIN]}</option>
              <option value={RoleCode.TENANT_LEADERSHIP}>{ROLE_LABELS[RoleCode.TENANT_LEADERSHIP]}</option>
              <option value={RoleCode.TENANT_EMPLOYEE}>{ROLE_LABELS[RoleCode.TENANT_EMPLOYEE]}</option>
            </select>
          </div>
          {(roleCode === RoleCode.TENANT_LEADERSHIP || roleCode === RoleCode.TENANT_EMPLOYEE) && (
            user?.tenantId ? (
              <p className="text-sm text-gray-600">{t('admin.users.createModal.tenantAssigned', { tenant: user.tenant?.name || user.tenantId })}</p>
            ) : (
              <div>
                <label htmlFor="user-create-tenantId" className="label-text">{t('admin.users.createModal.tenantId')}</label>
                <select id="user-create-tenantId" name="tenantId" className="input-field" required>
                  <option value="">{t('admin.users.createModal.chooseTenant')}</option>
                  {tenants?.data?.map((tenant: any) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
                </select>
              </div>
            )
          )}
          {roleCode === RoleCode.TENANT_EMPLOYEE && (
            <div><label htmlFor="user-create-department" className="label-text">{t('admin.users.createModal.department')}</label><input id="user-create-department" name="department" className="input-field" placeholder={t('admin.users.createModal.departmentPlaceholder')} required /></div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={createUser.isPending} className="btn-primary">{createUser.isPending ? t('common.creating') : t('admin.users.createModal.submit')}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!accessUser} onClose={() => setAccessUser(null)} title={t('admin.users.accessModal.title')} size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{accessUser?.firstName} {accessUser?.lastName} ({accessUser?.email})</p>
          <div>
            <label htmlFor="user-access-role" className="label-text">{t('admin.users.createModal.role')}</label>
            <select id="user-access-role" value={accessRoleCode} onChange={(e) => setAccessRoleCode(e.target.value)} className="input-field" required>
              <option value="">{t('admin.users.createModal.chooseRole')}</option>
              <option value={RoleCode.SUPER_ADMIN}>{ROLE_LABELS[RoleCode.SUPER_ADMIN]}</option>
              <option value={RoleCode.DOXART_ADMIN}>{ROLE_LABELS[RoleCode.DOXART_ADMIN]}</option>
              <option value={RoleCode.TENANT_LEADERSHIP}>{ROLE_LABELS[RoleCode.TENANT_LEADERSHIP]}</option>
              <option value={RoleCode.TENANT_EMPLOYEE}>{ROLE_LABELS[RoleCode.TENANT_EMPLOYEE]}</option>
            </select>
          </div>
          {(accessRoleCode === RoleCode.TENANT_LEADERSHIP || accessRoleCode === RoleCode.TENANT_EMPLOYEE) && (
            user?.tenantId ? (
              <p className="text-sm text-gray-600">{t('admin.users.createModal.tenantAssigned', { tenant: user.tenant?.name || user.tenantId })}</p>
            ) : (
              <div>
                <label htmlFor="user-access-tenantId" className="label-text">{t('admin.users.createModal.tenantId')}</label>
                <select id="user-access-tenantId" value={accessTenantId} onChange={(e) => setAccessTenantId(e.target.value)} className="input-field" required>
                  <option value="">{t('admin.users.createModal.chooseTenant')}</option>
                  {tenants?.data?.map((tenant: any) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
                </select>
              </div>
            )
          )}
          {accessRoleCode === RoleCode.TENANT_EMPLOYEE && (
            <div><label htmlFor="user-access-department" className="label-text">{t('admin.users.createModal.department')}</label><input id="user-access-department" value={accessDepartment} onChange={(e) => setAccessDepartment(e.target.value)} className="input-field" placeholder={t('admin.users.createModal.departmentPlaceholder')} required /></div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setAccessUser(null)} className="btn-secondary">{t('common.cancel')}</button>
            <button
              type="button"
              disabled={!accessRoleCode || updateAccess.isPending}
              className="btn-primary"
              onClick={async () => {
                await updateAccess.mutateAsync({
                  url: `/users/${accessUser.id}/access`,
                  roleCode: accessRoleCode,
                  tenantId: accessRoleCode === RoleCode.TENANT_LEADERSHIP || accessRoleCode === RoleCode.TENANT_EMPLOYEE ? accessTenantId : undefined,
                  department: accessRoleCode === RoleCode.TENANT_EMPLOYEE ? accessDepartment : undefined,
                });
                setAccessUser(null);
              }}
            >
              {updateAccess.isPending ? t('common.processing') : t('common.save')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
