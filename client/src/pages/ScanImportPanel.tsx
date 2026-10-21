import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { getApiErrorMessage } from '@/utils/apiError';
import { draftScanPages, emptyScanRow, ScanRow } from './scan-import.util';

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
  const [pageTexts, setPageTexts] = useState<string[]>([]);
  const [pages, setPages] = useState(0);
  const [workingPage, setWorkingPage] = useState(0);
  const [emptyPages, setEmptyPages] = useState<number[]>([]);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  const selectFile = (next: File | null) => {
    setFile(next);
    setTitle(next?.name.replace(/\.[^.]+$/, '') || '');
    setPageTexts([]);
    setPages(0);
    setWorkingPage(0);
    setEmptyPages([]);
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
    let currentPage = 1;
    try {
      const recognized: string[] = [];
      let totalPages = 0;
      do {
        setWorkingPage(currentPage);
        const data = new FormData();
        data.append('file', file);
        const response = await api.post(`/import/transfer-lists/scan/recognize?page=${currentPage}`, data, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (currentPage === 1) {
          totalPages = response.data.data.pages;
          setPages(totalPages);
        } else if (response.data.data.pages !== totalPages) {
          throw new Error(t('import.scanPageCountChanged'));
        }
        recognized.push(response.data.data.text);
        currentPage++;
      } while (currentPage <= totalPages);
      setPageTexts(recognized);
      setEmptyPages([]);
      setRows([]);
      setConfirmed(false);
    } catch (error) {
      toast.error(t('import.scanPageError', { page: currentPage, message: getApiErrorMessage(error, t('common.genericError')) }));
    } finally {
      setWorking(false);
      setWorkingPage(0);
    }
  };

  const convert = () => {
    const { rows: next, missingPage, tooMany } = draftScanPages(pageTexts, emptyPages);
    if (missingPage !== null) {
      toast.error(t('import.scanPageWithoutRows', { page: missingPage }));
      return;
    }
    if (tooMany) {
      setRows([]);
      setConfirmed(false);
      toast.error(t('import.scanTooManyRows'));
      return;
    }
    setRows(next);
    setConfirmed(false);
    if (!next.length) toast.error(t('import.scanNoRows'));
  };

  const updateRow = <K extends keyof ScanRow>(index: number, field: K, value: ScanRow[K]) => {
    setRows((previous) => previous.map((row, i) => i === index ? {
      ...row,
      [field]: value,
      ...(field === 'dateRangeUnknown' && value === true ? { dateFrom: '', dateTo: '' } : {}),
      ...((field === 'dateFrom' || field === 'dateTo') && value ? { dateRangeUnknown: false } : {}),
    } : row));
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
        dateRangeUnknown: row.dateRangeUnknown,
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
      {file && pageTexts.length === 0 && (
        <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={working} onClick={recognize}>
          {working && <Loader2 size={16} className="animate-spin" />}
          {working ? t('import.scanRecognizingPage', { page: workingPage, pages: pages || '?' }) : t('import.scanRecognize')}
        </button>
      )}
      {pageTexts.length > 0 && (
        <>
          <p className="text-sm text-amber-800 rounded-lg bg-amber-50 p-3">{t('import.scanReviewWarning', { pages })}</p>
          <p className="text-sm text-amber-800 rounded-lg bg-amber-50 p-3">{t('import.scanParsedFieldsWarning')}</p>
          {pageTexts.map((text, index) => (
            <div key={index} className="space-y-2 rounded-lg border border-gray-200 p-3">
              <label className="block text-sm font-medium text-gray-700">
                {t('import.scanOcrText')} - {t('import.scanPage', { page: index + 1, pages })}
                <textarea className="input-field mt-1 min-h-40 font-mono text-xs" value={text}
                  onChange={(event) => {
                    setPageTexts((previous) => previous.map((value, pageIndex) => pageIndex === index ? event.target.value : value));
                    setEmptyPages((previous) => previous.filter((page) => page !== index + 1));
                    setRows([]);
                    setConfirmed(false);
                  }} />
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={emptyPages.includes(index + 1)}
                  onChange={(event) => {
                    setEmptyPages((previous) => event.target.checked ? [...previous, index + 1] : previous.filter((page) => page !== index + 1));
                    setRows([]);
                    setConfirmed(false);
                  }} />
                {t('import.scanPageNoItems')}
              </label>
            </div>
          ))}
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
                  <span className="text-sm font-semibold">{t('import.mappingRow', { number: index + 1 })}{row.sourcePage ? ` - ${t('import.scanPage', { page: row.sourcePage, pages })}` : ''}</span>
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
                      <input type="date" className="input-field mt-1" value={row[field]} disabled={row.dateRangeUnknown}
                        onChange={(event) => updateRow(index, field, event.target.value)} />
                    </label>
                  ))}
                  <label className="text-xs text-gray-700">
                    {t('import.mappingFields.boxNumber')}
                    <input className="input-field mt-1" value={row.boxNumber} onChange={(event) => updateRow(index, 'boxNumber', event.target.value)} />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={row.dateRangeUnknown}
                    onChange={(event) => updateRow(index, 'dateRangeUnknown', event.target.checked)} />
                  {t('transferLists.detail.dateRangeUnknown')}
                </label>
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
