import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import api from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { Permissions, RoleCode } from '@archivecore/shared';
import { getApiErrorMessageAsync } from '@/utils/apiError';
import { useExport } from '@/hooks/useExport';
import { slaReportOrderUrl, SlaReportKind } from '@/utils/slaReportDrilldown';
import { slaTargetStatus } from '@/utils/slaTarget';
import { readSlaReportView } from '@/utils/slaReportView';
import toast from 'react-hot-toast';
import AccessionLedgerSection from '@/components/reports/AccessionLedgerSection';
import { AlertTriangle, BarChart3, ChevronDown, ChevronRight, Clock, Download, Loader2, PieChart, TrendingUp, Warehouse } from 'lucide-react';

interface StorageHealth {
  unlocated: { total: number; boxes: Array<{ id: string; boxNumber: string }> };
  overCapacity: { total: number; locations: Array<{ id: string; fullPath: string; occupied: number; capacity: number }> };
  tenantMismatch: {
    total: number;
    boxes: Array<{ id: string; boxNumber: string }>;
    folders: Array<{ id: string; folderNumber: string }>;
  };
}

interface SlaBreakdown {
  days: number;
  asOf: string;
  slaTargetPercent: number | null;
  data: Array<{
    tenantId: string;
    tenantName: string;
    orderType: string;
    priority: string;
    completed: number;
    breached: number;
    activeOverdue: number;
    onTime: number;
    slaRate: number | null;
  }>;
  totals: { completed: number; breached: number; activeOverdue: number };
}

interface SlaTrend {
  months: Array<{ month: string; completed: number; breached: number; onTime: number; slaRate: number | null }>;
}

interface SlaTenantTrends {
  months: string[];
  data: Array<{
    tenantId: string;
    tenantName: string;
    completed: number;
    breached: number;
    slaRate: number | null;
    slaTargetPercent: number;
    months: Array<{ month: string; completed: number; breached: number; slaRate: number | null }>;
  }>;
}

function formatSlaMonth(month: string, language: string): string {
  return new Intl.DateTimeFormat(language.startsWith('en') ? 'en' : 'pl', {
    month: 'short', year: 'numeric', timeZone: 'Europe/Warsaw',
  }).format(new Date(`${month}-15T12:00:00Z`));
}

