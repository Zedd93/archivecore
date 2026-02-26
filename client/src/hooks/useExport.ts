import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import toast from 'react-hot-toast';

interface UseExportOptions {
  /** Endpoint path e.g. '/export/boxes' */
  endpoint: string;
  /** Default filename if Content-Disposition header is missing */
  defaultFilename?: string;
}

/**
 * Hook for downloading export files (CSV/XLSX) from the API.
 * Returns { exportData, isExporting } where exportData triggers the download.
 */
export function useExport({ endpoint, defaultFilename = 'export.xlsx' }: UseExportOptions) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);

  const exportData = useCallback(async (params?: Record<string, string>) => {
    setIsExporting(true);
    try {
      const response = await api.get(endpoint, {
        params,
        responseType: 'blob',
      });

      // Extract filename from Content-Disposition header
      const disposition = response.headers['content-disposition'];
      let filename = defaultFilename;
      if (disposition) {
        const match = disposition.match(/filename="?([^";\n]+)"?/);
        if (match?.[1]) filename = match[1];
      }

      // Create download link
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(t('common.fileExported'));
    } catch (err: any) {
      // Try to parse error from blob response
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          toast.error(json.error || t('common.exportError'));
        } catch {
          toast.error(t('common.exportDataError'));
        }
      } else {
        toast.error(err.response?.data?.error || t('common.exportDataError'));
      }
    } finally {
      setIsExporting(false);
    }
  }, [endpoint, defaultFilename]);

  return { exportData, isExporting };
}
