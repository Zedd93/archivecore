/**
 * Mask PESEL: "12345678901" → "123*****901"
 */
export function maskPesel(pesel: string): string {
  if (!pesel || pesel.length !== 11) return '***********';
  return pesel.substring(0, 3) + '*****' + pesel.substring(8);
}

/**
 * Format date to Polish locale string: "2024-01-15" → "15.01.2024"
 */
export function formatDatePL(date: string | Date | null): string {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Format datetime to Polish locale: "2024-01-15T10:30:00" → "15.01.2024 10:30"
 */
export function formatDateTimePL(date: string | Date | null): string {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format location path for display
 */
export function formatLocationPath(fullPath: string | null): string {
  if (!fullPath) return 'Brak lokalizacji';
  return fullPath;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Generate box number: K-{year}-{sequence}
 */
export function generateBoxNumber(year: number, sequence: number): string {
  return `K-${year}-${sequence.toString().padStart(6, '0')}`;
}

/**
 * Generate order number: ZL-{year}-{sequence}
 */
export function generateOrderNumber(year: number, sequence: number): string {
  return `ZL-${year}-${sequence.toString().padStart(5, '0')}`;
}
