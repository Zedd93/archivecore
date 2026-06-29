export type RetentionTrigger = 'creation_date' | 'end_date' | 'event_date' | 'custom';
export type RetentionAction = 'dispose' | 'review' | 'transfer' | 'extend';

export interface IRetentionPolicy {
  id: string;
  tenantId: string | null;
  scope?: 'global' | 'tenant';
  name: string;
  docType: string | null;
  retentionYears: number | null;
  retentionTrigger: RetentionTrigger;
  description: string | null;
  jrwaCode: string | null;
  archivalCategory: string | null;
  isPermanent: boolean;
  sourceFileName: string | null;
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
  scope?: 'global' | 'tenant';
  name: string;
  docType?: string;
  retentionYears: number;
  retentionTrigger: RetentionTrigger;
  description?: string;
}
