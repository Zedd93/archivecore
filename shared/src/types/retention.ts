export type RetentionTrigger = 'creation_date' | 'end_date' | 'event_date' | 'custom';
export type RetentionAction = 'dispose' | 'review' | 'transfer' | 'extend';

export interface IRetentionPolicy {
  id: string;
  tenantId: string | null;
  name: string;
  docType: string | null;
  retentionYears: number;
  retentionTrigger: RetentionTrigger;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface IRetentionRule {
  id: string;
  policyId: string;
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  action: RetentionAction;
  notifyBeforeDays: number | null;
}

export interface ICreateRetentionPolicy {
  name: string;
  docType?: string;
  retentionYears: number;
  retentionTrigger: RetentionTrigger;
  description?: string;
}
