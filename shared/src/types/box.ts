export type BoxStatus = 'active' | 'checked_out' | 'pending_disposal' | 'disposed' | 'lost' | 'damaged';

export interface IBox {
  id: string;
  tenantId: string;
  locationId: string | null;
  qrCode: string;
  barcode: string | null;
  boxNumber: string;
  title: string;
  description: string | null;
  docType: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  keywords: string[];
  status: BoxStatus;
  retentionPolicyId: string | null;
  retentionDate: string | null;
  disposalDate: string | null;
  notes: string | null;
  customFields: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  createdById: string;
}

export interface IBoxWithDetails extends IBox {
  location: { id: string; fullPath: string; code: string } | null;
  tenant: { id: string; name: string; shortCode: string };
  folders: { id: string; title: string; folderNumber: string }[];
  _count?: { folders: number; documents: number; attachments: number };
}

export interface ICreateBox {
  title: string;
  docType?: string;
  dateFrom?: string;
  dateTo?: string;
  keywords?: string[];
  locationId?: string;
  retentionPolicyId?: string;
  notes?: string;
  description?: string;
  customFields?: Record<string, unknown>;
}

export interface IUpdateBox extends Partial<ICreateBox> {
  barcode?: string;
}

export interface IMoveBox {
  locationId: string;
  notes?: string;
}
