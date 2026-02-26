export interface ILoginRequest {
  email: string;
  password: string;
}

export interface ILoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    tenantId: string | null;
    roles: string[];
    permissions: string[];
  };
  requiresTwoFactor?: boolean;
  tempToken?: string;
}

export interface ITwoFactorRequest {
  tempToken: string;
  totpCode: string;
}

export interface ITwoFactorSetupResponse {
  secret: string;
  qrCodeUrl: string;
}

export interface IJwtPayload {
  userId: string;
  tenantId: string | null;
  email: string;
  roles: string[];
  permissions: string[];
  iat?: number;
  exp?: number;
}

export interface IRefreshTokenResponse {
  accessToken: string;
}

export interface IChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}
