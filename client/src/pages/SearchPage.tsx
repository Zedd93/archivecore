import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { useSearch } from '@/hooks/useApi';
import api from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { OrderDraftItem, toOrderDraftItem } from '@/utils/orderDraft';
import { Permissions } from '@archivecore/shared';
import { Search, Box, FileText, UserCircle, FolderOpen, Loader2, ClipboardList, BookOpen } from 'lucide-react';

type EvidenceSource = {
  id: string;
  type: 'box' | 'folder' | 'document' | 'attachment';
  title: string;
  subtitle: string;
  href: string;
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  box: <Box size={18} className="text-blue-500" />,
  folder: <FolderOpen size={18} className="text-yellow-600" />,
  document: <FileText size={18} className="text-green-500" />,
  hr_folder: <UserCircle size={18} className="text-purple-500" />,
};

const TYPE_LABEL_KEYS: Record<string, string> = {
  box: 'search.typeBox', folder: 'search.typeFolder', document: 'search.typeDocument', hr_folder: 'search.typeHr',
};

export default function SearchPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [orderItems, setOrderItems] = useState<OrderDraftItem[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const nextQuery = searchParams.get('q') || '';
    setQuery((current) => current === nextQuery ? current : nextQuery);
    setDebouncedQuery((current) => current === nextQuery ? current : nextQuery);
  }, [searchParams]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      if (query) setSearchParams({ q: query }, { replace: true });
      else setSearchParams({}, { replace: true });
    }, 400);
    return () => clearTimeout(timer);
  }, [query, setSearchParams]);

  const { data: results, isLoading } = useSearch(debouncedQuery, selectedTypes.length > 0 ? selectedTypes : undefined);
  const evidence = useMutation({
    mutationFn: async (term: string) => {
      const response = await api.get<{ data: { sources: EvidenceSource[] } }>('/search/evidence', { params: { q: term } });
      return { term, sources: response.data.data.sources };
    },
  });
  const evidenceSources = evidence.data?.term === query.trim() ? evidence.data.sources : undefined;

  const toggleType = (type: string) => {
    setSelectedTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };

  const toggleOrderItem = (item: OrderDraftItem) => {
    setOrderItems((items) => items.some((entry) => entry.type === item.type && entry.id === item.id)
      ? items.filter((entry) => !(entry.type === item.type && entry.id === item.id))
      : [...items, item]);
  };

  const openOrder = () => {
    const tenantId = user?.tenantId || localStorage.getItem('tenantId');
    if (!tenantId || orderItems.length === 0) return;
    navigate('/orders', { state: { orderDraft: { tenantId, items: orderItems } } });
  };

  const handleResultClick = (result: any) => {
    if (result.type === 'box') {
      navigate(`/boxes/${result.id}`);
      return;
    }
    if (result.type === 'hr_folder') {
      navigate(`/hr/${result.id}`);
      return;
    }
    if (result.metadata?.hrFolderId) {
      navigate(`/hr/${result.metadata.hrFolderId}`);
      return;
    }
    if (result.metadata?.source === 'attachment') {
      if (result.metadata.documentId) navigate(`/documents/${result.metadata.documentId}`);
      else if (result.metadata.folderId) navigate(`/folders/${result.metadata.folderId}`);
      else if (result.metadata.boxId) navigate(`/boxes/${result.metadata.boxId}`);
      return;
    }
    if (result.type === 'document') {
      navigate(`/documents/${result.id}`);
      return;
    }
    if (result.type === 'folder') {
      navigate(`/folders/${result.id}`);
      return;
    }
    const boxId = result.metadata?.boxId;
    if (boxId) {
      navigate(`/boxes/${boxId}`);
      return;
    }
    if (result.metadata?.transferListId) {
      navigate(`/transfer-lists/${result.metadata.transferListId}`);
    }
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

      <section className="card" aria-labelledby="evidence-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="evidence-heading" className="flex items-center gap-2 font-semibold text-gray-900">
              <BookOpen size={18} aria-hidden="true" /> {t('search.evidenceTitle')}
            </h2>
            <p className="mt-1 text-sm text-gray-500">{t('search.evidenceHint')}</p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => evidence.mutate(query.trim())}
            disabled={query.trim().length < 2 || query.trim().length > 200 || evidence.isPending}
          >
            {evidence.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
            {evidence.isPending ? t('search.evidenceLoading') : t('search.evidenceAction')}
          </button>
        </div>
        {evidence.isError && evidence.variables === query.trim() && (
          <p role="alert" className="mt-3 text-sm text-red-700">{t('search.evidenceError')}</p>
        )}
        {evidenceSources && (
          <div className="mt-4 border-t border-gray-200 pt-4" aria-live="polite">
            {evidenceSources.length === 0 ? (
              <p className="text-sm text-gray-700">{t('search.evidenceEmpty')}</p>
            ) : (
              <>
                <p className="text-sm text-gray-800">
                  {t('search.evidenceCount', { count: evidenceSources.length })}{' '}
                  {evidenceSources.length === 1 ? (
                    <>
                      {t('search.evidenceSingle')}{' '}
                      <Link to={evidenceSources[0].href} className="font-medium text-primary-700 underline hover:text-primary-900" aria-label={t('search.evidenceCitation', { number: 1, title: evidenceSources[0].title })}>{evidenceSources[0].title}</Link>
                      {evidenceSources[0].subtitle && ` — ${evidenceSources[0].subtitle}`}
                    </>
                  ) : t('search.evidenceMultiple')}
                </p>
                {evidenceSources.length === 10 && <p className="mt-2 text-sm text-gray-600">{t('search.evidenceLimit')}</p>}
                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">{t('search.evidenceSources')}</p>
                <ol className="mt-2 space-y-2">
                  {evidenceSources.map((source, index) => (
                    <li key={`${source.type}-${source.id}`} className="text-sm">
                      <Link to={source.href} className="text-primary-700 underline hover:text-primary-900">
                        [{index + 1}] {source.title}
                      </Link>
                      <span className="ml-2 text-gray-500">{source.subtitle}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <p className="mt-4 text-xs text-gray-500">{t('search.evidenceScope')}</p>
          </div>
        )}
      </section>

      {/* Results */}
      {isLoading && debouncedQuery.length >= 2 && (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-primary-500" size={32} />
        </div>
      )}

      {hasPermission(Permissions.ORDER_CREATE) && orderItems.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-gray-700">{t('search.orderSelected', { count: orderItems.length })}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOrderItems([])}>{t('search.clearSelection')}</button>
            <button type="button" className="btn-primary" onClick={openOrder}>
              <ClipboardList size={16} /> {t('search.createOrder')}
            </button>
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">
            {t('search.resultsCount', { count: results.total, item: results.total === 1 ? t('search.resultSingular') : t('search.resultPlural') })}
          </p>
          {results.results.map((result: any) => {
            const orderItem = toOrderDraftItem(result);
            const selected = orderItem && orderItems.some((item) => item.type === orderItem.type && item.id === orderItem.id);
            return <div key={`${result.type}-${result.id}`} className="card flex flex-col sm:flex-row sm:items-start gap-3 hover:border-primary-300 hover:shadow-md transition-all p-4">
              <button
                type="button"
                onClick={() => handleResultClick(result)}
                className="flex flex-1 min-w-0 items-start gap-4 text-left"
                aria-label={`${result.title} - ${t(TYPE_LABEL_KEYS[result.type])}`}
              >
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
                      {result.metadata.status && <span>{t('common.status')}: {t(`statuses.box.${result.metadata.status}`, { defaultValue: result.metadata.status })}</span>}
                      {result.metadata.department && <span>🏢 {result.metadata.department}</span>}
                      {result.metadata.docType && <span>📄 {t(`docTypes.${result.metadata.docType}`, { defaultValue: result.metadata.docType })}</span>}
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-400">
                  {Math.round(result.relevance * 100)}%
                </div>
              </button>
              {hasPermission(Permissions.ORDER_CREATE) && orderItem && (
                <button
                  type="button"
                  onClick={() => toggleOrderItem(orderItem)}
                  className={selected ? 'btn-primary shrink-0 justify-center' : 'btn-secondary shrink-0 justify-center'}
                  aria-pressed={!!selected}
                >
                  {selected ? t('search.removeFromOrder') : t('search.addToOrder')}
                </button>
              )}
            </div>;
          })}

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
