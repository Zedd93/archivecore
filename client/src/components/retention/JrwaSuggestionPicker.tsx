import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

export interface JrwaSuggestion {
  id: string;
  jrwaCode: string | null;
  name: string;
  archivalCategory: string | null;
  retentionYears: number | null;
  isPermanent: boolean;
  jrwaVersion: { label: string; validFrom: string; validTo: string | null } | null;
  matchType?: 'exactCode' | 'codePrefix' | 'name';
}

function codeFromSignature(signature: string) {
  return signature.trim().match(/^(\d{1,6})(?=\D|$)/)?.[1] || '';
}

export default function JrwaSuggestionPicker({ signature, value, existingPolicy, onChoose }: {
  signature: string;
  value: string;
  existingPolicy?: JrwaSuggestion | null;
  onChoose: (policy: JrwaSuggestion | null) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState(() => codeFromSignature(signature));
  const [chosen, setChosen] = useState<JrwaSuggestion | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const tenantId = localStorage.getItem('tenantId') || '';
  const hasSearch = debouncedSearch.length >= 2 || /^\d$/.test(debouncedSearch);
  const showSuggestions = hasSearch && search.trim() === debouncedSearch;

  useEffect(() => setSearch(codeFromSignature(signature)), [signature]);
  useEffect(() => { if (!value) setChosen(null); }, [value]);

  const { data: suggestions = [], isFetching, isError } = useQuery({
    queryKey: ['jrwa-suggestions', tenantId, debouncedSearch],
    queryFn: async () => {
      const { data } = await api.get('/transfer-lists/retention-suggestions', { params: { query: debouncedSearch } });
      return data.data as JrwaSuggestion[];
    },
    enabled: hasSearch,
  });

  const selected = value
    ? [chosen, existingPolicy, ...suggestions].find((policy) => policy?.id === value)
    : null;
  const periodLabel = (policy: JrwaSuggestion) => {
    if (policy.isPermanent) return t('transferLists.retentionSuggestion.permanent');
    const years = policy.retentionYears;
    if (!years) return t('transferLists.retentionSuggestion.review');
    if (years === 1) return t('admin.retention.yearOne', { count: years });
    const few = years % 10 >= 2 && years % 10 <= 4 && !(years % 100 >= 12 && years % 100 <= 14);
    return t(few ? 'admin.retention.yearFew' : 'admin.retention.years', { count: years });
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
      <label htmlFor="folder-jrwa-search" className="label-text">{t('transferLists.retentionSuggestion.label')}</label>
      <p className="text-xs text-blue-900">{t('transferLists.retentionSuggestion.hint')}</p>
      <input
        id="folder-jrwa-search"
        type="search"
        className="input-field"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('transferLists.retentionSuggestion.searchPlaceholder')}
        maxLength={100}
      />
      {selected && (
        <div className="flex items-start justify-between gap-2 rounded border border-blue-300 bg-white p-2 text-sm">
          <div>
            <strong>{selected.jrwaCode} · {selected.name}</strong>
            <div className="text-xs text-gray-600">{selected.archivalCategory} · {periodLabel(selected)} · {selected.jrwaVersion?.label || t('transferLists.retentionSuggestion.legacy')}</div>
          </div>
          <button type="button" className="text-xs text-blue-700 underline" onClick={() => onChoose(null)}>{t('transferLists.retentionSuggestion.clear')}</button>
        </div>
      )}
      {isFetching && <p className="text-xs text-gray-600">{t('common.loading')}</p>}
      {isError && <p role="alert" className="text-xs text-red-700">{t('transferLists.retentionSuggestion.loadError')}</p>}
      {showSuggestions && !isFetching && !isError && suggestions.length === 0 && <p className="text-xs text-gray-600">{t('transferLists.retentionSuggestion.none')}</p>}
      {showSuggestions && suggestions.length > 0 && (
        <ul className="max-h-44 overflow-auto rounded border border-gray-200 bg-white divide-y divide-gray-100">
          {suggestions.map((policy) => (
            <li key={policy.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 disabled:opacity-60"
                disabled={policy.id === value}
                onClick={() => { setChosen(policy); onChoose(policy); }}
              >
                <span className="font-mono font-medium">{policy.jrwaCode}</span> · {policy.name}
                {policy.matchType && <span className="block text-xs text-blue-800">{t(`transferLists.retentionSuggestion.match.${policy.matchType}`)}</span>}
                <span className="block text-xs text-gray-600">{policy.archivalCategory} · {periodLabel(policy)} · {policy.jrwaVersion?.label || t('transferLists.retentionSuggestion.legacy')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
