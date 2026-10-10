import { HRRetentionBasis, HRRiaStatus, RetentionPeriodType } from '@prisma/client';

type DateInput = string | Date | null | undefined;

export type HRRetentionInput = {
  employmentStart: DateInput;
  employmentEnd: DateInput;
  riaStatus: HRRiaStatus;
  riaSubmittedAt: DateInput;
  retentionReviewRequired?: boolean;
};

function dateOnly(value: DateInput): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function endOfYearPlusTen(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear() + 10, 11, 31));
}

function datePlusFiftyYears(date: Date): Date | null {
  const year = date.getUTCFullYear() + 50;
  const month = date.getUTCMonth();
  const result = new Date(Date.UTC(year, month, date.getUTCDate()));
  return result.getUTCMonth() === month ? result : null;
}

export function calculateHRRetention(input: HRRetentionInput): {
  retentionBasis: HRRetentionBasis;
  retentionPeriod: RetentionPeriodType;
  retentionBaseDate: Date | null;
  retentionEndDate: Date | null;
} {
  const start = dateOnly(input.employmentStart);
  const end = dateOnly(input.employmentEnd);
  const riaDate = dateOnly(input.riaSubmittedAt);

  if (!start || (end && end < start) || input.retentionReviewRequired) {
    return { retentionBasis: 'needs_review', retentionPeriod: 'fifty_years', retentionBaseDate: null, retentionEndDate: null };
  }

  if (start.getUTCFullYear() < 1999) {
    const retentionEndDate = end ? datePlusFiftyYears(end) : null;
    return {
      retentionBasis: end && !retentionEndDate ? 'needs_review' : 'pre_1999',
      retentionPeriod: 'fifty_years',
      retentionBaseDate: end,
      retentionEndDate,
    };
  }

  if (start.getUTCFullYear() < 2019) {
    if (input.riaStatus === 'submitted' && riaDate && riaDate >= new Date('2019-01-01T00:00:00.000Z') && (!end || riaDate >= end)) {
      return {
        retentionBasis: 'transitional_ria',
        retentionPeriod: 'ten_years',
        retentionBaseDate: riaDate,
        retentionEndDate: end ? endOfYearPlusTen(riaDate) : null,
      };
    }
    if (input.riaStatus === 'not_submitted') {
      const retentionEndDate = end ? datePlusFiftyYears(end) : null;
      return {
        retentionBasis: end && !retentionEndDate ? 'needs_review' : 'transitional_50',
        retentionPeriod: 'fifty_years',
        retentionBaseDate: end,
        retentionEndDate,
      };
    }
    return { retentionBasis: 'needs_review', retentionPeriod: 'fifty_years', retentionBaseDate: null, retentionEndDate: null };
  }

  return {
    retentionBasis: 'post_2018',
    retentionPeriod: 'ten_years',
    retentionBaseDate: end ? new Date(Date.UTC(end.getUTCFullYear(), 11, 31)) : null,
    retentionEndDate: end ? endOfYearPlusTen(end) : null,
  };
}
