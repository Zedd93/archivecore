import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import api from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useExport } from '@/hooks/useExport';

interface AnnualReport {
  year: number;
  generatedAt: string;
  ledger: {
    acquisitions: number;
    disposals: number;
    months: Array<{ month: number; acquisitions: number; disposals: number }>;
  };
  activity: {
    newFolders: number;
    newHrFolders: number;
    createdOrders: Array<{ type: string; count: number }>;
    completedOrders: number;
    inventorySessions: number;
  };
  current: { boxes: number; folders: number; hrFolders: number };
}

export default function AnnualReportSection() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const tenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const [year, setYear] = useState(new Date().getFullYear());
  const { exportData, isExporting } = useExport({ endpoint: '/reports/annual/pdf', defaultFilename: `archivecore-sprawozdanie-roczne-${year}.pdf` });
  const { data, isLoading, isError, refetch } = useQuery<AnnualReport>({
    queryKey: ['annual-report', user?.id, tenantId, year],
    queryFn: async () => {
      const response = await api.get('/reports/annual', { params: { year } });
      return response.data.data;
    },
    enabled: Boolean(tenantId),
  });
  const locale = i18n.language.startsWith('en') ? 'en-GB' : 'pl-PL';
  const monthLabel = (month: number) => new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'Europe/Warsaw' })
    .format(new Date(Date.UTC(year, month - 1, 15)));
  const createdOrders = data?.activity.createdOrders.reduce((sum, row) => sum + row.count, 0) ?? 0;

  return <section className="card space-y-4">
    <div>
      <h2 className="text-lg font-semibold text-gray-900">{t('reports.annualTitle')}</h2>
      <p className="mt-1 text-sm text-gray-500">{t('reports.annualDescription')}</p>
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium text-gray-700">{t('reports.ledgerYear')}
        <select className="input mt-1 block" value={year} onChange={(event) => setYear(Number(event.target.value))}>
          {Array.from({ length: new Date().getFullYear() - 1999 }, (_, index) => new Date().getFullYear() - index)
            .map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button type="button" className="btn-primary flex items-center gap-2" disabled={!tenantId || !data || isExporting}
        onClick={() => { void exportData({ year: String(year) }); }}>
        <Download size={16} />{t('reports.annualDownload')}
      </button>
    </div>
    {!tenantId ? <p className="text-sm text-gray-500">{t('reports.ledgerChooseTenant')}</p>
      : isLoading ? <p className="text-sm text-gray-500">{t('common.loading')}</p>
        : isError ? <button type="button" className="btn-secondary" onClick={() => { void refetch(); }}>{t('common.tryAgain')}</button>
          : data && <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                [t('reports.ledgerAcquisition'), data.ledger.acquisitions],
                [t('reports.ledgerDisposal'), data.ledger.disposals],
                [t('reports.annualNewFolders'), data.activity.newFolders],
                [t('reports.annualOrdersCreated'), createdOrders],
              ].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-gray-200 p-3">
                <div className="text-sm text-gray-600">{label}</div><div className="text-2xl font-semibold text-gray-900">{value}</div>
              </div>)}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="overflow-x-auto">
                <h3 className="mb-2 font-semibold text-gray-900">{t('reports.annualMonthlyActivity')}</h3>
                <table className="min-w-full text-sm">
                  <thead><tr className="border-b border-gray-200 text-left text-gray-600">
                    <th className="px-2 py-1">{t('reports.annualMonth')}</th>
                    <th className="px-2 py-1 text-right">{t('reports.ledgerAcquisition')}</th>
                    <th className="px-2 py-1 text-right">{t('reports.ledgerDisposal')}</th>
                  </tr></thead>
                  <tbody>{data.ledger.months.map((row) => <tr key={row.month} className="border-b border-gray-100">
                    <td className="px-2 py-1 capitalize">{monthLabel(row.month)}</td>
                    <td className="px-2 py-1 text-right">{row.acquisitions}</td>
                    <td className="px-2 py-1 text-right">{row.disposals}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <div className="space-y-3 text-sm">
                <h3 className="font-semibold text-gray-900">{t('reports.annualOtherActivity')}</h3>
                <p>{t('reports.annualNewHrFolders')}: <strong>{data.activity.newHrFolders}</strong></p>
                <p>{t('reports.annualOrdersCompleted')}: <strong>{data.activity.completedOrders}</strong></p>
                <p>{t('reports.annualInventories')}: <strong>{data.activity.inventorySessions}</strong></p>
                <h3 className="pt-3 font-semibold text-gray-900">{t('reports.annualCurrentState')}</h3>
                <p className="text-gray-500">{t('reports.annualCurrentNote')}</p>
                <p>{t('reports.annualCurrentBoxes')}: <strong>{data.current.boxes}</strong></p>
                <p>{t('reports.annualCurrentFolders')}: <strong>{data.current.folders}</strong></p>
                <p>{t('reports.annualCurrentHrFolders')}: <strong>{data.current.hrFolders}</strong></p>
              </div>
            </div>
            <p className="text-xs text-gray-500">{t('reports.annualSourceNote')}</p>
          </>}
  </section>;
}
