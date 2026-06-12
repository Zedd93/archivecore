import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import LocationPicker from '@/components/ui/LocationPicker';
import { useAuth } from '@/contexts/AuthContext';
import { getApiErrorMessage } from '@/utils/apiError';
import { MapPin, ChevronRight, ChevronDown, Box, Plus, Loader2, Pencil } from 'lucide-react';

interface LocationNode {
  id: string;
  parentId: string | null;
  tenantId: string | null;
  code: string;
  name: string;
  type: string;
  fullPath: string;
  address: string | null;
  description: string | null;
  capacity: number | null;
  currentCount: number;
  aggregatedCount?: number;
  children: LocationNode[];
}

// Translation keys for location types - resolved via t() at render time
const TYPE_LABEL_KEYS: Record<string, string> = {
  warehouse: 'locations.typeWarehouse', zone: 'locations.typeZone', rack: 'locations.typeRack', shelf: 'locations.typeShelf', level: 'locations.typeLevel', slot: 'locations.typeSlot',
};
const TYPE_ICONS: Record<string, string> = {
  warehouse: '🏢', zone: '📦', rack: '🗄️', shelf: '📚', level: '↳', slot: '📍',
};

type LocationForm = {
  name: string;
  code: string;
  type: string;
  parentId: string;
  capacity: string;
  tenantId: string;
  address: string;
  description: string;
};

function collectLocationIds(node: LocationNode): string[] {
  return [node.id, ...node.children.flatMap(collectLocationIds)];
}

function findLocationById(nodes: LocationNode[] | undefined, id: string): LocationNode | null {
  if (!nodes || !id) return null;
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findLocationById(node.children, id);
    if (child) return child;
  }
  return null;
}

function LocationTree({
  nodes,
  depth = 0,
  canEdit,
  onEdit,
}: {
  nodes: LocationNode[];
  depth?: number;
  canEdit: boolean;
  onEdit: (node: LocationNode) => void;
}) {
  return (
    <div className="space-y-1" role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map(node => (
        <LocationTreeNode key={node.id} node={node} depth={depth} canEdit={canEdit} onEdit={onEdit} />
      ))}
    </div>
  );
}

