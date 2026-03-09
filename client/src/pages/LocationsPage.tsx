import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
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
  const navigate = useNavigate();
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
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/boxes?locationId=${node.id}`); }}
            className="text-xs text-primary-600 hover:text-primary-800 whitespace-nowrap"
            title={t('boxes.title')}
          >
            <Box size={14} />
          </button>
        </div>
      </div>
      {expanded && hasChildren && <LocationTree nodes={node.children} depth={depth + 1} />}
    </div>
  );
}

export default function LocationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', code: '', type: 'warehouse', parentId: '', capacity: '' });
  const [creating, setCreating] = useState(false);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['locations-tree'],
    queryFn: async () => {
      const { data } = await api.get('/locations/tree');
      return data.data as LocationNode[];
    },
  });

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/locations', {
        name: createForm.name,
        code: createForm.code,
        type: createForm.type,
        parentId: createForm.parentId || undefined,
        capacity: createForm.capacity ? parseInt(createForm.capacity) : undefined,
      });
      toast.success(t('common.success'));
      setShowCreateModal(false);
      setCreateForm({ name: '', code: '', type: 'warehouse', parentId: '', capacity: '' });
      queryClient.invalidateQueries({ queryKey: ['locations-tree'] });
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('common.genericError'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('locations.title')}</h1>
          <p className="text-sm text-gray-500">{t('locations.subtitle')}</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2">
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

      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title={t('locations.add')}>
        <form onSubmit={handleCreateLocation} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">{t('common.name')}</label>
              <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className="input-field" required />
            </div>
            <div>
              <label className="label-text">Kod</label>
              <input value={createForm.code} onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })} className="input-field" required placeholder="np. MAG-A" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">{t('common.type')}</label>
              <select value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })} className="input-field">
                <option value="warehouse">{t('locations.typeWarehouse')}</option>
                <option value="zone">{t('locations.typeZone')}</option>
                <option value="rack">{t('locations.typeRack')}</option>
                <option value="shelf">{t('locations.typeShelf')}</option>
                <option value="slot">{t('locations.typeSlot')}</option>
              </select>
            </div>
            <div>
              <label className="label-text">Pojemność</label>
              <input type="number" min={0} value={createForm.capacity} onChange={(e) => setCreateForm({ ...createForm, capacity: e.target.value })} className="input-field" placeholder="opcjonalnie" />
            </div>
          </div>
          <div>
            <label className="label-text">ID lokalizacji nadrzędnej</label>
            <input value={createForm.parentId} onChange={(e) => setCreateForm({ ...createForm, parentId: e.target.value })} className="input-field" placeholder="opcjonalnie — UUID" />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? t('common.creating') : t('common.create')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
