import { BUSINESS_HOURS, SLA_ESCALATION, SLA_LEVELS } from '@archivecore/shared';
import { OrderPriority, Prisma } from '@prisma/client';

export type SlaEscalationLevel = 80 | 100 | 120;

export const ACTIVE_SLA_STATUSES = ['submitted', 'approved', 'in_progress', 'ready'] as const;

function slaHours(priority: string): number {
  return SLA_LEVELS.find((entry) => entry.code === priority)?.hours ?? 48;
}

function warningWindowMinutes(priority: string): number {
  return Math.round(slaHours(priority) * 60 * (100 - SLA_ESCALATION.warningPercent) / 100);
}

export function businessMinutesBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let minutes = 0;
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);
  while (day < end) {
    if (BUSINESS_HOURS.workDays.includes(day.getDay())) {
      const opening = new Date(day);
      opening.setHours(BUSINESS_HOURS.startHour, 0, 0, 0);
      const closing = new Date(day);
      closing.setHours(BUSINESS_HOURS.endHour, 0, 0, 0);
      const overlapStart = Math.max(start.getTime(), opening.getTime());
      const overlapEnd = Math.min(end.getTime(), closing.getTime());
      if (overlapEnd > overlapStart) minutes += (overlapEnd - overlapStart) / 60_000;
    }
    day.setDate(day.getDate() + 1);
  }
  return minutes;
}

export function slaEscalationLevel(
  deadline: Date,
  priority: string,
  now: Date,
): SlaEscalationLevel | null {
  const hours = slaHours(priority);
  const warningMinutes = warningWindowMinutes(priority);
  const overdueWindowMinutes = Math.round(hours * 60 * (SLA_ESCALATION.overduepercent - 100) / 100);
  if (now >= deadline) {
    return businessMinutesBetween(deadline, now) >= overdueWindowMinutes ? 120 : 100;
  }
  return businessMinutesBetween(now, deadline) <= warningMinutes ? 80 : null;
}

export function orderSlaLevel(
  status: string,
  deadline: Date | null,
  priority: string,
  now: Date,
): SlaEscalationLevel | null {
  if (!deadline || !ACTIVE_SLA_STATUSES.includes(status as typeof ACTIVE_SLA_STATUSES[number])) return null;
  return slaEscalationLevel(deadline, priority, now);
}

export function addBusinessMinutes(start: Date, minutes: number): Date {
  let remaining = minutes;
  let current = new Date(start);
  while (remaining > 0) {
    const opening = new Date(current);
    opening.setHours(BUSINESS_HOURS.startHour, 0, 0, 0);
    const closing = new Date(current);
    closing.setHours(BUSINESS_HOURS.endHour, 0, 0, 0);
    if (!BUSINESS_HOURS.workDays.includes(current.getDay()) || current >= closing) {
      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
      continue;
    }
    if (current < opening) current = opening;
    const available = (closing.getTime() - current.getTime()) / 60_000;
    const step = Math.min(remaining, available);
    current = new Date(current.getTime() + step * 60_000);
    remaining -= step;
  }
  return current;
}

export function slaRiskDeadlines(now: Date): Array<{ priority: string; deadline: Date }> {
  return SLA_LEVELS.map((level) => ({
    priority: level.code,
    deadline: addBusinessMinutes(now, warningWindowMinutes(level.code)),
  }));
}

export function slaRiskWhere(now: Date): Prisma.OrderWhereInput {
  return {
    status: { in: [...ACTIVE_SLA_STATUSES] },
    OR: slaRiskDeadlines(now).map(({ priority, deadline }) => ({
      priority: priority as OrderPriority,
      slaDeadline: { lte: deadline },
    })),
  };
}
