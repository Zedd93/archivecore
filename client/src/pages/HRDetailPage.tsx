import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDetail, useUpdate } from '@/hooks/useApi';
import { Permissions } from '@archivecore/shared';
import { useAuth } from '@/contexts/AuthContext';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import ActivityTimeline from '@/components/ui/ActivityTimeline';
import ShareButton from '@/components/ui/ShareButton';
import { FileText, Lock, ShieldAlert, Pencil } from 'lucide-react';
import { SkeletonDetailPage } from '@/components/ui/Skeleton';

export default function HRDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [showRetentionEdit, setShowRetentionEdit] = useState(false);
  const [retentionForm, setRetentionForm] = useState({ employmentStart: '', employmentEnd: '', riaStatus: 'unknown', riaSubmittedAt: '', retentionReviewRequired: false });
  const [retentionError, setRetentionError] = useState('');
  const updateHR = useUpdate('/hr', ['hr', 'hr-folder'], t('hr.retentionUpdated'));

  const PART_LABELS: Record<string, string> = {
    A: t('hr.partA'), B: t('hr.partB'), C: t('hr.partC'), D: t('hr.partD'), E: t('hr.partE'),
  };
  const { data: folder, isLoading } = useDetail('hr-folder', '/hr', id);

  if (isLoading) return <SkeletonDetailPage />;
  if (!folder) return <div className="text-center py-12 text-gray-500">{t('hr.notFound')}</div>;

  const openRetentionEdit = () => {
    setRetentionForm({
      employmentStart: folder.employmentStart ? new Date(folder.employmentStart).toISOString().slice(0, 10) : '',
      employmentEnd: folder.employmentEnd ? new Date(folder.employmentEnd).toISOString().slice(0, 10) : '',
      riaStatus: folder.riaStatus || 'unknown',
      riaSubmittedAt: folder.riaSubmittedAt ? new Date(folder.riaSubmittedAt).toISOString().slice(0, 10) : '',
      retentionReviewRequired: folder.retentionReviewRequired || false,
    });
    setRetentionError('');
    setShowRetentionEdit(true);
  };

  const saveRetention = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRetentionError('');
    if (retentionForm.employmentStart && retentionForm.employmentEnd && retentionForm.employmentEnd < retentionForm.employmentStart) {
      setRetentionError(t('hr.endBeforeStart'));
      return;
    }
    if (retentionForm.riaStatus === 'submitted' && !retentionForm.riaSubmittedAt) {
      setRetentionError(t('hr.riaDateRequired'));
      return;
    }
    try {
      await updateHR.mutateAsync({
        id: folder.id,
        employmentStart: retentionForm.employmentStart || null,
        employmentEnd: retentionForm.employmentEnd || null,
        riaStatus: retentionForm.riaStatus,
        riaSubmittedAt: retentionForm.riaStatus === 'submitted' ? retentionForm.riaSubmittedAt || null : null,
        retentionReviewRequired: retentionForm.retentionReviewRequired,
      });
      setShowRetentionEdit(false);
    } catch {
      // The mutation displays the server error and keeps the form open.
    }
  };

  const editStartYear = Number(retentionForm.employmentStart.slice(0, 4));
  const editTransitional = editStartYear >= 1999 && editStartYear < 2019;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: t('hr.title'), to: '/hr' }, { label: `${folder.employeeLastName} ${folder.employeeFirstName}` }]} />

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">
              {folder.employeeLastName} {folder.employeeFirstName}
            </h1>
            <StatusBadge status={folder.employmentStatus} type="employment" />
            {folder.litigationHold && (
              <span className="badge-red flex items-center gap-1"><ShieldAlert size={12} /> {t('hr.legalHold')}</span>
            )}
          </div>
          <p className="text-gray-500 mt-1">{folder.department || '—'} / {folder.position || '—'}</p>
        </div>
        <ShareButton entityType="hr" entityId={folder.id} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Parts A-E */}
        <div className="lg:col-span-2 space-y-4">
          {folder.parts?.map((part: any) => (
            <div key={part.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  {t('hr.part')} {part.partCode} — {PART_LABELS[part.partCode] || part.description}
                </h2>
                <span className="badge-gray">{part.hrDocuments?.length || 0} {t('hr.docAbbr')}</span>
              </div>

              {part.hrDocuments?.length > 0 ? (
                <div className="space-y-2">
                  {part.hrDocuments.map((doc: any) => (
                    <div key={doc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-primary-50 rounded-lg flex items-center justify-center text-xs font-bold text-primary-600">
                          {doc.orderNumber}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{doc.title}</div>
                          <div className="text-xs text-gray-500">
                            {doc.docType && <span>{doc.docType} • </span>}
                            {doc.docDate && <span>{new Date(doc.docDate).toLocaleDateString('pl-PL')} • </span>}
                            {doc.pageCount && <span>{doc.pageCount} {t('hr.page')}</span>}
                          </div>
                        </div>
                      </div>
                      {doc.attachment && (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <FileText size={12} /> {doc.attachment.fileName}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">{t('hr.noDocuments')}</p>
              )}
            </div>
          ))}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('hr.personalData')}</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('hr.createModal.pesel')}</dt>
                <dd className="flex items-center gap-1 font-mono">
                  <Lock size={12} className="text-gray-400" />
                  {folder.employeePeselDecrypted || folder.employeePesel}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('hr.documentNumber')}</dt>
                <dd>{folder.employeeIdNumber || '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('hr.createModal.department')}</dt>
                <dd>{folder.department || '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('hr.createModal.position')}</dt>
                <dd>{folder.position || '—'}</dd>
              </div>
            </dl>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('hr.employment')}</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('hr.startDate')}</dt>
                <dd>{folder.employmentStart ? new Date(folder.employmentStart).toLocaleDateString('pl-PL') : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('hr.endDate')}</dt>
                <dd>{folder.employmentEnd ? new Date(folder.employmentEnd).toLocaleDateString('pl-PL') : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('hr.storageForm')}</dt>
                <dd>{folder.storageForm === 'digital' ? t('hr.formElectronic') : folder.storageForm === 'hybrid' ? t('hr.formHybrid') : t('hr.formPaper')}</dd>
              </div>
            </dl>
          </div>

          <div className="card">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-gray-700">{t('hr.retentionSidebar')}</h3>
              {hasPermission(Permissions.HR_WRITE) && <button type="button" onClick={openRetentionEdit} className="btn-secondary text-xs"><Pencil size={14} />{t('common.edit')}</button>}
            </div>
            {folder.retentionBasis === 'needs_review' && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800 mb-3">{t('hr.needsReviewHint')}</p>}
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('hr.period')}</dt>
                <dd className="font-medium">{folder.retentionBasis === 'needs_review' ? t('hr.needsReview') : folder.retentionPeriod === 'fifty_years' ? t('hr.retention50') : t('hr.retention10')}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">{t('hr.calculationBasis')}</dt>
                <dd className="text-right">{t(`hr.basis.${folder.retentionBasis || 'needs_review'}`)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('hr.deadline')}</dt>
                <dd>{folder.retentionBasis !== 'needs_review' && folder.retentionEndDate ? new Date(folder.retentionEndDate).toLocaleDateString('pl-PL') : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{t('hr.legalHoldSidebar')}</dt>
                <dd className={folder.litigationHold ? 'text-red-600 font-medium' : ''}>
                  {folder.litigationHold ? t('hr.legalHoldYes') : t('hr.legalHoldNo')}
                </dd>
              </div>
            </dl>
          </div>

          {folder.box && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('hr.box')}</h3>
              <div className="text-sm">
                <span className="font-mono font-medium text-primary-700">{folder.box.boxNumber}</span>
                <span className="text-gray-500 ml-2">{folder.box.title}</span>
              </div>
            </div>
          )}

          {/* Activity Timeline */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('boxes.changeHistory')}</h3>
            <ActivityTimeline entityType="hr" entityId={folder.id} />
          </div>
        </div>
      </div>

      <Modal isOpen={showRetentionEdit} onClose={() => setShowRetentionEdit(false)} title={t('hr.editRetentionTitle')} size="md">
        <form onSubmit={saveRetention} className="space-y-4">
          <p className="text-sm text-amber-800">{t('hr.retentionHint')}</p>
          <div>
            <label htmlFor="hr-edit-start" className="label-text">{t('hr.startDate')}</label>
            <input id="hr-edit-start" type="date" className="input-field" value={retentionForm.employmentStart} onChange={(e) => {
              const year = Number(e.target.value.slice(0, 4));
              setRetentionForm({ ...retentionForm, employmentStart: e.target.value, ...(year >= 1999 && year < 2019 ? {} : { riaStatus: 'unknown', riaSubmittedAt: '' }) });
            }} />
          </div>
          <div>
            <label htmlFor="hr-edit-end" className="label-text">{t('hr.endDate')}</label>
            <input id="hr-edit-end" type="date" className="input-field" value={retentionForm.employmentEnd} onChange={(e) => setRetentionForm({ ...retentionForm, employmentEnd: e.target.value })} />
          </div>
          {editTransitional && <>
            <div>
              <label htmlFor="hr-edit-ria" className="label-text">{t('hr.riaStatus')}</label>
              <select id="hr-edit-ria" className="input-field" value={retentionForm.riaStatus} onChange={(e) => setRetentionForm({ ...retentionForm, riaStatus: e.target.value, riaSubmittedAt: '' })}>
                <option value="unknown">{t('hr.riaUnknown')}</option>
                <option value="not_submitted">{t('hr.riaNotSubmitted')}</option>
                <option value="submitted">{t('hr.riaSubmitted')}</option>
              </select>
            </div>
            {retentionForm.riaStatus === 'submitted' && <div>
              <label htmlFor="hr-edit-ria-date" className="label-text">{t('hr.riaSubmittedAt')} *</label>
              <input id="hr-edit-ria-date" type="date" className="input-field" value={retentionForm.riaSubmittedAt} onChange={(e) => setRetentionForm({ ...retentionForm, riaSubmittedAt: e.target.value })} required />
            </div>}
          </>}
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={retentionForm.retentionReviewRequired} onChange={(e) => setRetentionForm({ ...retentionForm, retentionReviewRequired: e.target.checked })} />
            <span>{t('hr.manualReviewRequired')}</span>
          </label>
          {retentionError && <p role="alert" className="text-sm text-red-600">{retentionError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowRetentionEdit(false)} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={updateHR.isPending} className="btn-primary">{updateHR.isPending ? t('common.processing') : t('common.save')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
