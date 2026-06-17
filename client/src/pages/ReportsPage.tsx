import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { BarChart3, ChevronDown, ChevronRight, Clock, Loader2, PieChart, TrendingUp, Warehouse } from 'lucide-react';

export default function ReportsPage() {
  const { t } = useTranslation();
  const [expandedWarehouseId, setExpandedWarehouseId] = useState<string | null>(null);

  const { data: boxesByStatus, isLoading: l1 } = useQuery({
    queryKey: ['report-boxes-status'],
    queryFn: async () => { const { data } = await api.get('/reports/boxes/status'); return data.data; },
  });

  const { data: ordersByStatus, isLoading: l2 } = useQuery({
    queryKey: ['report-orders-status'],
    queryFn: async () => { const { data } = await api.get('/reports/orders/status'); return data.data; },
  });

  const { data: boxesByDocType, isLoading: lDocTypes } = useQuery({
    queryKey: ['report-boxes-doc-type'],
    queryFn: async () => { const { data } = await api.get('/reports/boxes/doc-type'); return data.data; },
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

  const { data: hrByStatus, isLoading: lHrStatus } = useQuery({
    queryKey: ['report-hr-status'],
    queryFn: async () => { const { data } = await api.get('/reports/hr/status'); return data.data; },
  });

  const { data: occupancy, isLoading: l6 } = useQuery({
    queryKey: ['report-occupancy'],
    queryFn: async () => { const { data } = await api.get('/reports/locations/occupancy'); return data.data; },
  });

  const isLoading = l1 || l2 || lDocTypes || l3 || l4 || l5 || lHrStatus || l6;

  const STATUS_COLORS: Record<string, string> = {
    active: 'bg-green-500', checked_out: 'bg-yellow-500', pending_disposal: 'bg-orange-500',
    disposed: 'bg-red-500', draft: 'bg-gray-400', submitted: 'bg-blue-400',
    approved: 'bg-blue-600', in_progress: 'bg-yellow-500', ready: 'bg-indigo-500',
    delivered: 'bg-purple-500', completed: 'bg-green-500', cancelled: 'bg-red-400',
    rejected: 'bg-red-500', terminated: 'bg-red-500', retired: 'bg-gray-500', deceased: 'bg-gray-600',
  };

  const DOC_TYPE_COLORS = ['bg-primary-500', 'bg-blue-500', 'bg-indigo-500', 'bg-purple-500', 'bg-sky-500', 'bg-cyan-500'];

  const getBoxStatusLabel = (item: any) => t(`statuses.box.${item.status}`, { defaultValue: item.label || item.status });
  const getOrderStatusLabel = (item: any) => t(`statuses.order.${item.status}`, { defaultValue: item.label || item.status });
  const getDocTypeLabel = (item: any) => t(`docTypes.${item.docType}`, { defaultValue: item.label || item.docType || t('reports.unknown') });
  const getEmploymentStatusLabel = (item: any) => t(`statuses.employment.${item.employmentStatus}`, { defaultValue: item.label || item.employmentStatus });
  const getOccupied = (loc: any) => loc.aggregatedCount ?? loc.currentCount ?? 0;
  const getOccupancyPercent = (loc: any) => {
    const capacity = loc.capacity ?? 0;
    return capacity > 0 ? Math.round((getOccupied(loc) / capacity) * 100) : 0;
  };
  const getOccupancyColor = (pct: number) => {
    if (pct > 90) return 'bg-red-500';
    if (pct > 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };
  const getOccupancyBadgeColor = (pct: number) => {
    if (pct > 90) return 'bg-red-50 text-red-700 ring-red-200';
    if (pct > 70) return 'bg-yellow-50 text-yellow-700 ring-yellow-200';
    return 'bg-green-50 text-green-700 ring-green-200';
  };
  const getLocationTypeLabel = (type: string) => t(`locationTypes.${type}`, { defaultValue: type });

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
                  <span className="text-sm flex-1">{getBoxStatusLabel(item)}</span>
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
                  <span className="text-sm flex-1">{getOrderStatusLabel(item)}</span>
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

        {/* Boxes by document type */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><BarChart3 size={20} className="text-primary-600" /> {t('reports.boxesByDocType')}</h2>
          <div className="space-y-3">
            {boxesByDocType?.map((item: any, index: number) => {
              const total = boxesByDocType.reduce((s: number, i: any) => s + i._count, 0);
              const pct = total > 0 ? Math.round((item._count / total) * 100) : 0;
              const color = DOC_TYPE_COLORS[index % DOC_TYPE_COLORS.length];
              return (
                <div key={item.docType || 'unknown'} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${color}`} />
                  <span className="text-sm flex-1">{getDocTypeLabel(item)}</span>
                  <span className="text-sm font-medium">{item._count}</span>
                  <div className="w-24 h-2 bg-gray-200 rounded-full">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                </div>
              );
            })}
            {(!boxesByDocType || boxesByDocType.length === 0) && <p className="text-sm text-gray-400">{t('common.noData')}</p>}
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

        {/* HR by employment status */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">{t('reports.hrByStatus')}</h2>
          <div className="space-y-3">
            {hrByStatus?.map((item: any) => {
              const total = hrByStatus.reduce((s: number, i: any) => s + i._count, 0);
              const pct = total > 0 ? Math.round((item._count / total) * 100) : 0;
              return (
                <div key={item.employmentStatus} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[item.employmentStatus] || 'bg-gray-400'}`} />
                  <span className="text-sm flex-1">{getEmploymentStatusLabel(item)}</span>
                  <span className="text-sm font-medium">{item._count}</span>
                  <div className="w-24 h-2 bg-gray-200 rounded-full">
                    <div className={`h-full rounded-full ${STATUS_COLORS[item.employmentStatus] || 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                </div>
              );
            })}
            {(!hrByStatus || hrByStatus.length === 0) && <p className="text-sm text-gray-400">{t('common.noData')}</p>}
          </div>
        </div>

        {/* Location occupancy */}
        <div className="card lg:col-span-2">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Warehouse size={20} className="text-primary-600" />
                {t('reports.warehouseOccupancy')}
              </h2>
              <p className="mt-1 text-sm text-gray-500">{t('reports.warehouseOccupancyDesc')}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {occupancy?.map((warehouseItem: any) => {
              const occupied = getOccupied(warehouseItem);
              const capacity = warehouseItem.capacity ?? 0;
              const pct = getOccupancyPercent(warehouseItem);
              const expanded = expandedWarehouseId === warehouseItem.id;

              return (
                <div key={warehouseItem.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                          <Warehouse size={20} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-gray-900 break-words">{warehouseItem.name || warehouseItem.fullPath}</h3>
                          <p className="text-xs text-gray-500 break-words">{warehouseItem.fullPath}</p>
                        </div>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${getOccupancyBadgeColor(pct)}`}>
                      {pct}%
                    </span>
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="text-gray-500">{t('reports.occupied')}</span>
                      <span className="font-medium text-gray-900">
                        {occupied}/{capacity || '—'}
                      </span>
                    </div>
                    <div className="h-4 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full transition-all ${getOccupancyColor(pct)}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                      <span>{t('reports.capacity')}</span>
                      <span>{capacity || '—'}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedWarehouseId(expanded ? null : warehouseItem.id)}
                    className="mt-4 flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <span>{t('reports.warehouseDetails')}</span>
                    <span className="flex items-center gap-2 text-xs text-gray-500">
                      {warehouseItem.children?.length ?? 0} {t('reports.locationsInWarehouse')}
                      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                  </button>

                  {expanded && (
                    <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="space-y-2">
                        {warehouseItem.children?.map((loc: any) => {
                          const detailOccupied = getOccupied(loc);
                          const detailCapacity = loc.capacity ?? 0;
                          const detailPct = getOccupancyPercent(loc);

                          return (
                            <div key={loc.id} className="rounded-lg bg-white p-3 shadow-sm">
                              <div className="mb-2 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900 break-words">{loc.name || loc.fullPath}</p>
                                  <p className="text-xs text-gray-500 break-words">{loc.fullPath}</p>
                                </div>
                                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                  {getLocationTypeLabel(loc.type)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                                  <div
                                    className={`h-full rounded-full ${getOccupancyColor(detailPct)}`}
                                    style={{ width: `${Math.min(detailPct, 100)}%` }}
                                  />
                                </div>
                                <span className="w-20 text-right text-xs font-medium text-gray-700">
                                  {detailOccupied}/{detailCapacity || '—'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                        {(!warehouseItem.children || warehouseItem.children.length === 0) && (
                          <p className="text-sm text-gray-400">{t('reports.noWarehouseDetails')}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {(!occupancy || occupancy.length === 0) && <p className="text-sm text-gray-400">{t('reports.noWarehouseOccupancy')}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
