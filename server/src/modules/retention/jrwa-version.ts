export function parseJrwaValidFrom(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error('Podaj datę obowiązywania JRWA w formacie RRRR-MM-DD'), { statusCode: 400 });
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw Object.assign(new Error('Podaj prawidłową datę obowiązywania JRWA'), { statusCode: 400 });
  }
  return date;
}

export function previousJrwaDay(validFrom: Date): Date {
  return new Date(validFrom.getTime() - 24 * 60 * 60 * 1000);
}
