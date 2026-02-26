import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../config/database';
import { config } from '../../config/env';
import { ROLE_PERMISSIONS, RoleCode } from '@archivecore/shared';
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
      // Return temp token for 2FA
      const tempToken = jwt.sign(
        { userId: user.id, purpose: '2fa' },
        config.jwt.secret,
        { expiresIn: '5m' }
      );
      return { requiresTwoFactor: true, tempToken };
    }

    return this.generateTokens(user);
  }

  async validateTwoFactor(tempToken: string, totpCode: string) {
    let decoded: any;
    try {
      decoded = jwt.verify(tempToken, config.jwt.secret);
    } catch {
      throw Object.assign(new Error('Token 2FA wygasł'), { statusCode: 401 });
    }

    if (decoded.purpose !== '2fa') {
      throw Object.assign(new Error('Nieprawidłowy token'), { statusCode: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user || !user.mfaSecret) {
      throw Object.assign(new Error('Użytkownik nie znaleziony'), { statusCode: 404 });
    }

    const secret = decryptAES256(user.mfaSecret);
    if (!verifyTotpToken(secret, totpCode)) {
      throw Object.assign(new Error('Nieprawidłowy kod 2FA'), { statusCode: 401 });
    }

    return this.generateTokens(user);
  }

  async setupTwoFactor(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Object.assign(new Error('Użytkownik nie znaleziony'), { statusCode: 404 });

    const { secret, otpauthUrl } = generateTotpSecret(user.email);
    // Temporarily store encrypted secret (finalized on verify)
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptAES256(secret) },
    });

    return { secret, qrCodeUrl: otpauthUrl };
  }

  async verifyTwoFactorSetup(userId: string, totpCode: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret) {
      throw Object.assign(new Error('Najpierw rozpocznij konfigurację 2FA'), { statusCode: 400 });
    }

    const secret = decryptAES256(user.mfaSecret);
    if (!verifyTotpToken(secret, totpCode)) {
      throw Object.assign(new Error('Nieprawidłowy kod weryfikacyjny'), { statusCode: 400 });
    }

    const recoveryCodes = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: true,
        totpRecoveryCodes: recoveryCodes.map((c) => bcrypt.hashSync(c, 10)),
      },
    });

    return { recoveryCodes };
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

    // Revoke old, issue new
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

    return this.generateTokens(user);
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

  private async generateTokens(user: any) {
    const roles = user.userRoles.map((ur: any) => ur.role.code);
    const permissions = this.collectPermissions(roles);

    const payload = {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roles,
      permissions,
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
        roles,
        permissions,
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
