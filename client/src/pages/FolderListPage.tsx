import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, Box, FileSpreadsheet, FolderOpen, Search } from 'lucide-react';
import { useList } from '@/hooks/useApi';
import Pagination from '@/components/ui/Pagination';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { normalizeDisplayText } from '@archivecore/shared';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function formatYearRange(dateFrom?: string | null, dateTo?: string | null) {
  const from = dateFrom ? new Date(dateFrom).getFullYear() : null;
  const to = dateTo ? new Date(dateTo).getFullYear() : null;
  if (!from && !to) return '—';
  return `${from ?? '—'} – ${to ?? '—'}`;
}

export default function FolderListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');

  const params: Record<string, any> = { page, limit: pageSize };
  if (search) params.search = search;
  if (source) params.source = source;

  const { data, isLoading } = useList('folders', '/folders', params);
  const folders = data?.data || [];
  const pagination = data?.meta;

  const handlePageSizeChange = (limit: number) => {
    setPageSize(limit);
    setPage(1);
  };

  const openFolder = (folder: any) => {
    if (folder.source === 'transfer_list' && folder.transferList?.id) {
      navigate(`/transfer-lists/${folder.transferList.id}`);
      return;
    }
    if (folder.box?.id) {
      navigate(`/boxes/${folder.box.id}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('folders.title')}</h1>
        <p className="text-sm text-gray-500">{t('folders.subtitle')}</p>
      </div>

      <div className="card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={t('folders.searchPlaceholder')}
              className="input-field pl-10"
            />
          </div>
          <select
            value={source}
            onChange={(e) => { setSource(e.target.value); setPage(1); }}
            className="input-field lg:w-56"
          >
            <option value="">{t('folders.sourceAll')}</option>
            <option value="transfer_list">{t('folders.sourceTransferList')}</option>
            <option value="manual">{t('folders.sourceManual')}</option>
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <SkeletonTable rows={8} columns={7} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('folders.folder')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('folders.dateRange')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('folders.category')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('folders.box')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('folders.location')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('folders.source')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {folders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                        <FolderOpen size={40} className="mx-auto mb-2 text-gray-300" />
                        {t('folders.empty')}
                      </td>
                    </tr>
                  ) : folders.map((folder: any) => (
                    <tr
                      key={`${folder.source}-${folder.id}`}
                      onClick={() => openFolder(folder)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <FolderOpen size={18} className="mt-0.5 shrink-0 text-yellow-600" />
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 break-words">{normalizeDisplayText(folder.title)}</div>
                            <div className="mt-0.5 font-mono text-xs text-gray-500">{folder.folderNumber}</div>
                            {folder.folderCount > 1 && (
                              <div className="mt-1 text-xs text-gray-400">{t('folders.folderCount', { count: folder.folderCount })}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{formatYearRange(folder.dateFrom, folder.dateTo)}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{folder.categoryCode || folder.docType || '—'}</td>
                      <td className="px-4 py-3">
                        {folder.box ? (
                          <div className="flex items-start gap-2 text-xs text-primary-700">
                            <Box size={14} className="mt-0.5 shrink-0" />
                            <div>
                              <div className="font-medium">{folder.sourceBoxNumber || folder.box.boxNumber}</div>
                              {folder.sourceBoxNumber && folder.sourceBoxNumber !== folder.box.boxNumber && (
                                <div className="text-[10px] text-gray-400">{folder.box.boxNumber}</div>
                              )}
                            </div>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs whitespace-normal break-words">{folder.locationPath || '—'}</td>
                      <td className="px-4 py-3">
                        {folder.source === 'transfer_list' ? (
                          <div className="flex items-start gap-2 text-xs text-indigo-700">
                            <FileSpreadsheet size={14} className="mt-0.5 shrink-0" />
                            <div>
                              <div className="font-medium">{folder.transferList?.listNumber}</div>
                              <div className="text-gray-500">{folder.transferList?.title}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                            <Archive size={14} />
                            {t('folders.sourceManual')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination && (
              <div className="px-4 pb-4">
                <Pagination
                  page={page}
                  limit={pageSize}
                  total={pagination.total}
                  onPageChange={setPage}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onLimitChange={handlePageSizeChange}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
