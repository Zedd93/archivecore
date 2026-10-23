import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { getApiErrorMessage } from '@/utils/apiError';
import { correctScanSourceOrdinal, draftScanPages, emptyScanRow, invalidScanDateRange, needsScanDateReview, scanBoxNumbers, scanContentDuplicateGroups, scanExpectedRowCountStatus, scanOrdinalIssueLocations, scanOrdinalIssues, ScanRow, validFolderCount, validScanBoxNumber, validScanSourceOrdinal } from './scan-import.util';

interface ScanResult {
  imported: number;
  errors: { row: number; message: string }[];
  listId: string;
  listNumber: string;
}

type PageDiagnostic = { page: number; source: 'embedded' | 'ocr'; reviewFlag: 'empty' | 'short' | 'replacement' | null };

const ordinalIssueTranslation = {
  gap: 'import.scanOrdinalGaps',
  duplicate: 'import.scanOrdinalDuplicates',
  unreadable: 'import.scanOrdinalUnreadableRows',
  outOfOrder: 'import.scanOrdinalOutOfOrderRows',
} as const;

export default function ScanImportPanel() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [pageTexts, setPageTexts] = useState<string[]>([]);
  const [pageDiagnostics, setPageDiagnostics] = useState<(PageDiagnostic | null)[]>([]);
  const [pages, setPages] = useState(0);
  const [workingPage, setWorkingPage] = useState(0);
  const [emptyPages, setEmptyPages] = useState<number[]>([]);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [expectedRowCount, setExpectedRowCount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [boxesConfirmed, setBoxesConfirmed] = useState(false);
  const [ordinalsConfirmed, setOrdinalsConfirmed] = useState(false);
  const [duplicatesConfirmed, setDuplicatesConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const boxNumbers = scanBoxNumbers(rows);
  const duplicateGroups = scanContentDuplicateGroups(rows);
  const ordinalIssues = scanOrdinalIssues(rows);
  const hasOrdinalIssues = ordinalIssues.gaps.length > 0 || ordinalIssues.duplicates.length > 0 || ordinalIssues.unreadableRows.length > 0 || ordinalIssues.outOfOrderRows.length > 0;
  const ordinalLocations = hasOrdinalIssues ? scanOrdinalIssueLocations(rows) : [];
  const hasSourceOrdinals = rows.some((row) => row.sourceOrdinalExpected || row.sourceOrdinal !== undefined);
  const hasInvalidSourceOrdinal = rows.some((row) => row.sourceOrdinalInput !== undefined && row.sourceOrdinalInput.trim() !== '' && !validScanSourceOrdinal(row.sourceOrdinalInput));
  const expectedRowCountStatus = scanExpectedRowCountStatus(expectedRowCount, rows.length);
  const expectedRowCountBlocksSave = expectedRowCountStatus === 'invalid' || expectedRowCountStatus === 'mismatch';

  const selectFile = (next: File | null) => {
    setFile(next);
    setTitle(next?.name.replace(/\.[^.]+$/, '') || '');
    setPageTexts([]);
    setPageDiagnostics([]);
    setPages(0);
    setWorkingPage(0);
    setEmptyPages([]);
    setRows([]);
    setExpectedRowCount('');
    setConfirmed(false);
    setBoxesConfirmed(false);
    setOrdinalsConfirmed(false);
    setDuplicatesConfirmed(false);
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
      const diagnostics: (PageDiagnostic | null)[] = [];
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
        diagnostics.push(response.data.data.pageDiagnostics?.[0] ?? null);
        currentPage++;
      } while (currentPage <= totalPages);
      setPageTexts(recognized);
      setPageDiagnostics(diagnostics);
      setEmptyPages([]);
      setRows([]);
      setConfirmed(false);
      setBoxesConfirmed(false);
      setOrdinalsConfirmed(false);
      setDuplicatesConfirmed(false);
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
      setBoxesConfirmed(false);
      setOrdinalsConfirmed(false);
      setDuplicatesConfirmed(false);
      toast.error(t('import.scanTooManyRows'));
      return;
    }
    setRows(next);
    setConfirmed(false);
    setBoxesConfirmed(false);
    setOrdinalsConfirmed(false);
    setDuplicatesConfirmed(false);
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
    setBoxesConfirmed(false);
    setOrdinalsConfirmed(false);
    setDuplicatesConfirmed(false);
  };

  const updateSourceOrdinal = (index: number, value: string) => {
    setRows((previous) => previous.map((row, i) => i === index ? correctScanSourceOrdinal(row, value) : row));
    setConfirmed(false);
    setBoxesConfirmed(false);
    setOrdinalsConfirmed(false);
    setDuplicatesConfirmed(false);
  };

  const save = async () => {
    if (!confirmed || !rows.length) return;
    if (rows.some((row) => !validFolderCount(row.folderCount))) {
      toast.error(t('import.scanFolderCountInvalid'));
      return;
    }
    if (rows.some(needsScanDateReview)) {
      toast.error(t('import.scanDateUnresolved'));
      return;
    }
    if (rows.some(invalidScanDateRange)) {
      toast.error(t('import.scanDateRangeInvalid'));
      return;
    }
    if (rows.some((row) => !validScanBoxNumber(row.boxNumber))) {
      toast.error(t('import.scanBoxNumberInvalid'));
      return;
    }
    if (hasInvalidSourceOrdinal) {
      toast.error(t('import.scanSourceOrdinalInvalid'));
      return;
    }
    if (expectedRowCountBlocksSave) {
      toast.error(t(expectedRowCountStatus === 'invalid' ? 'import.scanExpectedRowCountInvalid' : 'import.scanExpectedRowCountMismatch', { expected: expectedRowCount.trim(), actual: rows.length }));
      return;
    }
    if (boxNumbers.length && !boxesConfirmed) {
      toast.error(t('import.scanConfirmBoxes'));
      return;
    }
    if (hasOrdinalIssues && !ordinalsConfirmed) {
      toast.error(t('import.scanConfirmOrdinals'));
      return;
    }
    if (duplicateGroups.length && !duplicatesConfirmed) {
      toast.error(t('import.scanConfirmDuplicates'));
      return;
    }
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
        folderCount: Number(row.folderCount),
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
              {pageDiagnostics[index] && (
                <p className="text-xs text-gray-600">{t(pageDiagnostics[index].source === 'embedded' ? 'import.scanTextLayer' : 'import.scanLocalOcr')}</p>
              )}
              {pageDiagnostics[index]?.reviewFlag && (
                <p role="alert" className="text-sm text-red-800 rounded-lg bg-red-50 p-3">
                  {t(`import.scanReviewFlag.${pageDiagnostics[index].reviewFlag}`)}
                </p>
              )}
              <label className="block text-sm font-medium text-gray-700">
                {t('import.scanOcrText')} - {t('import.scanPage', { page: index + 1, pages })}
                <textarea className="input-field mt-1 min-h-40 font-mono text-xs" value={text}
                  onChange={(event) => {
                    setPageTexts((previous) => previous.map((value, pageIndex) => pageIndex === index ? event.target.value : value));
                    setEmptyPages((previous) => previous.filter((page) => page !== index + 1));
                    setRows([]);
                    setConfirmed(false);
                    setBoxesConfirmed(false);
                    setOrdinalsConfirmed(false);
                    setDuplicatesConfirmed(false);
                  }} />
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={emptyPages.includes(index + 1)}
                  onChange={(event) => {
                    setEmptyPages((previous) => event.target.checked ? [...previous, index + 1] : previous.filter((page) => page !== index + 1));
                    setRows([]);
                    setConfirmed(false);
                    setBoxesConfirmed(false);
                    setOrdinalsConfirmed(false);
                    setDuplicatesConfirmed(false);
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
          <label className="block max-w-sm text-sm font-medium text-gray-700">
            {t('import.scanExpectedRowCount')}
            <input className="input-field mt-1" type="text" inputMode="numeric" value={expectedRowCount}
              aria-invalid={expectedRowCountBlocksSave}
              onChange={(event) => { setExpectedRowCount(event.target.value); setConfirmed(false); setBoxesConfirmed(false); setOrdinalsConfirmed(false); setDuplicatesConfirmed(false); }} />
          </label>
          <p className="text-xs text-gray-600">{t('import.scanExpectedRowCountHint')}</p>
          {expectedRowCountStatus === 'invalid' && <p role="alert" className="text-sm text-red-700">{t('import.scanExpectedRowCountInvalid')}</p>}
          {expectedRowCountStatus === 'mismatch' && <p role="alert" className="text-sm text-red-700">{t('import.scanExpectedRowCountMismatch', { expected: expectedRowCount.trim(), actual: rows.length })}</p>}
          {expectedRowCountStatus === 'match' && <p className="text-sm text-green-700">{t('import.scanExpectedRowCountMatch', { count: rows.length })}</p>}
          {hasSourceOrdinals && <p className="text-xs text-gray-600">{t('import.scanSourceOrdinalHint')}</p>}
          {hasOrdinalIssues && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm text-amber-900">
              <p className="font-medium">{t('import.scanOrdinalReview')}</p>
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {ordinalLocations.map((issue, index) => (
                  <button key={`${issue.kind}-${issue.row}-${index}`} type="button" className="block text-left underline hover:text-amber-700"
                    onClick={() => {
                      const card = document.getElementById(`scan-row-${rows[issue.row - 1].id}`);
                      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      card?.querySelector('input')?.focus({ preventScroll: true });
                    }}>
                    {t(ordinalIssueTranslation[issue.kind], { values: issue.value })}
                    {' · '}{issue.page ? `${t('import.scanPage', { page: issue.page, pages })} · ` : ''}{t('import.mappingRow', { number: issue.row })}
                  </button>
                ))}
              </div>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={ordinalsConfirmed} onChange={(event) => setOrdinalsConfirmed(event.target.checked)} />
                {t('import.scanConfirmOrdinals')}
              </label>
            </div>
          )}
          {duplicateGroups.length > 0 && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm text-amber-900">
              <p className="font-medium">{t('import.scanDuplicateReview')}</p>
              <div className="max-h-36 space-y-2 overflow-y-auto">
                {duplicateGroups.map((group) => (
                  <div key={group.rows.join('-')}>
                    <p>{group.signature} - {group.title}</p>
                    <div className="flex flex-wrap gap-x-3">
                      {group.rows.map((rowNumber) => (
                        <button key={rowNumber} type="button" className="underline hover:text-amber-700"
                          onClick={() => {
                            const card = document.getElementById(`scan-row-${rows[rowNumber - 1].id}`);
                            card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            card?.querySelector('input')?.focus({ preventScroll: true });
                          }}>
                          {t('import.mappingRow', { number: rowNumber })}
                          {rows[rowNumber - 1].sourcePage ? ` · ${t('import.scanPage', { page: rows[rowNumber - 1].sourcePage, pages })}` : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={duplicatesConfirmed} onChange={(event) => setDuplicatesConfirmed(event.target.checked)} />
                {t('import.scanConfirmDuplicates')}
              </label>
            </div>
          )}
          <div className="max-h-[35rem] overflow-y-auto space-y-3">
            {rows.map((row, index) => (
              <div id={`scan-row-${row.id}`} key={row.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold">{t('import.mappingRow', { number: index + 1 })}{row.sourcePage ? ` - ${t('import.scanPage', { page: row.sourcePage, pages })}` : ''}{row.sourceOrdinal !== undefined ? ` - ${t('import.scanSourceOrdinal', { number: row.sourceOrdinal })}` : row.sourceOrdinalExpected ? ` - ${t('import.scanSourceOrdinalUnreadable')}` : ''}</span>
                  <button type="button" aria-label={t('import.scanRemoveRow', { number: index + 1 })} className="text-red-600"
                    onClick={() => { setRows((previous) => previous.filter((_, i) => i !== index)); setConfirmed(false); setBoxesConfirmed(false); setOrdinalsConfirmed(false); setDuplicatesConfirmed(false); }}>
                    <Trash2 size={17} />
                  </button>
                </div>
                {hasSourceOrdinals && (
                  <label className="block max-w-40 text-xs text-gray-700">
                    {t('import.scanSourceOrdinalEdit')}
                    <input className="input-field mt-1" type="text" inputMode="numeric" value={row.sourceOrdinalInput ?? row.sourceOrdinal?.toString() ?? ''}
                      aria-invalid={row.sourceOrdinalInput !== undefined && row.sourceOrdinalInput.trim() !== '' && !validScanSourceOrdinal(row.sourceOrdinalInput)}
                      onChange={(event) => updateSourceOrdinal(index, event.target.value)} />
                    {row.sourceOrdinalInput !== undefined && row.sourceOrdinalInput.trim() !== '' && !validScanSourceOrdinal(row.sourceOrdinalInput) && (
                      <span className="mt-1 block text-red-700">{t('import.scanSourceOrdinalInvalid')}</span>
                    )}
                  </label>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(['folderSignature', 'folderTitle', 'categoryCode'] as const).map((field) => (
                    <label key={field} className="text-xs text-gray-700">
                      {t(`import.mappingFields.${field}`)} *
                      <input className="input-field mt-1" value={row[field]} onChange={(event) => updateRow(index, field, event.target.value)} />
                      {field === 'categoryCode' && row.uncertainCategory && (
                        <span className="mt-1 block text-amber-800">{t('import.scanCategoryReview', { value: row.uncertainCategory })}</span>
                      )}
                    </label>
                  ))}
                  {(['dateFrom', 'dateTo'] as const).map((field) => (
                    <label key={field} className="text-xs text-gray-700">
                      {t(`import.mappingFields.${field}`)}
                      <input type="date" className="input-field mt-1" value={row[field]} disabled={row.dateRangeUnknown}
                        aria-invalid={invalidScanDateRange(row)}
                        onChange={(event) => updateRow(index, field, event.target.value)} />
                      {field === 'dateFrom' && row.uncertainDateRange && (
                        <span className="mt-1 block text-amber-800">{t('import.scanDateReview', { value: row.uncertainDateRange })}</span>
                      )}
                      {field === 'dateFrom' && row.uncertainDateFrom && (
                        <span className="mt-1 block text-amber-800">{t('import.scanDateReview', { value: row.uncertainDateFrom })}</span>
                      )}
                      {field === 'dateTo' && row.uncertainDateTo && (
                        <span className="mt-1 block text-amber-800">{t('import.scanDateReview', { value: row.uncertainDateTo })}</span>
                      )}
                    </label>
                  ))}
                  {invalidScanDateRange(row) && <p role="alert" className="sm:col-span-3 text-xs text-red-700">{t('import.scanDateRangeInvalid')}</p>}
                  <label className="text-xs text-gray-700">
                    {t('import.mappingFields.boxNumber')}
                    <input className="input-field mt-1" value={row.boxNumber} aria-invalid={!validScanBoxNumber(row.boxNumber)}
                      onChange={(event) => updateRow(index, 'boxNumber', event.target.value)} />
                    {!validScanBoxNumber(row.boxNumber) && <span className="text-red-700">{t('import.scanBoxNumberInvalid')}</span>}
                  </label>
                  <label className="text-xs text-gray-700">
                    {t('import.mappingFields.folderCount')} *
                    <input className="input-field mt-1" type="text" inputMode="numeric" value={row.folderCount}
                      aria-invalid={!validFolderCount(row.folderCount)}
                      onChange={(event) => updateRow(index, 'folderCount', event.target.value)} />
                    {!validFolderCount(row.folderCount) && <span className="text-red-700">{t('import.scanFolderCountInvalid')}</span>}
                    {row.uncertainFolderCount && (
                      <span className="mt-1 block text-amber-800">{t('import.scanCountReview', { value: row.uncertainFolderCount })}</span>
                    )}
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
            onClick={() => { setRows((previous) => [...previous, { ...emptyScanRow(), ...(hasSourceOrdinals ? { sourceOrdinalExpected: true } : {}) }]); setConfirmed(false); setBoxesConfirmed(false); setOrdinalsConfirmed(false); setDuplicatesConfirmed(false); }}>
            <Plus size={16} />{t('import.scanAddRow')}
          </button>
          <p className="text-xs text-amber-800">{t('import.scanBoxWarning')}</p>
          {boxNumbers.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-900">{t('import.scanBoxNumbersReview', { count: boxNumbers.length })}</p>
              <div className="max-h-28 overflow-y-auto break-words text-sm text-amber-900">{boxNumbers.join(', ')}</div>
              <label className="flex items-start gap-2 text-sm text-amber-900">
                <input type="checkbox" className="mt-1" checked={boxesConfirmed} onChange={(event) => setBoxesConfirmed(event.target.checked)} />
                {t('import.scanConfirmBoxes')}
              </label>
            </div>
          )}
          {rows.some(needsScanDateReview) && <p className="text-sm text-red-700">{t('import.scanDateUnresolved')}</p>}
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            {t('import.scanConfirm')}
          </label>
          <button type="button" className="btn-primary inline-flex items-center gap-2"
            disabled={saving || !confirmed || (boxNumbers.length > 0 && !boxesConfirmed) || (hasOrdinalIssues && !ordinalsConfirmed) || (duplicateGroups.length > 0 && !duplicatesConfirmed) || hasInvalidSourceOrdinal || expectedRowCountBlocksSave || !title.trim() || rows.some((row) => !row.folderSignature.trim() || !row.folderTitle.trim() || !row.categoryCode.trim() || !validFolderCount(row.folderCount) || !validScanBoxNumber(row.boxNumber) || needsScanDateReview(row) || invalidScanDateRange(row))}
            onClick={save}>
            {saving && <Loader2 size={16} className="animate-spin" />}{t('import.scanSave')}
          </button>
        </div>
      )}
    </div>
  );
}