const SLA_ORDER_TYPES = [
  { code: 'checkout', labelKey: 'orders.typeIssue' },
  { code: 'return_order', labelKey: 'orders.typeReturn' },
  { code: 'transfer', labelKey: 'orders.typeTransfer' },
  { code: 'disposal', labelKey: 'orders.typeDestruction' },
  { code: 'scan', labelKey: 'orders.typeScan' },
] as const;

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const previousMonth = () => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export default function ReportsPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { user, hasPermission, hasRole } = useAuth();
  const canViewAllSla = hasRole(RoleCode.SUPER_ADMIN) || hasRole(RoleCode.DOXART_ADMIN);
  const [expandedWarehouseId, setExpandedWarehouseId] = useState<string | null>(null);
  const [reportMonth, setReportMonth] = useState(previousMonth);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [slaDays, setSlaDays] = useState(() => readSlaReportView(location.search, canViewAllSla).days);
  const [slaScope, setSlaScope] = useState<'tenant' | 'all'>(() => readSlaReportView(location.search, canViewAllSla).scope);
  const [slaOrderType, setSlaOrderType] = useState('');
  const isBelowSlaTarget = (completed: number, breached: number, target: number | null) => target !== null && slaTargetStatus(completed, breached, target) === 'below';
  useEffect(() => {
    const view = readSlaReportView(location.search, canViewAllSla);
    setSlaDays(view.days);
    setSlaScope(view.scope);
  }, [location.search, canViewAllSla]);
  const canOpenSlaOrders = hasPermission(Permissions.ORDER_READ);
  const activeTenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const orderTypeLabels = Object.fromEntries(SLA_ORDER_TYPES.map(({ code, labelKey }) => [code, t(labelKey)]));
  const slaCount = (row: SlaBreakdown['data'][number], kind: SlaReportKind, count: number, report: SlaBreakdown) => (
    canOpenSlaOrders && count > 0 ? <a
      href={slaReportOrderUrl({
        slaReport: kind,
        slaDays: String(report.days),
        slaAsOf: report.asOf,
        tenantId: row.tenantId,
        orderType: row.orderType,
        priority: row.priority,
      })}
      onClick={() => { if (canViewAllSla && !user?.tenantId) localStorage.setItem('tenantId', row.tenantId); }}
      className="font-medium underline underline-offset-2 hover:text-primary-700"
      aria-label={`${t(kind === 'completed' ? 'reports.slaCompleted' : kind === 'breached' ? 'reports.slaBreached' : 'reports.slaActiveOverdue')}: ${count}, ${row.tenantName}, ${orderTypeLabels[row.orderType] || row.orderType}`}
    >{count}</a> : count
  );
  const { exportData: exportSlaBreakdown, isExporting: slaExporting } = useExport({
    endpoint: '/reports/sla/breakdown/export',
    defaultFilename: 'raport_sla.xlsx',
  });
  const { exportData: exportSlaTenantTrends, isExporting: slaTenantTrendsExporting } = useExport({
    endpoint: '/reports/sla/trend/tenants/export',
    defaultFilename: 'raport_sla_klienci.xlsx',
  });

  const downloadMonthlyReport = async () => {
    if (!reportMonth || downloadingReport) return;
    setDownloadingReport(true);
    try {
      const { data } = await api.get('/reports/monthly/pdf', {
        params: { month: reportMonth },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `archivecore-raport-${reportMonth}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(await getApiErrorMessageAsync(error, t('reports.monthlyError')));
    } finally {
      setDownloadingReport(false);
    }
  };

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

  const { data: slaBreakdown, isLoading: slaBreakdownLoading, isError: slaBreakdownError, refetch: refetchSlaBreakdown } = useQuery<SlaBreakdown>({
    queryKey: ['report-sla-breakdown', user?.id, canViewAllSla, activeTenantId, slaScope, slaDays, slaOrderType],
    queryFn: async () => {
      const { data } = await api.get('/reports/sla/breakdown', { params: { days: slaDays, scope: slaScope, orderType: slaOrderType || undefined } });
      return data.data;
    },
    enabled: slaScope === 'all' ? canViewAllSla : Boolean(activeTenantId),
    refetchInterval: 60_000,
  });
  const { data: slaTrend, isLoading: slaTrendLoading, isError: slaTrendError, refetch: refetchSlaTrend } = useQuery<SlaTrend>({
    queryKey: ['report-sla-trend', user?.id, canViewAllSla, activeTenantId, slaScope, slaDays, slaOrderType],
    queryFn: async () => {
      const { data } = await api.get('/reports/sla/trend', { params: { days: slaDays, scope: slaScope, orderType: slaOrderType || undefined } });
      return data.data;
    },
    enabled: slaScope === 'all' ? canViewAllSla : Boolean(activeTenantId),
    refetchInterval: 60_000,
  });
  const { data: slaTenantTrends, isLoading: slaTenantTrendsLoading, isError: slaTenantTrendsError, refetch: refetchSlaTenantTrends } = useQuery<SlaTenantTrends>({
    queryKey: ['report-sla-tenant-trends', user?.id, slaDays, slaOrderType],
    queryFn: async () => {
      const { data } = await api.get('/reports/sla/trend/tenants', { params: { days: slaDays, scope: 'all', orderType: slaOrderType || undefined } });
      return data.data;
    },
    enabled: canViewAllSla && slaScope === 'all',
    refetchInterval: 60_000,
  });
  const selectedSlaTarget = slaScope === 'tenant' ? slaBreakdown?.slaTargetPercent ?? null : null;

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

  const { data: storageHealth, isLoading: healthLoading, isError: healthError, refetch: refetchHealth } = useQuery<StorageHealth>({
    queryKey: ['report-storage-health'],
    queryFn: async () => { const { data } = await api.get('/reports/storage-health'); return data.data; },
  });

  const isLoading = l1 || l2 || lDocTypes || l3 || l4 || l5 || lHrStatus || l6;

  const STATUS_COLORS: Record<string, string> = {
    active: 'bg-green-500', checked_out: 'bg-yellow-500', pending_disposal: 'bg-orange-500', approved_disposal: 'bg-blue-500',
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
  const getLocationTypeLabel = (type: string) => t(`statuses.locationType.${type}`, { defaultValue: type });
  const occupancyItems = Array.isArray(occupancy) ? occupancy : [];

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary-500" size={32} /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('reports.title')}</h1>
        <p className="text-sm text-gray-500">{t('reports.subtitle')}</p>
      </div>

      <AccessionLedgerSection />

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><AlertTriangle size={20} className="text-amber-600" />{t('reports.storageHealthTitle')}</h2>
          <p className="mt-1 text-sm text-gray-500">{t('reports.storageHealthDescription')}</p>
        </div>
        {healthLoading ? <p className="text-sm text-gray-500">{t('common.loading')}</p> : healthError ? (
          <button type="button" className="btn-secondary" onClick={() => { void refetchHealth(); }}>{t('common.tryAgain')}</button>
        ) : storageHealth && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-xl border border-gray-200 p-4 space-y-2">
              <div className="text-sm text-gray-600">{t('reports.unlocatedBoxes')}</div>
              <div className="text-2xl font-bold">{storageHealth.unlocated.total}</div>
              {storageHealth.unlocated.boxes.map((box) => <Link key={box.id} to={`/boxes/${box.id}`} className="block text-sm text-primary-700 hover:underline break-words">{box.boxNumber}</Link>)}
            </div>
            <div className="rounded-xl border border-gray-200 p-4 space-y-2">
              <div className="text-sm text-gray-600">{t('reports.overCapacity')}</div>
              <div className="text-2xl font-bold">{storageHealth.overCapacity.total}</div>
              {storageHealth.overCapacity.locations.map((location) => (
                <div key={location.id} className="text-sm break-words">
                  <Link to="/locations" className="text-primary-700 hover:underline">{location.fullPath}</Link>
                  <span className="text-gray-500"> · {location.occupied}/{location.capacity}</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-gray-200 p-4 space-y-2">
              <div className="text-sm text-gray-600">{t('reports.tenantMismatch')}</div>
              <div className="text-2xl font-bold">{storageHealth.tenantMismatch.total}</div>
              {storageHealth.tenantMismatch.boxes.map((box) => <Link key={box.id} to={`/boxes/${box.id}`} className="block text-sm text-primary-700 hover:underline break-words">{t('reports.boxLabel', { number: box.boxNumber })}</Link>)}
              {storageHealth.tenantMismatch.folders.map((folder) => <Link key={folder.id} to={`/folders/${folder.id}`} className="block text-sm text-primary-700 hover:underline break-words">{t('reports.folderLabel', { number: folder.folderNumber })}</Link>)}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold text-gray-900">{t('reports.monthlyTitle')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('reports.monthlyDescription')}</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium text-gray-700">
            {t('reports.monthlyMonth')}
            <input
              type="month"
              min="2000-01"
              max={currentMonth()}
              value={reportMonth}
              onChange={(event) => setReportMonth(event.target.value)}
              className="input mt-1 block"
            />
          </label>
          <button type="button" className="btn-primary flex items-center gap-2" disabled={!reportMonth || downloadingReport} onClick={downloadMonthlyReport}>
            {downloadingReport ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {t('reports.monthlyDownload')}
          </button>
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><TrendingUp size={20} className="text-primary-600" />{t('reports.slaBreakdownTitle')}</h2>
          <p className="mt-1 text-sm text-gray-500">{t('reports.slaBreakdownDescription')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm font-medium text-gray-700">
            {t('reports.slaPeriod')}
            <select className="input-field mt-1" value={slaDays} onChange={(event) => setSlaDays(Number(event.target.value))}>
              {[30, 90, 180, 365].map((days) => <option key={days} value={days}>{t('reports.slaDays', { count: days })}</option>)}
            </select>
          </label>
          {canViewAllSla && <label className="text-sm font-medium text-gray-700">
            {t('reports.slaScope')}
            <select className="input-field mt-1" value={slaScope} onChange={(event) => setSlaScope(event.target.value as 'tenant' | 'all')}>
              <option value="tenant">{t('reports.slaSelectedTenant')}</option>
              <option value="all">{t('reports.slaAllTenants')}</option>
            </select>
          </label>}
          <label className="text-sm font-medium text-gray-700">
            {t('reports.slaOrderType')}
            <select className="input-field mt-1" value={slaOrderType} onChange={(event) => setSlaOrderType(event.target.value)}>
              <option value="">{t('reports.slaAllOrderTypes')}</option>
              {SLA_ORDER_TYPES.map(({ code, labelKey }) => <option key={code} value={code}>{t(labelKey)}</option>)}
            </select>
          </label>
          {selectedSlaTarget !== null && <p className="self-end pb-2 text-sm text-gray-600">{t('reports.slaTarget')}: <strong>{selectedSlaTarget}%</strong></p>}
          {hasPermission(Permissions.REPORT_EXPORT) && <div className="flex flex-wrap items-end gap-2">
            <button type="button" className="btn-secondary flex items-center gap-2" disabled={slaExporting || (slaScope === 'tenant' && !activeTenantId)} onClick={() => { void exportSlaBreakdown({ format: 'xlsx', scope: slaScope, days: String(slaDays), ...(slaOrderType ? { orderType: slaOrderType } : {}) }); }}>
              {slaExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}{t('reports.slaExportXlsx')}
            </button>
            <button type="button" className="btn-secondary flex items-center gap-2" disabled={slaExporting || (slaScope === 'tenant' && !activeTenantId)} onClick={() => { void exportSlaBreakdown({ format: 'csv', scope: slaScope, days: String(slaDays), ...(slaOrderType ? { orderType: slaOrderType } : {}) }); }}>
              {t('reports.slaExportCsv')}
            </button>
          </div>}
        </div>
        {slaBreakdownLoading ? <p className="text-sm text-gray-500">{t('common.loading')}</p> : slaBreakdownError ? (
          <button type="button" className="btn-secondary" onClick={() => { void refetchSlaBreakdown(); }}>{t('common.tryAgain')}</button>
        ) : slaBreakdown && (
          slaBreakdown.data.length === 0 ? <p className="text-sm text-gray-500">{t('common.noData')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-600">
                    <th scope="col" className="py-2 pr-4">{t('reports.slaTenant')}</th>
                    <th scope="col" className="py-2 pr-4">{t('reports.slaOrderType')}</th>
                    <th scope="col" className="py-2 pr-4">{t('reports.slaPriority')}</th>
                    <th scope="col" className="py-2 pr-4 text-right">{t('reports.slaCompleted')}</th>
                    <th scope="col" className="py-2 pr-4 text-right">{t('reports.slaBreached')}</th>
                    <th scope="col" className="py-2 pr-4 text-right">{t('reports.slaActiveOverdue')}</th>
                    <th scope="col" className="py-2 text-right">{t('reports.slaRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {slaBreakdown.data.map((row) => (
                    <tr key={`${row.tenantId}-${row.orderType}-${row.priority}`} className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-medium">{row.tenantName}</td>
                      <td className="py-2 pr-4">{orderTypeLabels[row.orderType] || row.orderType}</td>
                      <td className="py-2 pr-4">{t(`reports.slaPriority${row.priority === 'urgent' ? 'Urgent' : row.priority === 'high' ? 'High' : 'Normal'}`)}</td>
                      <td className="py-2 pr-4 text-right">{slaCount(row, 'completed', row.completed, slaBreakdown)}</td>
                      <td className="py-2 pr-4 text-right text-red-700">{slaCount(row, 'breached', row.breached, slaBreakdown)}</td>
                      <td className="py-2 pr-4 text-right text-orange-700">{slaCount(row, 'activeOverdue', row.activeOverdue, slaBreakdown)}</td>
                      <td className="py-2 text-right">{row.slaRate === null ? '—' : `${row.slaRate}%`}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-gray-900">
                    <th scope="row" colSpan={3} className="pt-3 text-left">{t('reports.slaTotal')}</th>
                    <td className="pt-3 pr-4 text-right">{slaBreakdown.totals.completed}</td>
                    <td className="pt-3 pr-4 text-right">{slaBreakdown.totals.breached}</td>
                    <td className="pt-3 pr-4 text-right">{slaBreakdown.totals.activeOverdue}</td>
                    <td className="pt-3 text-right">{slaBreakdown.totals.completed ? `${Math.round((slaBreakdown.totals.completed - slaBreakdown.totals.breached) / slaBreakdown.totals.completed * 100)}%` : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        )}
        {slaBreakdown && selectedSlaTarget !== null && !slaBreakdownError && !slaBreakdownLoading && slaBreakdown.totals.completed > 0 && <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${isBelowSlaTarget(slaBreakdown.totals.completed, slaBreakdown.totals.breached, selectedSlaTarget) ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}
        >
          {isBelowSlaTarget(slaBreakdown.totals.completed, slaBreakdown.totals.breached, selectedSlaTarget) && <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <span>{t(isBelowSlaTarget(slaBreakdown.totals.completed, slaBreakdown.totals.breached, selectedSlaTarget) ? 'reports.slaTargetBelowSummary' : 'reports.slaTargetMetSummary', {
            rate: Math.round((slaBreakdown.totals.completed - slaBreakdown.totals.breached) / slaBreakdown.totals.completed * 100),
            target: selectedSlaTarget,
            count: slaBreakdown.totals.completed,
          })}</span>
        </div>}
        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-base font-semibold text-gray-900">{t('reports.slaTrendTitle')}</h3>
          <p className="mt-1 text-sm text-gray-500">{t('reports.slaTrendDescription')}</p>
          {slaTrendLoading ? <p className="mt-3 text-sm text-gray-500">{t('common.loading')}</p> : slaTrendError ? (
            <button type="button" className="btn-secondary mt-3" onClick={() => { void refetchSlaTrend(); }}>{t('common.tryAgain')}</button>
          ) : slaTrend && (
            slaTrend.months.every((month) => month.completed === 0) ? <p className="mt-3 text-sm text-gray-500">{t('reports.slaTrendEmpty')}</p> : (
              <div className="mt-4 overflow-x-auto pb-2">
                <div className="grid min-w-[480px] gap-3" style={{ gridTemplateColumns: `repeat(${slaTrend.months.length}, minmax(5.5rem, 1fr))` }}>
                  {slaTrend.months.map((month) => {
                    const label = formatSlaMonth(month.month, i18n.language);
                    const belowTarget = isBelowSlaTarget(month.completed, month.breached, selectedSlaTarget);
                    return <div key={month.month} className="min-w-0 text-center text-xs text-gray-700">
                      <span className={`block font-semibold text-sm ${belowTarget ? 'text-amber-800' : 'text-gray-900'}`}>{month.slaRate === null ? '—' : `${month.slaRate}%`}</span>
                      {belowTarget && <span className="mt-1 block text-amber-800">{t('reports.slaBelowTarget')}</span>}
                      <div
                        className="mt-2 flex h-4 overflow-hidden rounded-full bg-gray-100"
                        role="img"
                        aria-label={t('reports.slaTrendBarLabel', { month: label, completed: month.completed, onTime: month.onTime, breached: month.breached })}
                      >
                        {month.completed > 0 && <>
                          <span className="bg-emerald-500" style={{ width: `${month.onTime / month.completed * 100}%` }} />
                          <span className="bg-red-500" style={{ width: `${month.breached / month.completed * 100}%` }} />
                        </>}
                      </div>
                      <span className="mt-2 block">{label}</span>
                      <span className="block text-gray-500">{t('reports.slaTrendCount', { count: month.completed })}</span>
                    </div>;
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />{t('reports.slaTrendOnTime')}</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />{t('reports.slaBreached')}</span>
                </div>
              </div>
            )
          )}
        </div>
        {canViewAllSla && slaScope === 'all' && <div className="border-t border-gray-200 pt-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900">{t('reports.slaTenantTrendTitle')}</h3>
              <p className="mt-1 text-sm text-gray-500">{t('reports.slaTenantTrendDescription')}</p>
            </div>
            {hasPermission(Permissions.REPORT_EXPORT) && <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary flex items-center gap-2" disabled={slaTenantTrendsExporting || slaTenantTrendsLoading || slaTenantTrendsError} onClick={() => { void exportSlaTenantTrends({ format: 'xlsx', scope: 'all', days: String(slaDays), ...(slaOrderType ? { orderType: slaOrderType } : {}) }); }}>
                {slaTenantTrendsExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}{t('reports.slaTenantTrendExportXlsx')}
              </button>
              <button type="button" className="btn-secondary" disabled={slaTenantTrendsExporting || slaTenantTrendsLoading || slaTenantTrendsError} onClick={() => { void exportSlaTenantTrends({ format: 'csv', scope: 'all', days: String(slaDays), ...(slaOrderType ? { orderType: slaOrderType } : {}) }); }}>
                {t('reports.slaTenantTrendExportCsv')}
              </button>
            </div>}
          </div>
          {slaTenantTrendsLoading ? <p className="mt-3 text-sm text-gray-500">{t('common.loading')}</p> : slaTenantTrendsError ? (
            <button type="button" className="btn-secondary mt-3" onClick={() => { void refetchSlaTenantTrends(); }}>{t('common.tryAgain')}</button>
          ) : slaTenantTrends && (
            slaTenantTrends.data.length === 0 ? <p className="mt-3 text-sm text-gray-500">{t('reports.slaTenantTrendEmpty')}</p> : (
              <div className="mt-4 max-h-[28rem] overflow-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-max border-collapse text-xs" aria-label={t('reports.slaTenantTrendTitle')}>
                  <thead>
                    <tr className="text-left text-gray-700">
                      <th scope="col" className="sticky left-0 top-0 z-30 min-w-48 bg-gray-50 px-3 py-2">{t('reports.slaTenant')}</th>
                      {slaTenantTrends.months.map((month) => <th key={month} scope="col" className="sticky top-0 z-20 min-w-24 bg-gray-50 px-2 py-2 text-center">{formatSlaMonth(month, i18n.language)}</th>)}
                      <th scope="col" className="sticky top-0 z-20 min-w-24 bg-gray-50 px-2 py-2 text-center">{t('reports.slaTenantTrendOverall')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slaTenantTrends.data.map((tenant) => <tr key={tenant.tenantId} className="border-t border-gray-100">
                      <th scope="row" className="sticky left-0 z-10 max-w-64 bg-white px-3 py-2 text-left font-medium text-gray-900">{tenant.tenantName}<span className="mt-1 block text-xs font-normal text-gray-500">{t('reports.slaTarget')}: {tenant.slaTargetPercent}%</span></th>
                      {tenant.months.map((month) => <td key={month.month} className={`px-2 py-2 text-center ${isBelowSlaTarget(month.completed, month.breached, tenant.slaTargetPercent) ? 'bg-amber-50' : ''}`}>
                        {month.slaRate === null ? <span className="text-gray-400">—</span> : <>
                          <span className={`font-semibold ${isBelowSlaTarget(month.completed, month.breached, tenant.slaTargetPercent) ? 'text-amber-800' : 'text-gray-900'}`}>{month.slaRate}%</span>
                          {isBelowSlaTarget(month.completed, month.breached, tenant.slaTargetPercent) && <span className="mt-1 block text-amber-800">{t('reports.slaBelowTarget')}</span>}
                          <span className="mt-1 block text-gray-500">{t('reports.slaTenantTrendSample', { count: month.completed })}</span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-red-200" aria-hidden="true">
                            <span className="block h-full bg-emerald-500" style={{ width: `${month.slaRate}%` }} />
                          </span>
                        </>}
                      </td>)}
                      <td className={`px-2 py-2 text-center font-semibold ${isBelowSlaTarget(tenant.completed, tenant.breached, tenant.slaTargetPercent) ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-900'}`}>
                        {tenant.slaRate === null ? '—' : `${tenant.slaRate}%`}
                        {isBelowSlaTarget(tenant.completed, tenant.breached, tenant.slaTargetPercent) && <span className="mt-1 block font-normal">{t('reports.slaBelowTarget')}</span>}
                        <span className="mt-1 block font-normal text-gray-500">{t('reports.slaTenantTrendSample', { count: tenant.completed })}</span>
                      </td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>}
      </section>

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
            {occupancyItems.map((warehouseItem: any) => {
              const occupied = getOccupied(warehouseItem);
              const capacity = warehouseItem.capacity ?? 0;
              const pct = getOccupancyPercent(warehouseItem);
              const expanded = expandedWarehouseId === warehouseItem.id;
              const childLocations = Array.isArray(warehouseItem.children) ? warehouseItem.children : [];

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
                      {childLocations.length} {t('reports.locationsInWarehouse')}
                      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                  </button>

                  {expanded && (
                    <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="space-y-2">
                        {childLocations.map((loc: any) => {
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
                        {childLocations.length === 0 && (
                          <p className="text-sm text-gray-400">{t('reports.noWarehouseDetails')}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {occupancyItems.length === 0 && <p className="text-sm text-gray-400">{t('reports.noWarehouseOccupancy')}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
