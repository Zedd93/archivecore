import { BUSINESS_HOURS, SLA_ESCALATION, SLA_LEVELS } from '@archivecore/shared';

export type SlaEscalationLevel = 80 | 100 | 120;

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
  const hours = SLA_LEVELS.find((entry) => entry.code === priority)?.hours ?? 48;
  const warningWindowMinutes = Math.round(hours * 60 * (100 - SLA_ESCALATION.warningPercent) / 100);
  const overdueWindowMinutes = Math.round(hours * 60 * (SLA_ESCALATION.overduepercent - 100) / 100);
  if (now >= deadline) {
    return businessMinutesBetween(deadline, now) >= overdueWindowMinutes ? 120 : 100;
  }
  return businessMinutesBetween(now, deadline) <= warningWindowMinutes ? 80 : null;
}
