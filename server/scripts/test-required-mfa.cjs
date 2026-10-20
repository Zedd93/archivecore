const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const { RoleCode, requiresMfaForRoles, mfaLoginVerifySchema } = require('@archivecore/shared');
const { prisma } = require('../dist/config/database');
const { config } = require('../dist/config/env');
const { authService } = require('../dist/modules/auth/auth.service');
const { authenticate } = require('../dist/middleware/auth');

const userId = '0ab09ae1-75cb-4e65-9342-8b613196271f';
const password = 'Strong!Password1';

async function fixture(roleCode, run) {
  const user = {
    id: userId, email: 'admin@example.test', firstName: 'Admin', lastName: 'Test',
    passwordHash: await bcrypt.hash(password, 4), isActive: true, tenantId: null, department: null,
    mfaEnabled: false, mfaSecret: null, totpRecoveryCodes: [],
    userRoles: [{ role: { code: roleCode } }],
  };
  const tokens = [];
  const originals = {
    findUnique: prisma.user.findUnique,
    update: prisma.user.update,
    updateMany: prisma.user.updateMany,
    tokenCreate: prisma.refreshToken.create,
    tokenFind: prisma.refreshToken.findUnique,
    tokenUpdate: prisma.refreshToken.update,
    executeRaw: prisma.$executeRaw,
  };
  try {
    prisma.user.findUnique = async ({ where }) => where.id === userId || where.email === user.email ? user : null;
    prisma.user.update = async ({ data }) => { Object.assign(user, data); return user; };
    prisma.user.updateMany = async ({ where, data }) => {
      if (where.id !== user.id || user.mfaEnabled !== where.mfaEnabled || user.mfaSecret !== where.mfaSecret) return { count: 0 };
      Object.assign(user, data);
      return { count: 1 };
    };
    prisma.refreshToken.create = async ({ data }) => { const saved = { id: `token-${tokens.length}`, ...data, revokedAt: null }; tokens.push(saved); return saved; };
    prisma.refreshToken.findUnique = async ({ where }) => tokens.find((item) => item.token === where.token) || null;
    prisma.refreshToken.update = async ({ where, data }) => { const saved = tokens.find((item) => item.id === where.id); Object.assign(saved, data); return saved; };
    prisma.$executeRaw = async (_strings, hash, id) => {
      if (id !== user.id || !user.totpRecoveryCodes.includes(hash)) return 0;
      user.totpRecoveryCodes = user.totpRecoveryCodes.filter((value) => value !== hash);
      return 1;
    };
    await run({ user, tokens });
  } finally {
    prisma.user.findUnique = originals.findUnique;
    prisma.user.update = originals.update;
    prisma.user.updateMany = originals.updateMany;
    prisma.refreshToken.create = originals.tokenCreate;
    prisma.refreshToken.findUnique = originals.tokenFind;
    prisma.refreshToken.update = originals.tokenUpdate;
    prisma.$executeRaw = originals.executeRaw;
  }
}

function middlewareStatus(token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  let status = 200;
  let passed = false;
  const res = { status(value) { status = value; return this; }, json() { return this; } };
  authenticate(req, res, () => { passed = true; });
  return { status, passed };
}

test('privileged roles require MFA, ordinary employee and client roles do not', () => {
  for (const role of [RoleCode.SUPER_ADMIN, RoleCode.DOXART_ADMIN, RoleCode.TENANT_LEADERSHIP,
    RoleCode.ADMIN_TENANT, RoleCode.COORDINATOR_ARCHIVE, RoleCode.OPERATOR_WAREHOUSE,
    RoleCode.USER_HR, RoleCode.AUDITOR]) {
    assert.equal(requiresMfaForRoles([role]), true, role);
  }
  for (const role of [RoleCode.TENANT_EMPLOYEE, RoleCode.COORDINATOR_CLIENT, RoleCode.READ_ONLY]) {
    assert.equal(requiresMfaForRoles([role]), false, role);
  }
});

test('MFA verification accepts exactly one valid code type', () => {
  assert.equal(mfaLoginVerifySchema.safeParse({ tempToken: 'token', totpCode: '123456' }).success, true);
  assert.equal(mfaLoginVerifySchema.safeParse({ tempToken: 'token', recoveryCode: 'A1B2C3D4' }).success, true);
  assert.equal(mfaLoginVerifySchema.safeParse({ tempToken: 'token' }).success, false);
  assert.equal(mfaLoginVerifySchema.safeParse({ tempToken: 'token', totpCode: '123456', recoveryCode: 'A1B2C3D4' }).success, false);
  assert.equal(mfaLoginVerifySchema.safeParse({ tempToken: 'token', recoveryCode: 'invalid!' }).success, false);
});

