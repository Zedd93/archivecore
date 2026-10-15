import { BUSINESS_HOURS, SLA_ESCALATION, SLA_LEVELS } from '@archivecore/shared';
import { OrderPriority, Prisma } from '@prisma/client';

export type SlaEscalationLevel = 80 | 100 | 120;

export const ACTIVE_SLA_STATUSES = ['submitted', 'approved', 'in_progress', 'ready'] as const;

export function slaHours(priority: string): number {
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
  warningAt?: Date | null,
  severeAt?: Date | null,
): SlaEscalationLevel | null {
  if (!deadline || !ACTIVE_SLA_STATUSES.includes(status as typeof ACTIVE_SLA_STATUSES[number])) return null;
  if (warningAt && severeAt) {
    if (now >= severeAt) return 120;
    if (now >= deadline) return 100;
    return now >= warningAt ? 80 : null;
  }
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

export function createSlaSchedule(start: Date, hours: number) {
  const minutes = hours * 60;
  const deadline = addBusinessMinutes(start, minutes);
  return {
    calculatedAt: new Date(start),
    hours,
    deadline,
    warningAt: addBusinessMinutes(start, Math.round(minutes * SLA_ESCALATION.warningPercent / 100)),
    severeAt: addBusinessMinutes(deadline, Math.round(minutes * (SLA_ESCALATION.overduepercent - 100) / 100)),
  };
}

export function subtractBusinessMinutes(end: Date, minutes: number): Date {
  let remaining = minutes;
  let current = new Date(end);
  while (remaining > 0) {
    const opening = new Date(current);
    opening.setHours(BUSINESS_HOURS.startHour, 0, 0, 0);
    const closing = new Date(current);
    closing.setHours(BUSINESS_HOURS.endHour, 0, 0, 0);
    if (!BUSINESS_HOURS.workDays.includes(current.getDay()) || current <= opening) {
      current.setDate(current.getDate() - 1);
      current.setHours(BUSINESS_HOURS.endHour, 0, 0, 0);
      continue;
    }
    if (current > closing) current = closing;
    const available = (current.getTime() - opening.getTime()) / 60_000;
    const step = Math.min(remaining, available);
    current = new Date(current.getTime() - step * 60_000);
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
    OR: [
      { slaWarningAt: { lte: now } },
      { slaWarningAt: null, OR: slaRiskDeadlines(now).map(({ priority, deadline }) => ({
        priority: priority as OrderPriority,
        slaDeadline: { lte: deadline },
      })) },
    ],
  };
}

function slaSevereWhere(now: Date): Prisma.OrderWhereInput {
  return {
    status: { in: [...ACTIVE_SLA_STATUSES] },
    OR: [
      { slaSevereAt: { lte: now } },
      { slaSevereAt: null, OR: SLA_LEVELS.map(({ code, hours }) => ({
        priority: code as OrderPriority,
        slaDeadline: {
          lte: subtractBusinessMinutes(now, Math.round(hours * 60 * (SLA_ESCALATION.overduepercent - 100) / 100)),
        },
      })) },
    ],
  };
}

export function slaLevelWhere(level: SlaEscalationLevel, now: Date): Prisma.OrderWhereInput {
  if (level === 80) return { AND: [slaRiskWhere(now), { slaDeadline: { gt: now } }] };
  if (level === 100) {
    return {
      AND: [
        { status: { in: [...ACTIVE_SLA_STATUSES] }, slaDeadline: { lte: now } },
        { NOT: slaSevereWhere(now) },
      ],
    };
  }
  return slaSevereWhere(now);
}

export function parseSlaLevel(value: unknown): SlaEscalationLevel | null {
  return value === '80' ? 80 : value === '100' ? 100 : value === '120' ? 120 : null;
}
