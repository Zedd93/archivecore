import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSearch } from '@/hooks/useApi';
import { Search, Box, FileText, UserCircle, FolderOpen, Loader2 } from 'lucide-react';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  box: <Box size={18} className="text-blue-500" />,
  folder: <FolderOpen size={18} className="text-yellow-600" />,
  document: <FileText size={18} className="text-green-500" />,
  hr_folder: <UserCircle size={18} className="text-purple-500" />,
};

const TYPE_LABEL_KEYS: Record<string, string> = {
  box: 'search.typeBox', folder: 'search.typeFolder', document: 'search.typeDocument', hr_folder: 'search.typeHr',
};

const TYPE_ROUTES: Record<string, string> = {
  box: '/boxes', folder: '/boxes', document: '/boxes', hr_folder: '/hr',
};

export default function SearchPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      if (query) setSearchParams({ q: query });
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: results, isLoading } = useSearch(debouncedQuery, selectedTypes.length > 0 ? selectedTypes : undefined);

  const toggleType = (type: string) => {
    setSelectedTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };

  const handleResultClick = (result: any) => {
    const route = TYPE_ROUTES[result.type] || '/';
    navigate(`${route}/${result.id}`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('search.title')}</h1>
        <p className="text-sm text-gray-500">{t('search.subtitle')}</p>
      </div>

      {/* Search input */}
      <div className="card">
        <div className="relative">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary-500 focus:bg-white"
            autoFocus
            aria-label="Search across boxes, folders, documents, and HR records"
          />
        </div>

        {/* Type filters */}
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-gray-500">{t('search.filterLabel')}</span>
          {Object.entries(TYPE_LABEL_KEYS).map(([key, labelKey]) => (
            <button
              key={key}
              onClick={() => toggleType(key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedTypes.includes(key) ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {isLoading && debouncedQuery.length >= 2 && (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-primary-500" size={32} />
        </div>
      )}

      {results && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">
            {t('search.resultsCount', { count: results.total, item: results.total === 1 ? t('search.resultSingular') : t('search.resultPlural') })}
          </p>
          {results.results.map((result: any) => (
            <div
              key={`${result.type}-${result.id}`}
              onClick={() => handleResultClick(result)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleResultClick(result); } }}
              className="card cursor-pointer hover:border-primary-300 hover:shadow-md transition-all p-4"
              role="button"
              tabIndex={0}
              aria-label={`${result.title} - ${t(TYPE_LABEL_KEYS[result.type])}`}
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5">{TYPE_ICONS[result.type]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{result.title}</span>
                    <span className="badge-gray text-xs">{t(TYPE_LABEL_KEYS[result.type])}</span>
                    {result.relevance >= 0.9 && <span className="badge-green text-xs">{t('search.exact')}</span>}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{result.subtitle}</p>
                  {result.metadata && (
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      {result.metadata.boxNumber && <span>📦 {result.metadata.boxNumber}</span>}
                      {result.metadata.status && <span>Status: {result.metadata.status}</span>}
                      {result.metadata.department && <span>🏢 {result.metadata.department}</span>}
                      {result.metadata.docType && <span>📄 {result.metadata.docType}</span>}
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-400">
                  {Math.round(result.relevance * 100)}%
                </div>
              </div>
            </div>
          ))}

          {results.total === 0 && debouncedQuery.length >= 2 && (
            <div className="text-center py-12 text-gray-500">
              <Search size={48} className="mx-auto mb-4 text-gray-300" />
              <p>{t('search.noResults', { query: debouncedQuery })}</p>
              <p className="text-xs mt-2">{t('search.noResultsHint')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
