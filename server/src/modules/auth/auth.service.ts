import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../config/database';
import { config } from '../../config/env';
import { ROLE_PERMISSIONS, RoleCode, requiresMfaForRoles } from '@archivecore/shared';
import { generateTotpSecret, verifyTotpToken, generateRecoveryCodes } from './totp.service';
import { encryptAES256, decryptAES256 } from '../../utils/crypto';

export class AuthService {
  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: { include: { role: true } },
      },
    });

    if (!user || !user.isActive) {
      throw Object.assign(new Error('Nieprawidłowy email lub hasło'), { statusCode: 401 });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      throw Object.assign(new Error('Nieprawidłowy email lub hasło'), { statusCode: 401 });
    }

    // Update last login
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    if (user.mfaEnabled) {
      const tempToken = jwt.sign(
        { userId: user.id, purpose: '2fa' },
        config.jwt.secret,
        { expiresIn: '5m' }
      );
      return { requiresTwoFactor: true, tempToken };
    }

    if (requiresMfaForRoles(user.userRoles.map(({ role }) => role.code))) {
      const tempToken = jwt.sign(
        { userId: user.id, purpose: 'mfa_enrollment' },
        config.jwt.secret,
        { expiresIn: '15m' },
      );
      return { requiresMfaSetup: true, tempToken };
    }

    return this.generateTokens(user);
  }

  private tempUserId(token: string, purpose: '2fa' | 'mfa_enrollment'): string {
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      if (typeof decoded === 'object' && decoded.purpose === purpose && typeof decoded.userId === 'string') {
        return decoded.userId;
      }
    } catch { /* Expired or invalid temporary token. */ }
    throw Object.assign(new Error('Token weryfikacyjny jest nieprawidłowy lub wygasł'), { statusCode: 401 });
  }

  async validateTwoFactor(tempToken: string, totpCode: string) {
    const user = await prisma.user.findUnique({
      where: { id: this.tempUserId(tempToken, '2fa') },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user || !user.isActive || !user.mfaEnabled || !user.mfaSecret) {
      throw Object.assign(new Error('Konto lub 2FA nie jest aktywne'), { statusCode: 401 });
    }

    const secret = decryptAES256(user.mfaSecret);
    if (!verifyTotpToken(secret, totpCode)) {
      throw Object.assign(new Error('Nieprawidłowy kod 2FA'), { statusCode: 401 });
    }

    return this.generateTokens(user, true);
  }

  async validateRecoveryCode(tempToken: string, recoveryCode: string) {
    const user = await prisma.user.findUnique({
      where: { id: this.tempUserId(tempToken, '2fa') },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user || !user.isActive || !user.mfaEnabled) {
      throw Object.assign(new Error('Konto lub 2FA nie jest aktywne'), { statusCode: 401 });
    }
    const normalized = recoveryCode.toUpperCase();
    let matchingHash: string | undefined;
    for (const hash of user.totpRecoveryCodes) {
      if (await bcrypt.compare(normalized, hash)) {
        matchingHash = hash;
        break;
      }
    }
    if (!matchingHash) throw Object.assign(new Error('Nieprawidłowy kod odzyskiwania'), { statusCode: 401 });

    const used = await prisma.$executeRaw`
      UPDATE users SET "totpRecoveryCodes" = array_remove("totpRecoveryCodes", ${matchingHash})
      WHERE id = ${user.id}::uuid AND ${matchingHash} = ANY("totpRecoveryCodes")
    `;
    if (used !== 1) throw Object.assign(new Error('Kod odzyskiwania został już użyty'), { statusCode: 401 });
    return this.generateTokens(user, true);
  }

  private async enrollmentUser(token: string) {
    const user = await prisma.user.findUnique({
      where: { id: this.tempUserId(token, 'mfa_enrollment') },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user || !user.isActive || user.mfaEnabled || !requiresMfaForRoles(user.userRoles.map(({ role }) => role.code))) {
      throw Object.assign(new Error('Konfiguracja 2FA nie jest już dostępna dla tego konta'), { statusCode: 401 });
    }
    return user;
  }

  async setupRequiredTwoFactor(token: string) {
    const user = await this.enrollmentUser(token);
    return this.setupTwoFactor(user.id);
  }

  async verifyRequiredTwoFactor(token: string, totpCode: string) {
    const user = await this.enrollmentUser(token);
    return this.verifyTwoFactorSetup(user.id, totpCode);
  }

  async setupTwoFactor(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Object.assign(new Error('Użytkownik nie znaleziony'), { statusCode: 404 });
    if (user.mfaEnabled) {
      throw Object.assign(new Error('2FA jest już włączone'), { statusCode: 400 });
    }

    const { secret, otpauthUrl } = generateTotpSecret(user.email);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    });

    // Temporarily store encrypted secret (finalized on verify)
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptAES256(secret) },
    });

    return { secret, otpauthUrl, qrCodeUrl: qrCodeDataUrl };
  }

  async verifyTwoFactorSetup(userId: string, totpCode: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || user.mfaEnabled || !user.mfaSecret) {
      throw Object.assign(new Error('Najpierw rozpocznij konfigurację 2FA'), { statusCode: 400 });
    }

    const secret = decryptAES256(user.mfaSecret);
    if (!verifyTotpToken(secret, totpCode)) {
      throw Object.assign(new Error('Nieprawidłowy kod weryfikacyjny'), { statusCode: 400 });
    }

    const recoveryCodes = generateRecoveryCodes();
    const updatedCount = await prisma.user.updateMany({
      where: { id: userId, mfaEnabled: false, mfaSecret: user.mfaSecret },
      data: {
        mfaEnabled: true,
        totpRecoveryCodes: recoveryCodes.map((c) => bcrypt.hashSync(c, 10)),
      },
    });
    if (updatedCount.count !== 1) throw Object.assign(new Error('Konfiguracja 2FA została już zakończona lub zmieniona'), { statusCode: 409 });
    const updated = await prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    if (!updated) throw Object.assign(new Error('Użytkownik nie znaleziony'), { statusCode: 404 });

    return { ...(await this.generateTokens(updated, true)), recoveryCodes };
  }

  async refreshToken(token: string) {
    const stored = await prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw Object.assign(new Error('Nieprawidłowy lub wygasły token odświeżania'), { statusCode: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: stored.userId },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user || !user.isActive) {
      throw Object.assign(new Error('Konto nieaktywne'), { statusCode: 401 });
    }

    const roles = user.userRoles.map(({ role }) => role.code);
    if ((user.mfaEnabled || requiresMfaForRoles(roles)) && !stored.mfaVerifiedAt) {
      throw Object.assign(new Error('Wymagane ponowne logowanie i potwierdzenie 2FA'), { statusCode: 401 });
    }

    // Revoke old, issue new
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

    return this.generateTokens(user, Boolean(stored.mfaVerifiedAt));
  }

  async logout(token: string) {
    await prisma.refreshToken.updateMany({
      where: { token, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Object.assign(new Error('Użytkownik nie znaleziony'), { statusCode: 404 });

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) throw Object.assign(new Error('Nieprawidłowe stare hasło'), { statusCode: 400 });

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
  }

  async updateProfile(userId: string, data: { firstName: string; lastName: string }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Object.assign(new Error('Użytkownik nie znaleziony'), { statusCode: 404 });

    return prisma.user.update({
      where: { id: userId },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        tenantId: true,
        department: true,
      },
    });
  }

  private async generateTokens(user: any, mfaVerified = false) {
    const roles = user.userRoles.map((ur: any) => ur.role.code);
    const permissions = this.collectPermissions(roles);
    if ((user.mfaEnabled || requiresMfaForRoles(roles)) && !mfaVerified) {
      throw Object.assign(new Error('Wymagane potwierdzenie 2FA'), { statusCode: 401 });
    }

    const payload = {
      userId: user.id,
      tenantId: user.tenantId,
      department: user.department,
      email: user.email,
      roles,
      permissions,
      mfaVerified,
    };

    const accessToken = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn as unknown as number,
    });

    const refreshToken = uuidv4();
    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: refreshExpiresAt,
        mfaVerifiedAt: mfaVerified ? new Date() : null,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        tenantId: user.tenantId,
        department: user.department,
        roles,
        permissions,
        mfaEnabled: user.mfaEnabled,
      },
    };
  }

  private collectPermissions(roleCodes: string[]): string[] {
    const perms = new Set<string>();
    for (const code of roleCodes) {
      const rolePerms = ROLE_PERMISSIONS[code as RoleCode];
      if (rolePerms) {
        rolePerms.forEach((p) => perms.add(p));
      }
    }
    return Array.from(perms);
  }
}

export const authService = new AuthService();
