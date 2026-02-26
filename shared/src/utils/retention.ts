/**
 * Retention date calculation for Polish law compliance.
 *
 * 10-year retention: from end of calendar year when employment ended
 * 50-year retention: from the day employment ended
 */

export interface RetentionCalculationParams {
  retentionPeriod: 'ten_years' | 'fifty_years';
  employmentEndDate: Date | string;
  litigationHold?: boolean;
  litigationEndDate?: Date | string | null;
}

export interface RetentionCalculationResult {
  retentionBaseDate: Date;
  retentionEndDate: Date;
  isExpired: boolean;
  daysUntilExpiry: number;
  isLitigationHeld: boolean;
}

export function calculateRetentionDate(params: RetentionCalculationParams): RetentionCalculationResult {
  const endDate = new Date(params.employmentEndDate);
  const now = new Date();
  let retentionBaseDate: Date;
  let retentionEndDate: Date;

  if (params.retentionPeriod === 'ten_years') {
    // 10 lat od końca roku kalendarzowego, w którym ustał stosunek pracy
    const endOfYear = new Date(endDate.getFullYear(), 11, 31); // Dec 31
    retentionBaseDate = endOfYear;
    retentionEndDate = new Date(endOfYear);
    retentionEndDate.setFullYear(retentionEndDate.getFullYear() + 10);
  } else {
    // 50 lat od dnia zakończenia pracy
    retentionBaseDate = new Date(endDate);
    retentionEndDate = new Date(endDate);
    retentionEndDate.setFullYear(retentionEndDate.getFullYear() + 50);
  }

  // Litigation hold — extend by 12 months after litigation end
  let isLitigationHeld = false;
  if (params.litigationHold && params.litigationEndDate) {
    isLitigationHeld = true;
    const litigationEnd = new Date(params.litigationEndDate);
    const extendedDate = new Date(litigationEnd);
    extendedDate.setMonth(extendedDate.getMonth() + 12);
    if (extendedDate > retentionEndDate) {
      retentionEndDate = extendedDate;
    }
  } else if (params.litigationHold && !params.litigationEndDate) {
    isLitigationHeld = true;
    // Open-ended litigation hold — don't expire
    retentionEndDate = new Date('2999-12-31');
  }

  const timeDiff = retentionEndDate.getTime() - now.getTime();
  const daysUntilExpiry = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

  return {
    retentionBaseDate,
    retentionEndDate,
    isExpired: daysUntilExpiry <= 0 && !isLitigationHeld,
    daysUntilExpiry,
    isLitigationHeld,
  };
}

export function calculateBoxRetentionDate(
  dateTo: Date | string,
  retentionYears: number,
  trigger: 'creation_date' | 'end_date' | 'event_date' | 'custom'
): Date {
  const baseDate = new Date(dateTo);
  const retentionEnd = new Date(baseDate);
  retentionEnd.setFullYear(retentionEnd.getFullYear() + retentionYears);
  return retentionEnd;
}
