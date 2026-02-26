import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import DataTable, { Column } from '@/components/ui/DataTable';
import toast from 'react-hot-toast';
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle2,
  Loader2, X, ArrowRight, Download,
} from 'lucide-react';

type EntityType = 'boxes' | 'hr';

interface PreviewRow {
  [key: string]: any;
  _rowIndex: number;
}

interface ImportError {
  row: number;
  field?: string;
  message: string;
}

interface PreviewResult {
  rows: PreviewRow[];
  errors: ImportError[];
}

interface ImportResult {
  totalRows: number;
  imported: number;
  errors: ImportError[];
}

function useEntityOptions() {
  const { t } = useTranslation();
  return [
    { value: 'boxes' as EntityType, label: t('boxes.title'), description: t('import.boxColumns') },
    { value: 'hr' as EntityType, label: t('hr.title'), description: t('import.hrColumns') },
  ];
}

export default function ImportPage() {
  const { t } = useTranslation();
  const ENTITY_OPTIONS = useEntityOptions();
  const [entityType, setEntityType] = useState<EntityType>('boxes');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── File handling ──────────────────────────────────────
  const handleFileSelect = useCallback((selectedFile: File) => {
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    const ext = selectedFile.name.split('.').pop()?.toLowerCase();
    if (!validTypes.includes(selectedFile.type) && !['xlsx', 'xls', 'csv'].includes(ext || '')) {
      toast.error(t('common.supportedFormats'));
      return;
    }
    setFile(selectedFile);
    setPreview(null);
    setImportResult(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) handleFileSelect(droppedFile);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  // ─── Preview ────────────────────────────────────────────
  const handlePreview = async () => {
    if (!file) return;
    setPreviewing(true);
    setPreview(null);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data } = await api.post(`/import/${entityType}/preview`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(data.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('common.genericError'));
    } finally {
      setPreviewing(false);
    }
  };

  // ─── Import ─────────────────────────────────────────────
  const handleImport = async () => {
    if (!file) return;
    setImporting(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data } = await api.post(`/import/${entityType}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(data.data);
      setPreview(null);

      if (data.data.errors.length === 0) {
        toast.success(t('import.successMsg', { count: data.data.imported, total: data.data.totalRows }));
      } else {
        toast.success(t('import.successWithErrors', { count: data.data.imported, errors: data.data.errors.length }));
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('common.genericError'));
    } finally {
      setImporting(false);
    }
  };

  // ─── Reset ──────────────────────────────────────────────
  const handleReset = () => {
    setFile(null);
    setPreview(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Preview columns ───────────────────────────────────
  const getPreviewColumns = (): Column<any>[] => {
    if (!preview?.rows?.length) return [];
    const sampleRow = preview.rows[0];
    return Object.keys(sampleRow)
      .filter(key => key !== '_rowIndex')
      .map(key => ({
        key,
        header: key,
      }));
  };

  const selectedEntity = ENTITY_OPTIONS.find(o => o.value === entityType)!;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('import.title')}</h1>
        <p className="text-sm text-gray-500">{t('import.subtitle')}</p>
      </div>

      {/* Step 1: Entity selection */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('import.step1')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ENTITY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setEntityType(opt.value); handleReset(); }}
              className={`text-left p-4 rounded-lg border-2 transition-colors ${
                entityType === opt.value
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="font-medium text-gray-900">{opt.label}</div>
              <div className="text-xs text-gray-500 mt-1">{opt.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: File upload */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('import.step2')}</h2>

        {!file ? (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
            }`}
            role="button"
            tabIndex={0}
            aria-label="Drop file here or click to select a file for import"
          >
            <Upload size={40} className="mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600 font-medium">{t('import.dropHint')}</p>
            <p className="text-sm text-gray-400 mt-2">{t('common.supportedFormats')}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={24} className="text-green-600" />
              <div>
                <div className="font-medium text-gray-900">{file.name}</div>
                <div className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleReset} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-200" aria-label="Remove file">
                <X size={18} />
              </button>
            </div>
          </div>
        )}

        {file && !preview && !importResult && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={handlePreview}
              disabled={previewing}
              className="btn-primary flex items-center gap-2"
            >
              {previewing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {previewing ? t('common.processing') : t('import.step3')}
            </button>
          </div>
        )}
      </div>

      {/* Step 3: Preview */}
      {preview && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('import.step3')}</h2>

          {/* Summary */}
          <div className="flex items-center gap-6 mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-green-600" />
              <span className="text-sm font-medium">{preview.rows.length} {t('import.validRows')}</span>
            </div>
            {preview.errors.length > 0 && (
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-500" />
                <span className="text-sm font-medium text-amber-700">{preview.errors.length} {t('import.errorRows')}</span>
              </div>
            )}
          </div>

          {/* Errors list */}
          {preview.errors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-semibold text-amber-800 mb-2">{t('import.validationErrors')}</h3>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {preview.errors.slice(0, 20).map((err, i) => (
                  <div key={i} className="text-xs text-amber-700">
                    {t('import.rowError', { row: err.row, message: `${err.field ? `${err.field}: ` : ''}${err.message}` })}
                  </div>
                ))}
                {preview.errors.length > 20 && (
                  <div className="text-xs text-amber-600 font-medium mt-1">...+{preview.errors.length - 20}</div>
                )}
              </div>
            </div>
          )}

          {/* Data table preview */}
          {preview.rows.length > 0 && (
            <div className="border rounded-lg overflow-hidden mb-4">
              <DataTable
                columns={getPreviewColumns()}
                data={preview.rows.slice(0, 50)}
                isLoading={false}
                emptyMessage={t('common.noData')}
              />
              {preview.rows.length > 50 && (
                <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 text-center">
                  {t('import.previewNote', { count: preview.rows.length })}
                </div>
              )}
            </div>
          )}

          {/* Import button */}
          {preview.rows.length > 0 && (
            <div className="flex justify-end gap-3">
              <button onClick={handleReset} className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="btn-primary flex items-center gap-2"
              >
                {importing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {importing ? t('common.processing') : `${t('common.import')} ${preview.rows.length} ${selectedEntity.label.toLowerCase()}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Results */}
      {importResult && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('import.step4')}</h2>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-gray-900">{importResult.totalRows}</div>
              <div className="text-xs text-gray-500 mt-1">{t('import.totalRows')}</div>
            </div>
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-700">{importResult.imported}</div>
              <div className="text-xs text-green-600 mt-1">{t('import.imported')}</div>
            </div>
            <div className={`rounded-lg p-4 text-center ${importResult.errors.length > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
              <div className={`text-2xl font-bold ${importResult.errors.length > 0 ? 'text-red-700' : 'text-gray-400'}`}>
                {importResult.errors.length}
              </div>
              <div className={`text-xs mt-1 ${importResult.errors.length > 0 ? 'text-red-600' : 'text-gray-500'}`}>{t('import.errors')}</div>
            </div>
          </div>

          {importResult.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-semibold text-red-800 mb-2">{t('import.importErrors')}</h3>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {importResult.errors.map((err, i) => (
                  <div key={i} className="text-xs text-red-700">
                    {t('import.rowError', { row: err.row, message: `${err.field ? `${err.field}: ` : ''}${err.message}` })}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={handleReset} className="btn-primary">
              {t('import.newImport')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
