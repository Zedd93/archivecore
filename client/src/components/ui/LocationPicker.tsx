import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { MapPin, ChevronDown, Loader2, X } from 'lucide-react';

interface LocationNode {
  id: string;
  code: string;
  name: string;
  type: string;
  fullPath: string;
  capacity: number | null;
  currentCount: number;
  children: LocationNode[];
}

interface FlatLocation {
  id: string;
  code: string;
  name: string;
  type: string;
  fullPath: string;
}

interface LocationPickerProps {
  value?: string;
  onChange: (locationId: string) => void;
  placeholder?: string;
  excludeTypes?: string[];
  className?: string;
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  warehouse: 'locations.typeWarehouse',
  zone: 'locations.typeZone',
  rack: 'locations.typeRack',
  shelf: 'locations.typeShelf',
  slot: 'locations.typeSlot',
};

const TYPE_ICONS: Record<string, string> = {
  warehouse: '\u{1F3E2}',
  zone: '\u{1F4E6}',
  rack: '\u{1F5C4}\uFE0F',
  shelf: '\u{1F4DA}',
  slot: '\u{1F4CD}',
};

const TYPE_BADGE_COLORS: Record<string, string> = {
  warehouse: 'badge-purple',
  zone: 'badge-blue',
  rack: 'badge-yellow',
  shelf: 'badge-green',
  slot: 'badge-gray',
};

function flattenTree(nodes: LocationNode[], excludeTypes: string[]): FlatLocation[] {
  const result: FlatLocation[] = [];

  function walk(list: LocationNode[]) {
    for (const node of list) {
      if (!excludeTypes.includes(node.type)) {
        result.push({
          id: node.id,
          code: node.code,
          name: node.name,
          type: node.type,
          fullPath: node.fullPath,
        });
      }
      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  }

  walk(nodes);
  return result;
}

export default function LocationPicker({
  value,
  onChange,
  placeholder,
  excludeTypes = [],
  className = '',
}: LocationPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['locations-tree'],
    queryFn: async () => {
      const { data } = await api.get('/locations/tree');
      return data.data as LocationNode[];
    },
  });

  const flatLocations = useMemo(() => {
    if (!tree) return [];
    return flattenTree(tree, excludeTypes);
  }, [tree, excludeTypes]);

  const selectedLocation = useMemo(() => {
    if (!value) return null;
    return flatLocations.find((loc) => loc.id === value) ?? null;
  }, [value, flatLocations]);

  const filtered = useMemo(() => {
    if (!search.trim()) return flatLocations;
    const lower = search.toLowerCase();
    return flatLocations.filter(
      (loc) =>
        loc.fullPath.toLowerCase().includes(lower) ||
        loc.code.toLowerCase().includes(lower) ||
        loc.name.toLowerCase().includes(lower),
    );
  }, [search, flatLocations]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(loc: FlatLocation) {
    onChange(loc.id);
    setSearch('');
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
    setSearch('');
    setOpen(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    if (!open) setOpen(true);
  }

  function handleInputFocus() {
    setOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const displayValue = open ? search : selectedLocation?.fullPath ?? '';
  const placeholderText = placeholder ?? t('locations.pickLocation', 'Select location...');

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          className="input-field pl-9 pr-16"
          placeholder={placeholderText}
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {isLoading && <Loader2 size={14} className="animate-spin text-gray-400" />}
          {selectedLocation && !open && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label={t('common.clear', 'Clear')}
            >
              <X size={14} />
            </button>
          )}
          <ChevronDown
            size={16}
            className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={20} className="animate-spin text-primary-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500 text-center">
              {t('locations.noResults', 'No locations found')}
            </div>
          ) : (
            filtered.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => handleSelect(loc)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors flex items-center gap-2 ${
                  value === loc.id ? 'bg-primary-50 text-primary-700' : 'text-gray-700'
                }`}
              >
                <span className="flex-shrink-0">{TYPE_ICONS[loc.type] || '\u{1F4C1}'}</span>
                <span className="flex-1 truncate">{loc.fullPath}</span>
                <span className={`flex-shrink-0 ${TYPE_BADGE_COLORS[loc.type] || 'badge-gray'} text-xs`}>
                  {t(TYPE_LABEL_KEYS[loc.type] || loc.type)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
