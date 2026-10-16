export type SlaReportKind = 'completed' | 'breached' | 'activeOverdue';

export interface SlaReportDrilldown {
  slaReport: SlaReportKind;
  slaDays: string;
  slaAsOf: string;
  tenantId: string;
  orderType: string;
  priority: string;
}

export function slaReportOrderUrl(filter: SlaReportDrilldown): string {
  return `/orders?${new URLSearchParams(Object.entries(filter)).toString()}`;
}

export function readSlaReportDrilldown(search: string): SlaReportDrilldown | null {
  const params = new URLSearchParams(search);
  const slaReport = params.get('slaReport');
  const slaDays = params.get('slaDays');
  const slaAsOf = params.get('slaAsOf');
  const tenantId = params.get('tenantId');
  const orderType = params.get('orderType');
  const priority = params.get('priority');
  if (!['completed', 'breached', 'activeOverdue'].includes(slaReport || '')
    || !['30', '90', '180', '365'].includes(slaDays || '')
    || !slaAsOf || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(slaAsOf)
    || Number.isNaN(Date.parse(slaAsOf)) || new Date(slaAsOf).toISOString() !== slaAsOf
    || !tenantId || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(tenantId)
    || !['checkout', 'return_order', 'transfer', 'disposal', 'scan'].includes(orderType || '')
    || !['normal', 'high', 'urgent'].includes(priority || '')) return null;
  return { slaReport: slaReport as SlaReportKind, slaDays: slaDays!, slaAsOf, tenantId, orderType: orderType!, priority: priority! };
}
