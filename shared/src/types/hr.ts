export type EmploymentStatus = 'active' | 'terminated' | 'retired' | 'deceased';
export type RetentionPeriodType = 'ten_years' | 'fifty_years';
export type DisposalStatus = 'active' | 'pending_review' | 'approved' | 'disposed';
export type StorageForm = 'paper' | 'digital' | 'hybrid';
export type HRPartCode = 'A' | 'B' | 'C' | 'D' | 'E';

export interface IHRFolder {
  id: string;
  tenantId: string;
  boxId: string | null;
  employeeFirstName: string;
  employeeLastName: string;
  employeePeselMasked: string;
  employeeIdNumber: string | null;
  employmentStart: string | null;
  employmentEnd: string | null;
  employmentStatus: EmploymentStatus;
  department: string | null;
  position: string | null;
  retentionPeriod: RetentionPeriodType;
  retentionBaseDate: string | null;
  retentionEndDate: string | null;
  disposalStatus: DisposalStatus;
  storageForm: StorageForm;
  litigationHold: boolean;
  litigationHoldUntil: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IHRFolderWithParts extends IHRFolder {
  parts: IHRFolderPart[];
  tenant: { id: string; name: string };
}

export interface IHRFolderPart {
  id: string;
  hrFolderId: string;
  partCode: HRPartCode;
  partSubcode: string | null;
  description: string | null;
  documentCount: number;
}

export interface IHRDocument {
  id: string;
  hrFolderPartId: string;
  tenantId: string;
  title: string;
  docType: string | null;
  docDate: string | null;
  orderNumber: number;
  pageCount: number | null;
  notes: string | null;
  attachmentId: string | null;
  createdAt: string;
}

export interface ICreateHRFolder {
  employeeFirstName: string;
  employeeLastName: string;
  employeePesel: string;
  employeeIdNumber?: string;
  employmentStart?: string;
  employmentEnd?: string;
  employmentStatus?: EmploymentStatus;
  department?: string;
  position?: string;
  retentionPeriod?: RetentionPeriodType;
  storageForm?: StorageForm;
  boxId?: string;
  notes?: string;
}

export interface ICreateHRDocument {
  title: string;
  docType?: string;
  docDate?: string;
  pageCount?: number;
  notes?: string;
  attachmentId?: string;
}
