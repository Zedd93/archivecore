export interface IUser {
  id: string;
  tenantId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IUserWithRoles extends IUser {
  roles: { id: string; code: string; name: string }[];
  permissions: string[];
}

export interface ICreateUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  tenantId?: string;
  roleIds?: string[];
}

export interface IUpdateUser {
  firstName?: string;
  lastName?: string;
  phone?: string;
  isActive?: boolean;
}