function LocationTreeNode({
  node,
  depth,
  canEdit,
  onEdit,
}: {
  node: LocationNode;
  depth: number;
  canEdit: boolean;
  onEdit: (node: LocationNode) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const displayCount = node.aggregatedCount ?? node.currentCount;
  const occupancy = node.capacity ? Math.round((displayCount / node.capacity) * 100) : null;
  const openBoxes = () => navigate(`/boxes?locationId=${node.id}`);
  const toggleExpanded = () => setExpanded(prev => !prev);

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors`}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={openBoxes}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            openBoxes();
          }
          if (e.key === ' ') {
            e.preventDefault();
            toggleExpanded();
          }
        }}
        role="treeitem"
        tabIndex={0}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-label={`${node.name} (${t(TYPE_LABEL_KEYS[node.type])}) - ${t('boxes.title')}`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleExpanded(); }}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label={expanded ? t('common.collapse', 'Zwiń') : t('common.expand', 'Rozwiń')}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="text-base">{TYPE_ICONS[node.type] || '📁'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-primary-700">{node.code}</span>
            <span className="text-sm text-gray-700">{node.name}</span>
            <span className="badge-gray text-xs">{t(TYPE_LABEL_KEYS[node.type])}</span>
          </div>
          {node.address && (
            <div className="mt-1 inline-flex max-w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600">
              <MapPin size={12} className="mr-1 mt-0.5 flex-shrink-0" />
              <span className="truncate">{node.address}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {node.capacity && (
            <span className="flex items-center gap-1">
              <Box size={12} />
              {displayCount}/{node.capacity}
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
          {canEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(node); }}
              className="text-xs text-gray-500 hover:text-primary-700 whitespace-nowrap"
              title={t('common.edit')}
              aria-label={t('locations.edit')}
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>
      {expanded && hasChildren && (
        <LocationTree nodes={node.children} depth={depth + 1} canEdit={canEdit} onEdit={onEdit} />
      )}
    </div>
  );
}

export default function LocationsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  const canWriteLocations = hasPermission('location.write');
  const canSelectTenant = !user?.tenantId && (hasPermission('tenant.manage') || hasPermission('tenant.switch'));
  const activeTenantId = localStorage.getItem('tenantId') || '';
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<LocationNode | null>(null);
  const [createForm, setCreateForm] = useState<LocationForm>({ name: '', code: '', type: 'warehouse', parentId: '', capacity: '', tenantId: activeTenantId, address: '', description: '' });
  const [editForm, setEditForm] = useState<LocationForm>({ name: '', code: '', type: 'warehouse', parentId: '', capacity: '', tenantId: '', address: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['locations-tree'],
    queryFn: async () => {
      const { data } = await api.get('/locations/tree');
      return data.data as LocationNode[];
    },
  });

  const { data: tenants } = useQuery({
    queryKey: ['location-tenant-options'],
    queryFn: async () => {
      const { data } = await api.get('/tenants', { params: { page: 1, limit: 100 } });
      return data.data as Array<{ id: string; name: string; shortCode: string }>;
    },
    enabled: canSelectTenant && showCreateModal,
  });

  const resetCreateForm = () => {
    setCreateForm({ name: '', code: '', type: 'warehouse', parentId: '', capacity: '', tenantId: activeTenantId, address: '', description: '' });
  };

  const handleCreateParentChange = (parentId: string) => {
    const parent = findLocationById(tree, parentId);
    setCreateForm({
      ...createForm,
      parentId,
      address: parent?.address || '',
    });
  };

  const openEditModal = (location: LocationNode) => {
    setSelectedLocation(location);
    setEditForm({
      name: location.name,
      code: location.code,
      type: location.type,
      parentId: location.parentId || '',
      capacity: location.capacity?.toString() || '',
      tenantId: location.tenantId || activeTenantId,
      address: location.address || '',
      description: location.description || '',
    });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setSelectedLocation(null);
  };

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/locations', {
        name: createForm.name,
        code: createForm.code,
        type: createForm.type,
        tenantId: createForm.tenantId || undefined,
        parentId: createForm.parentId || undefined,
        address: createForm.address || undefined,
        description: createForm.description || undefined,
        capacity: createForm.capacity ? parseInt(createForm.capacity) : undefined,
      });
      toast.success(t('common.success'));
      setShowCreateModal(false);
      resetCreateForm();
      queryClient.invalidateQueries({ queryKey: ['locations-tree'] });
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('common.genericError')));
    } finally {
      setCreating(false);
    }
  };

  const handleEditLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocation) return;
    setSaving(true);
    try {
      const payload: Record<string, string | number | null> = {
        name: editForm.name,
        code: editForm.code,
        type: editForm.type,
        parentId: editForm.parentId || null,
        description: editForm.description || null,
        capacity: editForm.capacity ? parseInt(editForm.capacity) : null,
      };
      if (editForm.address.trim() || selectedLocation.address) {
        payload.address = editForm.address.trim() || null;
      }

      await api.put(`/locations/${selectedLocation.id}`, payload);
      toast.success(t('common.success'));
      closeEditModal();
      queryClient.invalidateQueries({ queryKey: ['locations-tree'] });
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('common.genericError')));
    } finally {
      setSaving(false);
    }
  };

  const editExcludedLocationIds = selectedLocation ? collectLocationIds(selectedLocation) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('locations.title')}</h1>
          <p className="text-sm text-gray-500">{t('locations.subtitle')}</p>
        </div>
        {canWriteLocations && (
          <button type="button" onClick={() => setShowCreateModal(true)} className="btn-primary w-full sm:w-auto">
            <Plus size={16} /> {t('locations.add')}
          </button>
        )}
      </div>

      <div className="card">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary-500" size={32} /></div>
        ) : tree && tree.length > 0 ? (
          <LocationTree nodes={tree} canEdit={canWriteLocations} onEdit={openEditModal} />
        ) : (
          <div className="text-center py-12 text-gray-500">
            <MapPin size={48} className="mx-auto mb-4 text-gray-300" />
            <p>{t('locations.empty')}</p>
          </div>
        )}
      </div>

      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          resetCreateForm();
        }}
        title={t('locations.add')}
      >
        <form onSubmit={handleCreateLocation} className="space-y-4">
          {canSelectTenant && (
            <div>
              <label className="label-text">{t('locations.tenant')}</label>
              <select
                value={createForm.tenantId}
                onChange={(e) => setCreateForm({ ...createForm, tenantId: e.target.value, parentId: '', address: '' })}
                className="input-field"
                required
              >
                <option value="">{t('locations.tenantPlaceholder')}</option>
                {tenants?.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} ({tenant.shortCode})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">{t('locations.tenantHint')}</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label-text">{t('common.name')}</label>
              <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className="input-field" required />
            </div>
            <div>
              <label className="label-text">Kod</label>
              <input value={createForm.code} onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })} className="input-field" required placeholder="np. MAG-A" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label-text">{t('common.type')}</label>
              <select value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })} className="input-field">
                <option value="warehouse">{t('locations.typeWarehouse')}</option>
                <option value="zone">{t('locations.typeZone')}</option>
                <option value="rack">{t('locations.typeRack')}</option>
                <option value="shelf">{t('locations.typeShelf')}</option>
                <option value="level">{t('locations.typeLevel')}</option>
                <option value="slot">{t('locations.typeSlot')}</option>
              </select>
            </div>
            <div>
              <label className="label-text">Pojemność</label>
              <input type="number" min={0} value={createForm.capacity} onChange={(e) => setCreateForm({ ...createForm, capacity: e.target.value })} className="input-field" placeholder="opcjonalnie" />
            </div>
          </div>
          <div>
            <label className="label-text">{t('locations.address')}</label>
            <textarea
              value={createForm.address}
              onChange={(e) => setCreateForm({ ...createForm, address: e.target.value })}
              className="input-field"
              rows={2}
              placeholder={t('locations.addressPlaceholder')}
            />
          </div>
          <div>
            <label className="label-text">{t('locations.parentLocation', 'Lokalizacja nadrzędna')}</label>
            <LocationPicker
              value={createForm.parentId}
              onChange={handleCreateParentChange}
              tenantId={createForm.tenantId || undefined}
              placeholder={t('locations.parentLocationPlaceholder', 'Opcjonalnie — wybierz magazyn, strefę lub regał')}
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={() => {
                setShowCreateModal(false);
                resetCreateForm();
              }}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? t('common.creating') : t('common.create')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showEditModal}
        onClose={closeEditModal}
        title={t('locations.edit')}
      >
        <form onSubmit={handleEditLocation} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label-text">{t('common.name')}</label>
              <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="input-field" required />
            </div>
            <div>
              <label className="label-text">Kod</label>
              <input value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} className="input-field" required />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label-text">{t('common.type')}</label>
              <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} className="input-field">
                <option value="warehouse">{t('locations.typeWarehouse')}</option>
                <option value="zone">{t('locations.typeZone')}</option>
                <option value="rack">{t('locations.typeRack')}</option>
                <option value="shelf">{t('locations.typeShelf')}</option>
                <option value="level">{t('locations.typeLevel')}</option>
                <option value="slot">{t('locations.typeSlot')}</option>
              </select>
            </div>
            <div>
              <label className="label-text">{t('locations.capacity')}</label>
              <input type="number" min={0} value={editForm.capacity} onChange={(e) => setEditForm({ ...editForm, capacity: e.target.value })} className="input-field" placeholder={t('common.optional')} />
            </div>
          </div>
          <div>
            <label className="label-text">{t('locations.address')}</label>
            <textarea
              value={editForm.address}
              onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
              className="input-field"
              rows={2}
              placeholder={t('locations.addressPlaceholder')}
            />
          </div>
          <div>
            <label className="label-text">{t('locations.description')}</label>
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              className="input-field"
              rows={2}
              placeholder={t('common.optional')}
            />
          </div>
          <div>
            <label className="label-text">{t('locations.parentLocation')}</label>
            <LocationPicker
              value={editForm.parentId}
              onChange={(parentId) => setEditForm({ ...editForm, parentId })}
              tenantId={editForm.tenantId || undefined}
              excludeIds={editExcludedLocationIds}
              placeholder={t('locations.parentLocationPlaceholder')}
            />
            <p className="text-xs text-gray-500 mt-1">{t('locations.parentEditHint')}</p>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={closeEditModal} className="btn-secondary">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
