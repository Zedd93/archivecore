import { useState, useRef, useEffect, useMemo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { Search, MapPin, ChevronDown, Loader2, X } from 'lucide-react';

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
  id?: string;
  value?: string;
  onChange: (locationId: string) => void;
  onLocationChange?: (location: FlatLocation | null) => void;
  placeholder?: string;
  excludeTypes?: string[];
  excludeIds?: string[];
  tenantId?: string;
  className?: string;
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  warehouse: 'locations.typeWarehouse',
  zone: 'locations.typeZone',
  rack: 'locations.typeRack',
  shelf: 'locations.typeShelf',
  level: 'locations.typeLevel',
  slot: 'locations.typeSlot',
};

const TYPE_ICONS: Record<string, string> = {
  warehouse: '\u{1F3E2}',
  zone: '\u{1F4E6}',
  rack: '\u{1F5C4}\uFE0F',
  shelf: '\u{1F4DA}',
  level: '\u{21B3}',
  slot: '\u{1F4CD}',
};

const TYPE_BADGE_COLORS: Record<string, string> = {
  warehouse: 'badge-purple',
  zone: 'badge-blue',
  rack: 'badge-yellow',
  shelf: 'badge-green',
  level: 'badge-green',
  slot: 'badge-gray',
};

function flattenTree(nodes: LocationNode[], excludeTypes: string[], excludeIds: string[]): FlatLocation[] {
  const result: FlatLocation[] = [];

  function walk(list: LocationNode[]) {
    for (const node of list) {
      if (!excludeTypes.includes(node.type) && !excludeIds.includes(node.id)) {
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

function getParentPath(fullPath: string) {
  const parts = fullPath.split(' > ');
  return parts.length > 1 ? parts.slice(0, -1).join(' > ') : '';
}

function formatLocationLabel(loc: Pick<FlatLocation, 'code' | 'name'>) {
  return `${loc.code} — ${loc.name}`;
}

export default function LocationPicker({
  id,
  value,
  onChange,
  onLocationChange,
  placeholder,
  excludeTypes = [],
  excludeIds = [],
  tenantId,
  className = '',
}: LocationPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const activeTenantId = tenantId ?? localStorage.getItem('tenantId') ?? '';
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['locations-tree', activeTenantId || 'active'],
    queryFn: async () => {
      const { data } = await api.get('/locations/tree', {
        params: activeTenantId ? { tenantId: activeTenantId } : undefined,
      });
      return data.data as LocationNode[];
    },
  });

  const flatLocations = useMemo(() => {
    if (!tree) return [];
    return flattenTree(tree, excludeTypes, excludeIds);
  }, [tree, excludeTypes, excludeIds]);

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
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;

    function updateDropdownPosition() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropdownStyle({
        position: 'fixed',
        left: rect.left,
        top: rect.bottom + 4,
        width: rect.width,
        maxHeight: Math.max(160, Math.min(320, window.innerHeight - rect.bottom - 12)),
        zIndex: 90,
      });
    }

    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [open]);

  function handleSelect(loc: FlatLocation) {
    onChange(loc.id);
    onLocationChange?.(loc);
    setSearch('');
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
    onLocationChange?.(null);
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

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const displayValue = selectedLocation ? formatLocationLabel(selectedLocation) : '';
  const selectedParentPath = selectedLocation ? getParentPath(selectedLocation.fullPath) : '';
  const placeholderText = placeholder ?? t('locations.pickLocation', 'Select location...');
  const dropdown = (
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto"
    >
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white p-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            className="input-field h-9 pl-8 text-sm"
            placeholder={t('common.search', 'Search')}
            value={search}
            onChange={handleInputChange}
            onFocus={handleInputFocus}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />
        </div>
      </div>
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
            <span className="flex-shrink-0 pt-0.5">{TYPE_ICONS[loc.type] || '\u{1F4C1}'}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{formatLocationLabel(loc)}</span>
              <span className="block truncate text-xs text-gray-500" title={loc.fullPath}>
                {getParentPath(loc.fullPath) || loc.fullPath}
              </span>
            </span>
            <span className={`flex-shrink-0 ${TYPE_BADGE_COLORS[loc.type] || 'badge-gray'} text-xs`}>
              {t(TYPE_LABEL_KEYS[loc.type] || loc.type)}
            </span>
          </button>
        ))
      )}
    </div>
  );

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <button
          id={id}
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="input-field flex min-h-[42px] w-full items-center pl-9 pr-16 text-left"
          aria-haspopup="listbox"
          aria-expanded={open}
          title={selectedLocation?.fullPath}
        >
          <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          {selectedLocation ? (
            <span className="block min-w-0">
              <span className="block truncate text-gray-900">{displayValue}</span>
              {selectedParentPath && (
                <span className="block truncate text-xs text-gray-500">{selectedParentPath}</span>
              )}
            </span>
          ) : (
            <span className="block truncate text-gray-400">{placeholderText}</span>
          )}
        </button>
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {isLoading && <Loader2 size={14} className="animate-spin text-gray-400" />}
          {selectedLocation && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label={t('common.clear', 'Clear')}
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label={placeholderText}
          >
            <ChevronDown
              size={16}
              className={`transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {open && createPortal(dropdown, document.body)}
    </div>
  );
}
