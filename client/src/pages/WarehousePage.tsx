import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ClipboardList, MoveRight, PackageCheck, RotateCcw, ScanLine, Truck } from 'lucide-react';
import api from '@/services/api';
import StatusBadge from '@/components/ui/StatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import { sortWarehouseTasks, type WarehouseTask } from '@/utils/warehouseTasks';

const taskStatuses = ['approved', 'in_progress', 'ready'] as const;

interface TaskResponse {
  data: WarehouseTask[];
  meta: { total: number };
}

export default function WarehousePage() {
  const { t, i18n } = useTranslation();
  const { user, hasPermission } = useAuth();
  const tenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const canMove = hasPermission('box.move') && hasPermission('box.read') && hasPermission('location.read');
  const canHandleOrders = hasPermission('order.read') && hasPermission('order.process');
  const canInventory = hasPermission('inventory.manage');
  const actions = [
    { to: '/warehouse/receive', label: t('warehouseHome.receive'), detail: t('warehouseHome.receiveDetail'), icon: PackageCheck, allowed: canMove },
    { to: '/orders', label: t('warehouseHome.issue'), detail: t('warehouseHome.issueDetail'), icon: Truck, allowed: canHandleOrders },
    { to: '/warehouse/move', label: t('warehouseHome.move'), detail: t('warehouseHome.moveDetail'), icon: MoveRight, allowed: canMove },
    { to: '/warehouse/inventory', label: t('warehouseHome.inventory'), detail: t('warehouseHome.inventoryDetail'), icon: ScanLine, allowed: canInventory },
  ].filter((action) => action.allowed);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ['warehouse-tasks', tenantId],
    enabled: Boolean(tenantId && canHandleOrders),
    queryFn: async () => {
      const responses = await Promise.all(taskStatuses.map((status) => api.get<TaskResponse>('/orders', {
        params: { status, page: 1, limit: 10 },
      })));
      const tasks = responses.flatMap((response) => response.data.data);
      return {
        tasks: sortWarehouseTasks(tasks).slice(0, 12),
        total: responses.reduce((sum, response) => sum + response.data.meta.total, 0),
      };
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  if (actions.length === 0) return <div className="card">{t('warehouseHome.noPermission')}</div>;
  if (!tenantId) return <div className="card">{t('warehouseMove.chooseTenant')}</div>;

  const orderTypes: Record<string, string> = {
    checkout: t('orders.typeIssue'),
    return_order: t('orders.typeReturn'),
    transfer: t('orders.typeTransfer'),
    disposal: t('orders.typeDestruction'),
  };

  return <div className="max-w-5xl space-y-5">
    <div>
      <h1 className="text-2xl font-bold text-gray-900">{t('warehouseHome.title')}</h1>
      <p className="text-sm text-gray-500 mt-1">{t('warehouseHome.subtitle')}</p>
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {actions.map(({ to, label, detail, icon: Icon }) => <Link key={to} to={to} className="card min-h-36 flex flex-col items-start justify-between gap-3 border border-transparent hover:border-primary-300 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        <Icon size={28} className="text-primary-600" aria-hidden="true" />
        <span className="block"><span className="block font-semibold text-gray-900">{label}</span><span className="block text-xs text-gray-500 mt-1">{detail}</span></span>
      </Link>)}
    </div>
    {canHandleOrders && <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2"><ClipboardList size={19} />{t('warehouseHome.tasks', { count: data?.total ?? 0 })}</h2>
        <button type="button" className="btn-secondary" disabled={isFetching} onClick={() => { void refetch(); }} aria-label={t('warehouseHome.refresh')}><RotateCcw size={16} className={isFetching ? 'animate-spin' : ''} />{t('warehouseHome.refresh')}</button>
      </div>
      <p className="text-xs text-gray-500">{t('warehouseHome.recentTasksHint')}</p>
      {isPending ? <p className="text-sm text-gray-500">{t('common.loading')}</p> : isError ? <p role="alert" className="text-sm text-red-700">{t('warehouseHome.loadError')}</p> : data?.tasks.length === 0 ? <p className="text-sm text-gray-500">{t('warehouseHome.noTasks')}</p> : <ul className="divide-y divide-gray-100">
        {data?.tasks.map((task) => {
          const deadline = task.slaDeadline ? new Date(task.slaDeadline) : null;
          const isOverdue = Boolean(deadline && deadline.getTime() < Date.now());
          return <li key={task.id}>
            <Link to={`/orders/${task.id}`} className="block py-3 rounded hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-primary-700">{task.orderNumber}</span>
                <span className="text-sm text-gray-600">{orderTypes[task.orderType] || task.orderType}</span>
                <StatusBadge status={task.status} type="order" />
                <StatusBadge status={task.priority} type="priority" />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                {deadline && <span className={isOverdue ? 'text-red-700 font-medium' : ''}>{t('warehouseHome.deadline')}: {deadline.toLocaleString(i18n.language === 'en' ? 'en-GB' : 'pl-PL')}</span>}
                {task.assignee && <span>{t('warehouseHome.assignee')}: {task.assignee.firstName} {task.assignee.lastName}</span>}
              </div>
            </Link>
          </li>;
        })}
      </ul>}
      <Link to="/orders" className="inline-flex items-center gap-2 text-sm font-medium text-primary-700 hover:underline">{t('warehouseHome.allOrders')}<ArrowRight size={15} aria-hidden="true" /></Link>
    </section>}
  </div>;
}
