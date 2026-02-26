export type LocationType = 'warehouse' | 'zone' | 'rack' | 'shelf' | 'level' | 'slot';

export interface ILocation {
  id: string;
  parentId: string | null;
  tenantId: string | null;
  type: LocationType;
  code: string;
  name: string;
  description: string | null;
  capacity: number | null;
  currentCount: number;
  isActive: boolean;
  fullPath: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ILocationTree extends ILocation {
  children: ILocationTree[];
}

export interface ICreateLocation {
  parentId?: string;
  tenantId?: string;
  type: LocationType;
  code: string;
  name: string;
  description?: string;
  capacity?: number;
}

export interface IUpdateLocation {
  name?: string;
  description?: string;
  capacity?: number;
  isActive?: boolean;
}
