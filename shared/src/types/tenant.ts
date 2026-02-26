export interface ITenant {
  id: string;
  name: string;
  shortCode: string;
  nip: string | null;
  address: string | null;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  isActive: boolean;
  configJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ICreateTenant {
  name: string;
  shortCode: string;
  nip?: string;
  address?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface IUpdateTenant extends Partial<ICreateTenant> {
  isActive?: boolean;
  configJson?: Record<string, unknown>;
}
