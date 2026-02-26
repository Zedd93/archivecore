export interface ISlaLevel {
  code: string;
  label: string;
  hours: number;
  description: string;
}

export const SLA_LEVELS: ISlaLevel[] = [
  { code: 'standard', label: 'Standardowy', hours: 24, description: '24 godziny robocze' },
  { code: 'high', label: 'Wysoki', hours: 8, description: '8 godzin roboczych' },
  { code: 'urgent', label: 'Pilny', hours: 4, description: '4 godziny robocze' },
  { code: 'express', label: 'Ekspresowy', hours: 2, description: '2 godziny robocze' },
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
