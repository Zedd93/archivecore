import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useCreate } from '@/hooks/useApi';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Plus, Clock, AlertTriangle, Loader2 } from 'lucide-react';

export default function RetentionPage() {
  const { t } = useTranslation();
  const [showCreatePolicy, setShowCreatePolicy] = useState(false);
  const [reviewDays, setReviewDays] = useState(90);

  const { data: policies, isLoading: polLoading } = useQuery({
    queryKey: ['retention-policies'],
    queryFn: async () => { const { data } = await api.get('/retention/policies'); return data.data; },
  });

  const { data: reviewBoxes, isLoading: revLoading } = useQuery({
    queryKey: ['retention-review', reviewDays],
    queryFn: async () => { const { data } = await api.get('/retention/review', { params: { days: reviewDays } }); return data.data; },
  });

  const createPolicy = useCreate('/retention/policies', ['retention-policies'], t('admin.retention.policyCreated'));

  const policyColumns: Column<any>[] = [
    { key: 'name', header: t('common.name'), render: (item) => <span className="font-medium">{item.name}</span> },
    { key: 'docType', header: t('admin.retention.createModal.docType'), render: (item) => item.docType || t('common.all') },
    { key: 'retentionYears', header: t('admin.retention.createModal.period'), render: (item) => t('admin.retention.years', { count: item.retentionYears }) },
    {
      key: 'retentionTrigger',
      header: t('admin.retention.createModal.trigger'),
      render: (item) => item.retentionTrigger === 'end_date' ? t('admin.retention.createModal.triggerEndDate') : item.retentionTrigger === 'creation_date' ? t('admin.retention.createModal.triggerCreationDate') : item.retentionTrigger,
    },
    {
      key: 'isActive',
      header: t('common.status'),
      render: (item) => item.isActive ? <span className="badge-green">{t('admin.retention.statusActive')}</span> : <span className="badge-gray">{t('admin.retention.statusInactive')}</span>,
    },
    { key: '_count', header: t('boxes.title'), render: (item) => item._count?.boxes ?? 0 },
  ];

  const reviewColumns: Column<any>[] = [
    { key: 'boxNumber', header: t('boxes.boxNumber'), render: (item) => <span className="font-mono font-medium text-primary-700">{item.boxNumber}</span> },
    { key: 'title', header: t('common.title') },
    { key: 'location', header: t('boxes.location'), render: (item) => item.location?.fullPath || '—' },
    {
      key: 'retentionDate',
      header: t('boxes.retentionDate'),
      render: (item) => {
        const d = new Date(item.retentionDate);
        const isExpired = d < new Date();
        return <span className={isExpired ? 'text-red-600 font-medium' : ''}>{d.toLocaleDateString('pl-PL')}</span>;
      },
    },
    { key: 'retentionPolicy', header: t('admin.retention.policies'), render: (item) => item.retentionPolicy?.name || '—' },
    { key: 'status', header: t('common.status'), render: (item) => item.status },
  ];

  const handleCreatePolicy = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createPolicy.mutateAsync({
      name: fd.get('name'),
      docType: fd.get('docType') || undefined,
      retentionYears: parseInt(fd.get('retentionYears') as string),
      retentionTrigger: fd.get('retentionTrigger') || 'end_date',
      description: fd.get('description') || undefined,
    });
    setShowCreatePolicy(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Clock size={24} className="text-primary-600" /> {t('admin.retention.title')}
        </h1>
        <p className="text-sm text-gray-500">{t('admin.retention.subtitle')}</p>
      </div>

      {/* Policies */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('admin.retention.policies')}</h2>
          <button onClick={() => setShowCreatePolicy(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> {t('admin.retention.newPolicy')}
          </button>
        </div>
        <DataTable columns={policyColumns} data={policies || []} isLoading={polLoading} emptyMessage={t('admin.retention.noPolicies')} />
      </div>

      {/* Review */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <AlertTriangle size={20} className="text-orange-500" />
            {t('admin.retention.boxesReview')}
          </h2>
          <select value={reviewDays} onChange={(e) => setReviewDays(parseInt(e.target.value))} className="input-field w-40" aria-label={t('admin.retention.boxesReview')}>
            <option value="30">{t('admin.retention.next30')}</option>
            <option value="90">{t('admin.retention.next90')}</option>
            <option value="180">{t('admin.retention.next6m')}</option>
            <option value="365">{t('admin.retention.nextYear')}</option>
          </select>
        </div>
        {revLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={24} /></div>
        ) : (
          <DataTable columns={reviewColumns} data={reviewBoxes || []} emptyMessage={t('admin.retention.noBoxesInPeriod')} />
        )}
      </div>

      {/* Create Policy Modal */}
      <Modal isOpen={showCreatePolicy} onClose={() => setShowCreatePolicy(false)} title={t('admin.retention.createModal.title')} size="md">
        <form onSubmit={handleCreatePolicy} className="space-y-4">
          <div><label htmlFor="retention-create-name" className="label-text">{t('common.name')} *</label><input id="retention-create-name" name="name" className="input-field" required /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label htmlFor="retention-create-docType" className="label-text">{t('admin.retention.createModal.docType')}</label><input id="retention-create-docType" name="docType" className="input-field" placeholder="Np. akta_osobowe" /></div>
            <div><label htmlFor="retention-create-period" className="label-text">{t('admin.retention.createModal.period')} *</label><input id="retention-create-period" name="retentionYears" type="number" className="input-field" required min={1} max={100} /></div>
          </div>
          <div>
            <label htmlFor="retention-create-trigger" className="label-text">{t('admin.retention.createModal.trigger')}</label>
            <select id="retention-create-trigger" name="retentionTrigger" className="input-field">
              <option value="end_date">{t('admin.retention.createModal.triggerEndDate')}</option>
              <option value="creation_date">{t('admin.retention.createModal.triggerCreationDate')}</option>
            </select>
          </div>
          <div><label htmlFor="retention-create-description" className="label-text">{t('admin.retention.createModal.description')}</label><textarea id="retention-create-description" name="description" className="input-field" rows={3} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowCreatePolicy(false)} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={createPolicy.isPending} className="btn-primary">{createPolicy.isPending ? t('common.creating') : t('common.create')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
