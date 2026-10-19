import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Permissions } from '@archivecore/shared';
import api from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useExport } from '@/hooks/useExport';

type Kind = '' | 'acquisition' | 'disposal';

interface LedgerEntry {
  eventId: string;
  eventAt: string;
  kind: Exclude<Kind, ''>;
  boxId: string;
  boxNumber: string;
  title: string;
  location: string | null;
  reference: string | null;
}

interface LedgerResult {
  acquisitions: number;
  disposals: number;
  total: number;
  data: LedgerEntry[];
}

export default function AccessionLedgerSection() {
  const { t, i18n } = useTranslation();
  const { user, hasPermission } = useAuth();
  const tenantId = user?.tenantId || localStorage.getItem('tenantId') || '';
  const [year, setYear] = useState(new Date().getFullYear());
  const [kind, setKind] = useState<Kind>('');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const { exportData, isExporting } = useExport({ endpoint: '/reports/accession-ledger/export', defaultFilename: `ksiega-nabytkow-ubytkow-${year}.csv` });
  const { data, isLoading, isError, refetch } = useQuery<LedgerResult>({
    queryKey: ['accession-ledger', user?.id, tenantId, year, kind, page, pageSize],
    queryFn: async () => {
      const response = await api.get('/reports/accession-ledger', { params: { year, kind, page, pageSize } });
      return response.data.data;
    },
    enabled: Boolean(tenantId),
  });
  const dateLocale = i18n.language.startsWith('en') ? 'en-GB' : 'pl-PL';

  return <section className="card space-y-4">
    <div>
      <h2 className="text-lg font-semibold text-gray-900">{t('reports.ledgerTitle')}</h2>
      <p className="mt-1 text-sm text-gray-500">{t('reports.ledgerDescription')}</p>
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium text-gray-700">{t('reports.ledgerYear')}
        <select className="input mt-1 block" value={year} onChange={(event) => { setYear(Number(event.target.value)); setPage(1); }}>
          {Array.from({ length: new Date().getFullYear() - 1999 }, (_, index) => new Date().getFullYear() - index)
            .map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-gray-700">{t('reports.ledgerKind')}
        <select className="input mt-1 block" value={kind} onChange={(event) => { setKind(event.target.value as Kind); setPage(1); }}>
          <option value="">{t('common.all')}</option>
          <option value="acquisition">{t('reports.ledgerAcquisition')}</option>
          <option value="disposal">{t('reports.ledgerDisposal')}</option>
        </select>
      </label>
      <label className="text-sm font-medium text-gray-700">{t('common.pagination.perPage')}
        <select className="input mt-1 block" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
          {[25, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      {hasPermission(Permissions.REPORT_EXPORT) && <button type="button" className="btn-secondary flex items-center gap-2" disabled={!tenantId || isExporting || !data}
        onClick={() => { void exportData({ year: String(year), kind }); }}><Download size={16} />{t('reports.ledgerExport')}</button>}
    </div>
    {!tenantId ? <p className="text-sm text-gray-500">{t('reports.ledgerChooseTenant')}</p>
      : isLoading ? <p className="text-sm text-gray-500">{t('common.loading')}</p>
        : isError ? <button type="button" className="btn-secondary" onClick={() => { void refetch(); }}>{t('common.tryAgain')}</button>
          : data && <>
            <div className="flex flex-wrap gap-4 text-sm text-gray-700">
              <span>{t('reports.ledgerAcquisitionsCount', { count: data.acquisitions })}</span>
              <span>{t('reports.ledgerDisposalsCount', { count: data.disposals })}</span>
            </div>
            {data.data.length === 0 ? <p className="text-sm text-gray-500">{t('reports.ledgerEmpty')}</p> : <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-gray-200 text-left text-gray-600">
                  <th className="px-3 py-2">{t('common.date')}</th>
                  <th className="px-3 py-2">{t('common.type')}</th>
                  <th className="px-3 py-2">{t('reports.ledgerBox')}</th>
                  <th className="px-3 py-2">{t('reports.ledgerLocation')}</th>
                  <th className="px-3 py-2">{t('reports.ledgerReference')}</th>
                </tr></thead>
                <tbody>{data.data.map((entry) => <tr key={entry.eventId} className="border-b border-gray-100 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{new Intl.DateTimeFormat(dateLocale, { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(entry.eventAt))}</td>
                  <td className="px-3 py-2">{t(entry.kind === 'acquisition' ? 'reports.ledgerAcquisition' : 'reports.ledgerDisposal')}</td>
                  <td className="px-3 py-2 min-w-52"><Link className="text-primary-700 hover:underline" to={`/boxes/${entry.boxId}`}>{entry.boxNumber}</Link><span className="block text-gray-600 break-words">{entry.title}</span></td>
                  <td className="px-3 py-2 break-words">{entry.location || '—'}</td>
                  <td className="px-3 py-2 break-words">{entry.reference || '—'}</td>
                </tr>)}</tbody>
              </table>
            </div>}
            <div className="flex items-center justify-between gap-3 text-sm text-gray-600">
              <span>{t('common.pagination.showing', { start: data.total ? (page - 1) * pageSize + 1 : 0, end: Math.min(page * pageSize, data.total), total: data.total })}</span>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('common.previous')}</button>
                <button type="button" className="btn-secondary" disabled={page * pageSize >= data.total} onClick={() => setPage(page + 1)}>{t('common.next')}</button>
              </div>
            </div>
          </>}
  </section>;
}
