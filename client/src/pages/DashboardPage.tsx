import { useDashboardKPIs } from '@/hooks/useApi';
import { useTranslation } from 'react-i18next';
import KPICard from '@/components/ui/KPICard';
import { Box, ClipboardList, UserCircle, MapPin, AlertTriangle, Clock, Users, Archive } from 'lucide-react';
import { Loader2 } from 'lucide-react';

export default function DashboardPage() {
  const { data: kpis, isLoading } = useDashboardKPIs();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-primary-500" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('dashboard.subtitle')}</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title={t('dashboard.totalBoxes')}
          value={kpis?.totalBoxes ?? 0}
          icon={<Box size={24} />}
          color="blue"
          change={`${kpis?.activeBoxes ?? 0} ${t('dashboard.activeBoxes')}`}
        />
        <KPICard
          title={t('boxes.statusIssued')}
          value={kpis?.checkedOutBoxes ?? 0}
          icon={<Archive size={24} />}
          color="yellow"
        />
        <KPICard
          title={t('dashboard.hrRecords')}
          value={kpis?.totalHRFolders ?? 0}
          icon={<UserCircle size={24} />}
          color="purple"
        />
        <KPICard
          title={t('dashboard.activeOrders')}
          value={kpis?.activeOrders ?? 0}
          icon={<ClipboardList size={24} />}
          color="green"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title={t('dashboard.overdueSla')}
          value={kpis?.overdueOrders ?? 0}
          icon={<AlertTriangle size={24} />}
          color="red"
          changeType={kpis?.overdueOrders > 0 ? 'negative' : 'neutral'}
          change={kpis?.overdueOrders > 0 ? t('dashboard.needsAttention') : t('dashboard.allGood')}
        />
        <KPICard
          title={t('locations.title')}
          value={kpis?.totalLocations ?? 0}
          icon={<MapPin size={24} />}
          color="blue"
          change={t('dashboard.occupancy', { occupancy: kpis?.occupancyRate ?? 0 })}
        />
        <KPICard
          title={t('boxes.statusForDestruction')}
          value={kpis?.pendingDisposal ?? 0}
          icon={<Clock size={24} />}
          color="yellow"
        />
        <KPICard
          title={t('dashboard.activeUsers')}
          value={kpis?.totalUsers ?? 0}
          icon={<Users size={24} />}
          color="green"
        />
      </div>

      {/* Quick actions */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.quickActions')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <a href="/boxes?action=create" className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-all">
            <Box size={24} className="text-primary-600" />
            <span className="text-sm font-medium text-gray-700">{t('dashboard.newBox')}</span>
          </a>
          <a href="/orders?action=create" className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-all">
            <ClipboardList size={24} className="text-primary-600" />
            <span className="text-sm font-medium text-gray-700">{t('dashboard.newOrder')}</span>
          </a>
          <a href="/hr?action=create" className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-all">
            <UserCircle size={24} className="text-primary-600" />
            <span className="text-sm font-medium text-gray-700">{t('dashboard.newHr')}</span>
          </a>
          <a href="/search" className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-all">
            <MapPin size={24} className="text-primary-600" />
            <span className="text-sm font-medium text-gray-700">{t('dashboard.search')}</span>
          </a>
        </div>
      </div>
    </div>
  );
}
