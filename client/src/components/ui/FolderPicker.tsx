import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { FileSpreadsheet, FolderOpen, Loader2, X } from 'lucide-react';
import { normalizeDisplayText } from '@archivecore/shared';

export interface SelectedFolder {
  id: string;
  source: 'manual' | 'transfer_list';
  folderNumber?: string | null;
  title: string;
  categoryCode?: string | null;
  docType?: string | null;
  box?: { id: string; boxNumber: string; title?: string | null } | null;
  transferList?: { id: string; listNumber: string; title: string } | null;
}

interface FolderPickerProps {
  value?: SelectedFolder[];
  onChange: (folders: SelectedFolder[]) => void;
  placeholder?: string;
  className?: string;
  maxSelected?: number;
}

export default function FolderPicker({
  value = [],
  onChange,
  placeholder,
  className = '',
  maxSelected,
}: FolderPickerProps) {
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
    queryKey: ['folder-picker', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch.trim()) return [];
      const { data } = await api.get('/folders', {
        params: { search: debouncedSearch, limit: 10 },
      });
      return (data.data || []) as SelectedFolder[];
    },
    enabled: debouncedSearch.trim().length >= 1,
    staleTime: 30_000,
  });

  const selectedKeys = new Set(value.map((folder) => `${folder.source}:${folder.id}`));
  const filteredResults = results.filter((folder) => !selectedKeys.has(`${folder.source}:${folder.id}`));

  const selectFolder = (folder: SelectedFolder) => {
    const selected: SelectedFolder = {
      id: folder.id,
      source: folder.source,
      folderNumber: folder.folderNumber,
      title: folder.title,
      categoryCode: folder.categoryCode,
      docType: folder.docType,
      box: folder.box,
      transferList: folder.transferList,
    };
    onChange(maxSelected === 1 ? [selected] : [...value, selected]);
    setSearch('');
    setDebouncedSearch('');
    setOpen(false);
  };

  const removeFolder = (folder: SelectedFolder) => {
    onChange(value.filter((entry) => !(entry.id === folder.id && entry.source === folder.source)));
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map((folder) => (
            <span
              key={`${folder.source}-${folder.id}`}
              className="inline-flex items-center gap-1 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-md px-2 py-0.5 text-sm"
            >
              {folder.source === 'transfer_list' ? <FileSpreadsheet size={12} /> : <FolderOpen size={12} />}
              <span className="max-w-[260px] truncate">
                {folder.folderNumber ? `${folder.folderNumber} - ` : ''}{normalizeDisplayText(folder.title)}
              </span>
              <button
                type="button"
                onClick={() => removeFolder(folder)}
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
          <FolderOpen size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => {
              if (search) setOpen(true);
            }}
            placeholder={placeholder || t('loans.folderSearchPlaceholder')}
            className="input-field pl-9"
            autoComplete="off"
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
            filteredResults.map((folder) => (
              <button
                key={`${folder.source}-${folder.id}`}
                type="button"
                onClick={() => selectFolder(folder)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
              >
                <div className="text-sm font-medium text-gray-900 break-words">
                  {normalizeDisplayText(folder.title)}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {[
                    folder.source === 'transfer_list' ? t('loans.itemTypes.transfer_list_item') : t('loans.itemTypes.folder'),
                    folder.folderNumber,
                    folder.box?.boxNumber,
                    folder.transferList?.listNumber,
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
