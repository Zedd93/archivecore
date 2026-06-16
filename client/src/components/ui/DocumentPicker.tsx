import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { FileText, Loader2, X } from 'lucide-react';

interface SelectedDocument {
  id: string;
  title: string;
  docType?: string | null;
  source?: 'document' | 'transfer_list_item';
  box?: { id: string; boxNumber: string } | null;
  folder?: { id: string; folderNumber: string; title?: string | null } | null;
  transferList?: { id: string; listNumber: string; title: string } | null;
}

interface DocumentPickerProps {
  value?: SelectedDocument[];
  onChange: (documents: SelectedDocument[]) => void;
  placeholder?: string;
  className?: string;
  maxSelected?: number;
}

export default function DocumentPicker({
  value = [],
  onChange,
  placeholder,
  className = '',
  maxSelected,
}: DocumentPickerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 300);
    setOpen(true);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['document-picker', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch.trim()) return [];
      const { data } = await api.get('/documents', {
        params: { search: debouncedSearch, limit: 10, loanable: true },
      });
      return (data.data || []) as SelectedDocument[];
    },
    enabled: debouncedSearch.trim().length >= 1,
    staleTime: 30_000,
  });

  const selectedIds = new Set(value.map((doc) => doc.id));
  const filteredResults = results.filter((doc) => !selectedIds.has(doc.id));

  const selectDocument = (doc: SelectedDocument) => {
    const selected = {
      id: doc.id,
      title: doc.title,
      docType: doc.docType,
      source: doc.source || 'document',
      box: doc.box,
      folder: doc.folder,
      transferList: doc.transferList,
    };
    onChange(maxSelected === 1 ? [selected] : [...value, selected]);
    setSearch('');
    setDebouncedSearch('');
    setOpen(false);
  };

  const removeDocument = (id: string) => {
    onChange(value.filter((doc) => doc.id !== id));
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map((doc) => (
            <span
              key={doc.id}
              className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 rounded-md px-2 py-0.5 text-sm"
            >
              <FileText size={12} />
              <span className="max-w-[220px] truncate">{doc.title}</span>
              <button
                type="button"
                onClick={() => removeDocument(doc.id)}
                className="hover:text-red-600"
                aria-label={t('common.remove', 'Usuń')}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {(!maxSelected || value.length < maxSelected) && (
        <div className="relative">
          <FileText size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => {
              if (search) setOpen(true);
            }}
            placeholder={placeholder || t('loans.documentSearchPlaceholder')}
            className="input-field pl-9"
          />
          {isFetching && (
            <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
          )}
        </div>
      )}

      {open && search.trim().length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {isFetching ? (
            <div className="p-3 text-sm text-gray-500 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> {t('common.loading')}
            </div>
          ) : filteredResults.length > 0 ? (
            filteredResults.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => selectDocument(doc)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
              >
                <div className="text-sm font-medium text-gray-900 truncate">{doc.title}</div>
                <div className="text-xs text-gray-500 truncate">
                  {[
                    doc.source === 'transfer_list_item' ? t('boxes.transferListItems', 'Pozycja spisu ZO') : t('loans.itemTypes.document'),
                    doc.folder?.folderNumber,
                    doc.box?.boxNumber,
                    doc.transferList?.listNumber,
                  ].filter(Boolean).join(' | ') || t('common.noData', 'Brak danych')}
                </div>
              </button>
            ))
          ) : (
            <div className="p-3 text-sm text-gray-500">{t('common.noResults', 'Brak wyników')}</div>
          )}
        </div>
      )}
    </div>
  );
}
