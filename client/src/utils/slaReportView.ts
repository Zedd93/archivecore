export function readSlaReportView(search: string, canViewAll: boolean): { days: number; scope: 'tenant' | 'all' } {
  const params = new URLSearchParams(search);
  const days = Number(params.get('slaDays'));
  return {
    days: [30, 90, 180, 365].includes(days) ? days : 180,
    scope: canViewAll && params.get('slaScope') === 'all' ? 'all' : 'tenant',
  };
}
