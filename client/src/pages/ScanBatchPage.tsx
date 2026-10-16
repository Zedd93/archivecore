import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Loader2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { getApiErrorMessage } from '@/utils/apiError';

type Segment = {
  folderId: string;
  folderNumber: string;
  title: string;
  coverPage: number;
  firstPage: number;
  lastPage: number;
};

type Preview = {
  checksumSha256: string;
  pageCount: number;
  segments: Segment[];
};

type SavedAttachment = { id: string; folderId: string; fileName: string };

export default function ScanBatchPage() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<SavedAttachment[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const chooseFile = (selected: File | null) => {
    setPreview(null);
    setSaved([]);
    setConfirmed(false);
    if (selected && (selected.type !== 'application/pdf' && !selected.name.toLowerCase().endsWith('.pdf') || selected.size > 20 * 1024 * 1024)) {
      setFile(null);
      toast.error(t('scanBatch.invalidFile'));
      return;
    }
    setFile(selected);
  };

  const submit = async (commit: boolean) => {
    if (!file || (commit && (!preview || !confirmed))) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (commit) form.append('checksumSha256', preview!.checksumSha256);
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
      {file && <p className="text-sm text-gray-600 break-all"><FileText size={16} className="mr-2 inline" />{file.name}</p>}
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
            <td className="p-2">{segment.coverPage}</td>
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
