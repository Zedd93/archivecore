import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { X, Box, Loader2 } from 'lucide-react';

interface SelectedBox {
  id: string;
  boxNumber: string;
}

interface BoxPickerProps {
  value?: SelectedBox[];
  onChange: (boxes: SelectedBox[]) => void;
  placeholder?: string;
  className?: string;
}

export default function BoxPicker({ value = [], onChange, placeholder, className = '' }: BoxPickerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 300);
    setOpen(true);
  }, []);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch boxes from API
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['box-picker', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch || debouncedSearch.length < 1) return [];
      const { data } = await api.get('/boxes', {
        params: { search: debouncedSearch, limit: 10 },
      });
      return (data.data || []) as Array<{ id: string; boxNumber: string; title?: string }>;
    },
    enabled: debouncedSearch.length >= 1,
    staleTime: 30_000,
  });

  // Filter out already-selected boxes
  const selectedIds = new Set(value.map((b) => b.id));
  const filteredResults = results.filter((box) => !selectedIds.has(box.id));

  const selectBox = (box: { id: string; boxNumber: string }) => {
    const next = [...value, { id: box.id, boxNumber: box.boxNumber }];
    onChange(next);
    setSearch('');
    setDebouncedSearch('');
    setOpen(false);
  };

  const removeBox = (id: string) => {
    onChange(value.filter((b) => b.id !== id));
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map((box) => (
            <span
              key={box.id}
              className="inline-flex items-center gap-1 bg-primary-50 text-primary-700 border border-primary-200 rounded-md px-2 py-0.5 text-sm font-mono"
            >
              <Box size={12} className="shrink-0" />
              {box.boxNumber}
              <button
                type="button"
                onClick={() => removeBox(box.id)}
                className="ml-0.5 p-0.5 rounded hover:bg-primary-200 transition-colors"
                aria-label={`${t('common.remove')} ${box.boxNumber}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Box size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => {
            if (search) setOpen(true);
          }}
          className="input-field pl-9"
          placeholder={placeholder || t('common.search')}
          autoComplete="off"
        />
        {isFetching && (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
        )}
      </div>

      {/* Dropdown */}
      {open && search.trim().length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 max-h-48 overflow-y-auto">
          {filteredResults.length > 0 ? (
            filteredResults.map((box) => (
              <button
                key={box.id}
                type="button"
                onClick={() => selectBox(box)}
                className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-sm border-b border-gray-50 last:border-0"
              >
                <Box size={14} className="text-primary-500 shrink-0" />
                <span className="font-mono font-medium text-gray-900">{box.boxNumber}</span>
                {box.title && (
                  <span className="text-gray-400 truncate text-xs">— {box.title}</span>
                )}
              </button>
            ))
          ) : (
            !isFetching && (
              <div className="px-3 py-2 text-xs text-gray-400 text-center">
                {t('common.noResults')}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
