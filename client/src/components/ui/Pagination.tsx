import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: number[];
  onLimitChange?: (limit: number) => void;
}

export default function Pagination({
  page,
  limit,
  total,
  onPageChange,
  pageSizeOptions,
  onLimitChange,
}: PaginationProps) {
  const { t } = useTranslation();
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1 && !onLimitChange) return null;
  const start = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const end = Math.min(page * limit, total);

  const pages: (number | string)[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="text-sm text-gray-500">
          {t('common.pagination.showing', { start, end, total })}
        </div>
        {onLimitChange && pageSizeOptions && pageSizeOptions.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-gray-500">
            <span>{t('common.pagination.perPage')}</span>
            <select
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="input-field h-9 w-24 py-1 text-sm"
              aria-label={t('common.pagination.perPage')}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {totalPages > 1 && (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        {pages.map((p, i) =>
          typeof p === 'number' ? (
            <button
              key={i}
              onClick={() => onPageChange(p)}
              className={`w-8 h-8 rounded-lg text-sm font-medium ${
                p === page ? 'bg-primary-600 text-white' : 'hover:bg-gray-100 text-gray-700'
              }`}
            >
              {p}
            </button>
          ) : (
            <span key={i} className="px-1 text-gray-400">…</span>
          )
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      )}
    </div>
  );
}
