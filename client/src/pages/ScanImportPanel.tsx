import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { getApiErrorMessage } from '@/utils/apiError';
import { draftScanRows, emptyScanRow, ScanRow } from './scan-import.util';

interface ScanResult {
  imported: number;
  errors: { row: number; message: string }[];
  listId: string;
  listNumber: string;
}

export default function ScanImportPanel() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [pages, setPages] = useState(0);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  const selectFile = (next: File | null) => {
    setFile(next);
    setTitle(next?.name.replace(/\.[^.]+$/, '') || '');
    setOcrText('');
    setPages(0);
    setRows([]);
    setConfirmed(false);
    setResult(null);
  };

  const recognize = async () => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('import.scanTooLarge'));
      return;
    }
    setWorking(true);
    try {
      const data = new FormData();
      data.append('file', file);
      const response = await api.post('/import/transfer-lists/scan/recognize', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setOcrText(response.data.data.text);
      setPages(response.data.data.pages);
      setRows([]);
      setConfirmed(false);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
    } finally {
      setWorking(false);
    }
  };

  const convert = () => {
    const next = draftScanRows(ocrText);
    setRows(next);
    setConfirmed(false);
    if (!next.length) toast.error(t('import.scanNoRows'));
  };

  const updateRow = (index: number, field: keyof ScanRow, value: string) => {
    setRows((previous) => previous.map((row, i) => i === index ? { ...row, [field]: value } : row));
    setConfirmed(false);
  };

  const save = async () => {
    if (!confirmed || !rows.length) return;
    setSaving(true);
    try {
      const items = rows.map((row) => ({
        folderSignature: row.folderSignature.trim(),
        folderTitle: row.folderTitle.trim(),
        categoryCode: row.categoryCode.trim(),
        dateFrom: row.dateFrom || null,
        dateTo: row.dateTo || null,
        boxNumber: row.boxNumber.trim() || null,
        notes: row.notes.trim() || null,
        folderCount: 1,
      }));
      const response = await api.post('/import/transfer-lists/scan', { title: title.trim(), confirmed: true, items });
      setResult(response.data.data);
      toast.success(t('import.successMsg', { count: response.data.data.imported, total: rows.length }));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t('common.genericError')));
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <div className="card space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">{t('import.step4')}</h2>
        <p>{t('import.successMsg', { count: result.imported, total: rows.length })}</p>
        {result.errors.map((error) => <p key={error.row} className="text-sm text-red-700">{t('import.rowError', error)}</p>)}
        <div className="flex flex-wrap gap-3">
          <Link to={`/transfer-lists/${result.listId}`} className="btn-primary">{t('import.openTransferList')}</Link>
          <button type="button" className="btn-secondary" onClick={() => selectFile(null)}>{t('import.newImport')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{t('import.scanTitle')}</h2>
        <p className="text-sm text-gray-600">{t('import.scanHint')}</p>
      </div>
      <label className="block text-sm font-medium text-gray-700">
        {t('import.scanFile')}
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" className="input-field mt-1" disabled={working || saving}
          onChange={(event) => selectFile(event.target.files?.[0] || null)} />
      </label>
      {file && !ocrText && (
        <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={working} onClick={recognize}>
          {working && <Loader2 size={16} className="animate-spin" />}{t('import.scanRecognize')}
        </button>
      )}
      {ocrText && (
        <>
          <p className="text-sm text-amber-800 rounded-lg bg-amber-50 p-3">{t('import.scanReviewWarning', { pages })}</p>
          <label className="block text-sm font-medium text-gray-700">
            {t('import.scanOcrText')}
            <textarea className="input-field mt-1 min-h-48 font-mono text-xs" value={ocrText}
              onChange={(event) => { setOcrText(event.target.value); setRows([]); setConfirmed(false); }} />
          </label>
          <button type="button" className="btn-secondary" onClick={convert}>{t('import.scanDraftRows')}</button>
        </>
      )}
      {rows.length > 0 && (
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            {t('import.scanListTitle')}
            <input className="input-field mt-1" maxLength={500} value={title}
              onChange={(event) => { setTitle(event.target.value); setConfirmed(false); }} />
          </label>
          <p className="text-sm text-gray-600">{t('import.scanRowCount', { count: rows.length })}</p>
          <div className="max-h-[35rem] overflow-y-auto space-y-3">
            {rows.map((row, index) => (
              <div key={row.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold">{t('import.mappingRow', { number: index + 1 })}</span>
                  <button type="button" aria-label={t('import.scanRemoveRow', { number: index + 1 })} className="text-red-600"
                    onClick={() => { setRows((previous) => previous.filter((_, i) => i !== index)); setConfirmed(false); }}>
                    <Trash2 size={17} />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(['folderSignature', 'folderTitle', 'categoryCode'] as const).map((field) => (
                    <label key={field} className="text-xs text-gray-700">
                      {t(`import.mappingFields.${field}`)} *
                      <input className="input-field mt-1" value={row[field]} onChange={(event) => updateRow(index, field, event.target.value)} />
                    </label>
                  ))}
                  {(['dateFrom', 'dateTo'] as const).map((field) => (
                    <label key={field} className="text-xs text-gray-700">
                      {t(`import.mappingFields.${field}`)}
                      <input type="date" className="input-field mt-1" value={row[field]} onChange={(event) => updateRow(index, field, event.target.value)} />
                    </label>
                  ))}
                  <label className="text-xs text-gray-700">
                    {t('import.mappingFields.boxNumber')}
                    <input className="input-field mt-1" value={row.boxNumber} onChange={(event) => updateRow(index, 'boxNumber', event.target.value)} />
                  </label>
                </div>
                <label className="block text-xs text-gray-700">
                  {t('import.mappingFields.notes')}
                  <input className="input-field mt-1" value={row.notes} onChange={(event) => updateRow(index, 'notes', event.target.value)} />
                </label>
              </div>
            ))}
          </div>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={rows.length >= 500}
            onClick={() => { setRows((previous) => [...previous, emptyScanRow()]); setConfirmed(false); }}>
            <Plus size={16} />{t('import.scanAddRow')}
          </button>
          <p className="text-xs text-amber-800">{t('import.scanBoxWarning')}</p>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            {t('import.scanConfirm')}
          </label>
          <button type="button" className="btn-primary inline-flex items-center gap-2"
            disabled={saving || !confirmed || !title.trim() || rows.some((row) => !row.folderSignature.trim() || !row.folderTitle.trim() || !row.categoryCode.trim())}
            onClick={save}>
            {saving && <Loader2 size={16} className="animate-spin" />}{t('import.scanSave')}
          </button>
        </div>
      )}
    </div>
  );
}
