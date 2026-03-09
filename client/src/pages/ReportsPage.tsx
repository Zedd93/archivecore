import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { BarChart3, Loader2, PieChart, TrendingUp, Clock } from 'lucide-react';

export default function ReportsPage() {
  const { t } = useTranslation();

  const { data: boxesByStatus, isLoading: l1 } = useQuery({
    queryKey: ['report-boxes-status'],
    queryFn: async () => { const { data } = await api.get('/reports/boxes/status'); return data.data; },
  });

  const { data: ordersByStatus, isLoading: l2 } = useQuery({
    queryKey: ['report-orders-status'],
    queryFn: async () => { const { data } = await api.get('/reports/orders/status'); return data.data; },
  });

  const { data: sla, isLoading: l3 } = useQuery({
    queryKey: ['report-sla'],
    queryFn: async () => { const { data } = await api.get('/reports/sla'); return data.data; },
  });

  const { data: retention, isLoading: l4 } = useQuery({
    queryKey: ['report-retention'],
    queryFn: async () => { const { data } = await api.get('/reports/retention'); return data.data; },
  });

  const { data: hrDepts, isLoading: l5 } = useQuery({
    queryKey: ['report-hr-depts'],
    queryFn: async () => { const { data } = await api.get('/reports/hr/departments'); return data.data; },
  });

  const { data: occupancy, isLoading: l6 } = useQuery({
    queryKey: ['report-occupancy'],
    queryFn: async () => { const { data } = await api.get('/reports/locations/occupancy'); return data.data; },
  });

  const isLoading = l1 || l2 || l3 || l4 || l5 || l6;

  const STATUS_COLORS: Record<string, string> = {
    active: 'bg-green-500', checked_out: 'bg-yellow-500', pending_disposal: 'bg-orange-500',
    disposed: 'bg-red-500', draft: 'bg-gray-400', submitted: 'bg-blue-400',
    approved: 'bg-blue-600', in_progress: 'bg-yellow-500', ready: 'bg-indigo-500',
    delivered: 'bg-purple-500', completed: 'bg-green-500', cancelled: 'bg-red-400',
    rejected: 'bg-red-500',
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary-500" size={32} /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('reports.title')}</h1>
        <p className="text-sm text-gray-500">{t('reports.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Boxes by status */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><PieChart size={20} className="text-primary-600" /> {t('reports.boxesByStatus')}</h2>
          <div className="space-y-3">
            {boxesByStatus?.map((item: any) => {
              const total = boxesByStatus.reduce((s: number, i: any) => s + i._count, 0);
              const pct = total > 0 ? Math.round((item._count / total) * 100) : 0;
              return (
                <div key={item.status} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[item.status] || 'bg-gray-400'}`} />
                  <span className="text-sm flex-1">{t(`statuses.box.${item.status}`, { defaultValue: item.status })}</span>
                  <span className="text-sm font-medium">{item._count}</span>
                  <div className="w-24 h-2 bg-gray-200 rounded-full">
                    <div className={`h-full rounded-full ${STATUS_COLORS[item.status] || 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Orders by status */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><BarChart3 size={20} className="text-primary-600" /> {t('reports.ordersByStatus')}</h2>
          <div className="space-y-3">
            {ordersByStatus?.map((item: any) => {
              const total = ordersByStatus.reduce((s: number, i: any) => s + i._count, 0);
              const pct = total > 0 ? Math.round((item._count / total) * 100) : 0;
              return (
                <div key={item.status} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[item.status] || 'bg-gray-400'}`} />
                  <span className="text-sm flex-1">{t(`statuses.order.${item.status}`, { defaultValue: item.status })}</span>
                  <span className="text-sm font-medium">{item._count}</span>
                  <div className="w-24 h-2 bg-gray-200 rounded-full">
                    <div className={`h-full rounded-full ${STATUS_COLORS[item.status] || 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* SLA Performance */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><TrendingUp size={20} className="text-primary-600" /> {t('reports.slaCompliance')}</h2>
          {sla && (
            <div className="text-center">
              <div className="text-5xl font-bold text-primary-600">{sla.slaRate}%</div>
              <p className="text-sm text-gray-500 mt-2">{t('reports.slaOnTime')}</p>
              <div className="grid grid-cols-3 gap-4 mt-6">
                <div><div className="text-lg font-bold text-gray-900">{sla.total}</div><div className="text-xs text-gray-500">{t('admin.retention.total')}</div></div>
                <div><div className="text-lg font-bold text-green-600">{sla.onTime}</div><div className="text-xs text-gray-500">{t('admin.retention.filterOnTime')}</div></div>
                <div><div className="text-lg font-bold text-red-600">{sla.overdue}</div><div className="text-xs text-gray-500">{t('reports.slaOverdue')}</div></div>
              </div>
            </div>
          )}
        </div>

        {/* Retention Summary */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Clock size={20} className="text-primary-600" /> {t('reports.hrRetention')}</h2>
          {retention && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-red-50 rounded-xl">
                  <div className="text-2xl font-bold text-red-600">{retention.expired}</div>
                  <div className="text-xs text-red-500">{t('reports.hrOverdue')}</div>
                </div>
                <div className="p-3 bg-orange-50 rounded-xl">
                  <div className="text-2xl font-bold text-orange-600">{retention.within30}</div>
                  <div className="text-xs text-orange-500">{t('admin.retention.within30')}</div>
                </div>
                <div className="p-3 bg-yellow-50 rounded-xl">
                  <div className="text-2xl font-bold text-yellow-600">{retention.within90}</div>
                  <div className="text-xs text-yellow-500">{t('admin.retention.within90')}</div>
                </div>
                <div className="p-3 bg-blue-50 rounded-xl">
                  <div className="text-2xl font-bold text-blue-600">{retention.within365}</div>
                  <div className="text-xs text-blue-500">{t('admin.retention.withinYear')}</div>
                </div>
              </div>
              {retention.onHold > 0 && (
                <div className="p-3 bg-purple-50 rounded-xl text-center">
                  <div className="text-xl font-bold text-purple-600">{retention.onHold}</div>
                  <div className="text-xs text-purple-500">{t('admin.retention.legalHold')}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* HR by department */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">{t('reports.hrByDepartment')}</h2>
          <div className="space-y-2">
            {hrDepts?.map((item: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm">{item.department || t('reports.unknown')}</span>
                <span className="badge-blue">{item._count}</span>
              </div>
            ))}
            {(!hrDepts || hrDepts.length === 0) && <p className="text-sm text-gray-400">{t('common.noData')}</p>}
          </div>
        </div>

        {/* Location occupancy */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">{t('reports.locationOccupancy')}</h2>
          <div className="space-y-3">
            {occupancy?.slice(0, 10).map((loc: any) => {
              const pct = loc.capacity ? Math.round((loc.currentCount / loc.capacity) * 100) : 0;
              return (
                <div key={loc.id} className="flex items-center gap-3">
                  <span className="text-sm flex-1 truncate">{loc.fullPath}</span>
                  <span className="text-xs text-gray-500">{loc.currentCount}/{loc.capacity}</span>
                  <div className="w-20 h-2 bg-gray-200 rounded-full">
                    <div className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-medium w-8 text-right">{pct}%</span>
                </div>
              );
            })}
            {(!occupancy || occupancy.length === 0) && <p className="text-sm text-gray-400">{t('common.noData')}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
