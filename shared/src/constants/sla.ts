export interface ISlaLevel {
  code: string;
  label: string;
  hours: number;
  description: string;
}

export const SLA_LEVELS: ISlaLevel[] = [
  { code: 'normal', label: 'Normalny', hours: 48, description: '48 godzin roboczych' },
  { code: 'high', label: 'Wysoki', hours: 24, description: '24 godziny robocze' },
  { code: 'urgent', label: 'Maksymalny', hours: 8, description: '8 godzin roboczych' },
];

export const BUSINESS_HOURS = {
  startHour: 8,
  endHour: 16,
  workDays: [1, 2, 3, 4, 5], // Mon-Fri (0=Sun, 1=Mon...)
};

export const SLA_ESCALATION = {
  warningPercent: 80,
  criticalPercent: 100,
  overduepercent: 120,
};
