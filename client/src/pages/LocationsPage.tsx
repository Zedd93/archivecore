import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { MapPin, ChevronRight, ChevronDown, Box, Plus, Loader2 } from 'lucide-react';

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

// Translation keys for location types - resolved via t() at render time
const TYPE_LABEL_KEYS: Record<string, string> = {
  warehouse: 'locations.typeWarehouse', zone: 'locations.typeZone', rack: 'locations.typeRack', shelf: 'locations.typeShelf', slot: 'locations.typeSlot',
};
const TYPE_ICONS: Record<string, string> = {
  warehouse: '🏢', zone: '📦', rack: '🗄️', shelf: '📚', slot: '📍',
};

function LocationTree({ nodes, depth = 0 }: { nodes: LocationNode[]; depth?: number }) {
  return (
    <div className="space-y-1" role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map(node => (
        <LocationTreeNode key={node.id} node={node} depth={depth} />
      ))}
    </div>
  );
}

function LocationTreeNode({ node, depth }: { node: LocationNode; depth: number }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const occupancy = node.capacity ? Math.round((node.currentCount / node.capacity) * 100) : null;

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors`}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
        role="treeitem"
        tabIndex={0}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-label={`${node.name} (${t(TYPE_LABEL_KEYS[node.type])})`}
      >
        {hasChildren ? (
          expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />
        ) : (
          <span className="w-4" />
        )}
        <span className="text-base">{TYPE_ICONS[node.type] || '📁'}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-primary-700">{node.code}</span>
            <span className="text-sm text-gray-700">{node.name}</span>
            <span className="badge-gray text-xs">{t(TYPE_LABEL_KEYS[node.type])}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {node.capacity && (
            <span className="flex items-center gap-1">
              <Box size={12} />
              {node.currentCount}/{node.capacity}
            </span>
          )}
          {occupancy !== null && (
            <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${occupancy > 90 ? 'bg-red-500' : occupancy > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(occupancy, 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>
      {expanded && hasChildren && <LocationTree nodes={node.children} depth={depth + 1} />}
    </div>
  );
}

export default function LocationsPage() {
  const { t } = useTranslation();
  const { data: tree, isLoading } = useQuery({
    queryKey: ['locations-tree'],
    queryFn: async () => {
      const { data } = await api.get('/locations/tree');
      return data.data as LocationNode[];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('locations.title')}</h1>
          <p className="text-sm text-gray-500">{t('locations.subtitle')}</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus size={16} /> {t('locations.add')}
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary-500" size={32} /></div>
        ) : tree && tree.length > 0 ? (
          <LocationTree nodes={tree} />
        ) : (
          <div className="text-center py-12 text-gray-500">
            <MapPin size={48} className="mx-auto mb-4 text-gray-300" />
            <p>{t('locations.empty')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
