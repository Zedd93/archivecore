import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Loader2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import FolderPicker, { SelectedFolder } from '@/components/ui/FolderPicker';
import { getApiErrorMessage } from '@/utils/apiError';

type Segment = {
  folderId: string;
  folderNumber: string;
  title: string;
  coverPage: number;
  firstPage: number;
  lastPage: number;
  source: 'qr' | 'manual';
};

type Preview = {
  checksumSha256: string;
  planHash: string;
  pageCount: number;
  segments: Segment[];
};

type SavedAttachment = { id: string; folderId: string; fileName: string };
type ManualSeparator = { id: string; page: string; folders: SelectedFolder[] };

export default function ScanBatchPage() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<SavedAttachment[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manualSeparators, setManualSeparators] = useState<ManualSeparator[]>([]);

  const changeManualSeparators = (next: ManualSeparator[]) => {
    setManualSeparators(next);
    setPreview(null);
    setConfirmed(false);
  };

  const chooseFile = (selected: File | null) => {
    setPreview(null);
    setSaved([]);
    setConfirmed(false);
    setManualSeparators([]);
    if (selected && (selected.type !== 'application/pdf' && !selected.name.toLowerCase().endsWith('.pdf') || selected.size > 20 * 1024 * 1024)) {
      setFile(null);
      toast.error(t('scanBatch.invalidFile'));
      return;
    }
    setFile(selected);
  };

  const openOriginal = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const tab = window.open(url, '_blank');
    if (tab) tab.opener = null;
    else toast.error(t('scanBatch.allowPopup'));
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const submit = async (commit: boolean) => {
    if (!file || (commit && (!preview || !confirmed))) return;
    const overrides = manualSeparators.map((separator) => ({
      page: Number(separator.page),
      folderId: separator.folders[0]?.id,
    }));
    if (overrides.some((item) => !Number.isInteger(item.page) || item.page < 1 || item.page > 20 || !item.folderId)
      || new Set(overrides.map((item) => item.page)).size !== overrides.length) {
      toast.error(t('scanBatch.incompleteManual'));
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('overrides', JSON.stringify(overrides));
      if (commit) {
        form.append('checksumSha256', preview!.checksumSha256);
        form.append('planHash', preview!.planHash);
      }
      const { data } = await api.post(`/attachments/scan-batch/${commit ? 'commit' : 'preview'}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (commit) {
        setSaved(data.data.attachments as SavedAttachment[]);
        setPreview(null);
        setConfirmed(false);
        toast.success(t('scanBatch.saved'));
      } else {
        setPreview(data.data as Preview);
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
      if (commit) setConfirmed(false);
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-6">
    <div>
      <Link to="/import" className="text-sm text-primary-700 hover:underline">{t('import.title')}</Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">{t('scanBatch.title')}</h1>
      <p className="mt-1 text-sm text-gray-600">{t('scanBatch.hint')}</p>
    </div>

    <div className="card space-y-4">
      <label htmlFor="scan-batch-file" className="block text-sm font-medium text-gray-700">{t('scanBatch.file')}</label>
      <input id="scan-batch-file" type="file" accept="application/pdf,.pdf" disabled={busy}
        onChange={(event) => chooseFile(event.target.files?.[0] || null)}
        className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-primary-50 file:px-4 file:py-2 file:text-primary-700" />
      {file && <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
        <span className="break-all"><FileText size={16} className="mr-2 inline" />{file.name}</span>
        <button type="button" className="text-primary-700 hover:underline" onClick={openOriginal}>{t('scanBatch.openPdf')}</button>
      </div>}
      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <h2 className="font-medium text-gray-900">{t('scanBatch.manualTitle')}</h2>
          <p className="text-sm text-gray-600">{t('scanBatch.manualHint')}</p>
        </div>
        {manualSeparators.map((separator) => <div key={separator.id} className="grid grid-cols-1 gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-start">
          <label className="text-sm text-gray-700">{t('scanBatch.page')}
            <input type="number" min="1" max="20" step="1" className="input-field mt-1" value={separator.page} disabled={busy}
              onChange={(event) => changeManualSeparators(manualSeparators.map((item) => item.id === separator.id ? { ...item, page: event.target.value } : item))} />
          </label>
          <div>
            <label htmlFor={`scan-batch-folder-${separator.id}`} className="block text-sm text-gray-700 mb-1">{t('scanBatch.folder')}</label>
            <FolderPicker id={`scan-batch-folder-${separator.id}`} value={separator.folders} maxSelected={1} disabled={busy} onChange={(folders) => changeManualSeparators(manualSeparators.map((item) => item.id === separator.id ? { ...item, folders } : item))} placeholder={t('scanBatch.pickFolder')} />
          </div>
          <button type="button" className="btn-secondary mt-0 sm:mt-6" disabled={busy} onClick={() => changeManualSeparators(manualSeparators.filter((item) => item.id !== separator.id))}>{t('scanBatch.removeSeparator')}</button>
        </div>)}
        <button type="button" className="btn-secondary" disabled={busy || manualSeparators.length >= 10}
          onClick={() => changeManualSeparators([...manualSeparators, { id: crypto.randomUUID(), page: '', folders: [] }])}>{t('scanBatch.addSeparator')}</button>
      </div>
      <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={!file || busy} onClick={() => void submit(false)}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}{t('scanBatch.preview')}
      </button>
    </div>

    {preview && <div className="card space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">{t('scanBatch.previewTitle')}</h2>
      <p className="text-sm text-gray-600">{t('scanBatch.summary', { pages: preview.pageCount, folders: preview.segments.length })}</p>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead><tr className="text-left text-gray-600"><th className="p-2">{t('scanBatch.coverPage')}</th><th className="p-2">{t('scanBatch.folder')}</th><th className="p-2">{t('scanBatch.documentPages')}</th></tr></thead>
          <tbody className="divide-y divide-gray-100">{preview.segments.map((segment) => <tr key={`${segment.folderId}-${segment.coverPage}`}>
            <td className="p-2">{segment.coverPage}{segment.source === 'manual' && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{t('scanBatch.manualBadge')}</span>}</td>
            <td className="p-2"><Link to={`/folders/${segment.folderId}`} className="text-primary-700 hover:underline break-words">{segment.folderNumber} · {segment.title}</Link></td>
            <td className="p-2 whitespace-nowrap">{segment.firstPage}–{segment.lastPage}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-sm text-amber-800 rounded-lg bg-amber-50 p-3">{t('scanBatch.reviewWarning')}</p>
      <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t('scanBatch.confirm')}</label>
      <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={!confirmed || busy} onClick={() => void submit(true)}>
        {busy && <Loader2 size={16} className="animate-spin" />}{t('scanBatch.save')}
      </button>
    </div>}

    {saved.length > 0 && <div className="card space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">{t('scanBatch.savedTitle')}</h2>
      <ul className="divide-y divide-gray-100">{saved.map((attachment) => <li key={attachment.id} className="py-2">
        <Link to={`/folders/${attachment.folderId}`} className="text-primary-700 hover:underline break-words">{attachment.fileName}</Link>
      </li>)}</ul>
    </div>}
  </div>;
}