test('privileged first login only allows enrollment, then verified TOTP creates a full session', async () => {
  await fixture(RoleCode.SUPER_ADMIN, async ({ user, tokens }) => {
    const first = await authService.login(user.email, password);
    assert.equal(first.requiresMfaSetup, true);
    assert.equal(tokens.length, 0);
    assert.equal(middlewareStatus(first.tempToken).passed, false);
    const setup = await authService.setupRequiredTwoFactor(first.tempToken);
    assert.match(setup.secret, /^[A-Z2-7]+$/);
    assert.match(setup.qrCodeUrl, /^data:image\/png;base64,/);
    await assert.rejects(authService.verifyRequiredTwoFactor(first.tempToken, 'invalid'), { statusCode: 400 });
    const code = speakeasy.totp({ secret: setup.secret, encoding: 'base32' });
    const session = await authService.verifyRequiredTwoFactor(first.tempToken, code);
    assert.equal(user.mfaEnabled, true);
    assert.equal(session.recoveryCodes.length, 10);
    assert.equal(session.user.mfaEnabled, true);
    assert.equal(jwt.verify(session.accessToken, config.jwt.secret).mfaVerified, true);
    assert.equal(middlewareStatus(session.accessToken).passed, true);
    assert.ok(tokens[0].mfaVerifiedAt instanceof Date);
    await assert.rejects(authService.setupRequiredTwoFactor(first.tempToken), { statusCode: 401 });

    const second = await authService.login(user.email, password);
    assert.equal(second.requiresTwoFactor, true);
    user.isActive = false;
    await assert.rejects(authService.validateTwoFactor(second.tempToken, code), { statusCode: 401 });
    user.isActive = true;
    const validated = await authService.validateTwoFactor(second.tempToken, code);
    assert.equal(middlewareStatus(validated.accessToken).passed, true);
    const refreshed = await authService.refreshToken(validated.refreshToken);
    assert.equal(middlewareStatus(refreshed.accessToken).passed, true);
  });
});

test('legacy privileged tokens and refresh tokens cannot bypass MFA', async () => {
  await fixture(RoleCode.DOXART_ADMIN, async ({ user, tokens }) => {
    const legacy = jwt.sign({ userId, roles: [RoleCode.DOXART_ADMIN], permissions: ['*'] }, config.jwt.secret);
    assert.deepEqual(middlewareStatus(legacy), { status: 401, passed: false });
    tokens.push({ id: 'legacy', userId, token: 'old-token', expiresAt: new Date(Date.now() + 60000), revokedAt: null, mfaVerifiedAt: null });
    await assert.rejects(authService.refreshToken('old-token'), { statusCode: 401 });
    assert.equal(tokens[0].revokedAt, null);
    const first = await authService.login(user.email, password);
    assert.equal(first.requiresMfaSetup, true);
    await assert.rejects(authService.validateTwoFactor(first.tempToken, '000000'), { statusCode: 401 });
  });
});

test('role promotion blocks non-MFA refresh, recovery codes work only once', async () => {
  await fixture(RoleCode.TENANT_EMPLOYEE, async ({ user, tokens }) => {
    const ordinary = await authService.login(user.email, password);
    assert.equal(ordinary.requiresMfaSetup, undefined);
    assert.equal(tokens[0].mfaVerifiedAt, null);
    user.userRoles = [{ role: { code: RoleCode.TENANT_LEADERSHIP } }];
    await assert.rejects(authService.refreshToken(ordinary.refreshToken), { statusCode: 401 });
    const required = await authService.login(user.email, password);
    const setup = await authService.setupRequiredTwoFactor(required.tempToken);
    const code = speakeasy.totp({ secret: setup.secret, encoding: 'base32' });
    const enabled = await authService.verifyRequiredTwoFactor(required.tempToken, code);
    const second = await authService.login(user.email, password);
    const redeemed = await authService.validateRecoveryCode(second.tempToken, enabled.recoveryCodes[0].toLowerCase());
    assert.equal(middlewareStatus(redeemed.accessToken).passed, true);
    await assert.rejects(authService.validateRecoveryCode(second.tempToken, enabled.recoveryCodes[0]), { statusCode: 401 });
  });
});
