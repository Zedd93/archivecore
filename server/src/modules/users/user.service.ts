import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import {
  ASSIGNABLE_ROLE_CODES,
  IJwtPayload,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  RoleCode,
} from '@archivecore/shared';

export class UserService {
  private async getOrCreateSystemRole(roleCode: RoleCode) {
    const existing = await prisma.role.findFirst({
      where: { code: roleCode, tenantId: null, isSystem: true },
    });
    if (existing) return existing;

    return prisma.role.create({
      data: {
        code: roleCode,
        name: ROLE_LABELS[roleCode],
        description: ROLE_DESCRIPTIONS[roleCode],
        permissions: ROLE_PERMISSIONS[roleCode] as Prisma.InputJsonValue,
        isSystem: true,
        tenantId: null,
      },
    });
  }

  async list(tenantId: string | null, filters: any, skip: number, take: number) {
    const where: Prisma.UserWhereInput = {};
    if (tenantId) where.tenantId = tenantId;
    if (filters.isActive === 'true' || filters.isActive === 'false') {
      where.isActive = filters.isActive === 'true';
    }
    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { lastName: 'asc' },
        select: {
          id: true,
          tenantId: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          department: true,
          isActive: true,
          mfaEnabled: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          tenant: { select: { id: true, name: true, shortCode: true } },
          userRoles: {
            include: { role: { select: { id: true, name: true, code: true } } },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return { data, total };
  }

  async getById(id: string, tenantId?: string | null) {
    const where: Prisma.UserWhereInput = { id };
    if (tenantId) where.tenantId = tenantId;

    const user = await prisma.user.findFirst({
      where,
      select: {
        id: true,
        tenantId: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        department: true,
        isActive: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        tenant: { select: { id: true, name: true, shortCode: true } },
        userRoles: {
          include: { role: { select: { id: true, name: true, code: true, permissions: true } } },
        },
      },
    });

    if (!user) throw Object.assign(new Error('Użytkownik nie znaleziony'), { statusCode: 404 });
    return user;
  }

  async create(data: any, tenantId: string | null, creator: IJwtPayload) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw Object.assign(new Error('Użytkownik o tym adresie email już istnieje'), { statusCode: 409 });

    const roleCode = data.roleCode as RoleCode;
    if (!ASSIGNABLE_ROLE_CODES.includes(roleCode as any)) {
      throw Object.assign(new Error('Nieprawidłowa rola użytkownika'), { statusCode: 400 });
    }

    const isSuperAdmin = creator.roles.includes(RoleCode.SUPER_ADMIN);
    const isGlobalRole = roleCode === RoleCode.SUPER_ADMIN || roleCode === RoleCode.DOXART_ADMIN;
    if (isGlobalRole && !isSuperAdmin) {
      throw Object.assign(new Error('Tylko Super Admin może nadać globalną rolę'), { statusCode: 403 });
    }

    const targetTenantId = creator.tenantId || data.tenantId || tenantId || null;
    if (!isGlobalRole && !targetTenantId) {
      throw Object.assign(new Error('Dla tej roli wybierz tenant klienta'), { statusCode: 400 });
    }
    if (roleCode === RoleCode.TENANT_EMPLOYEE && !data.department?.trim()) {
      throw Object.assign(new Error('Dla pracownika tenanta podaj dział'), { statusCode: 400 });
    }

    const role = await this.getOrCreateSystemRole(roleCode);

    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId: isGlobalRole ? null : targetTenantId,
          email: data.email,
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          department: roleCode === RoleCode.TENANT_EMPLOYEE ? data.department.trim() : null,
          isActive: data.isActive ?? true,
        },
      });
      await tx.userRole.create({
        data: {
          userId: created.id,
          roleId: role.id,
          assignedBy: creator.userId,
        },
      });
      return created;
    });

    return this.getById(user.id);
  }

  async update(id: string, tenantId: string | null, data: any) {
    await this.getById(id, tenantId);

    const updateData: any = {};
    if (data.firstName) updateData.firstName = data.firstName;
    if (data.lastName) updateData.lastName = data.lastName;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 12);

    await prisma.user.update({ where: { id }, data: updateData });
    return this.getById(id, tenantId);
  }

  async updateAccess(id: string, data: any, tenantId: string | null, actor: IJwtPayload) {
    await this.getById(id, actor.tenantId || tenantId);

    const roleCode = data.roleCode as RoleCode;
    const isGlobalRole = roleCode === RoleCode.SUPER_ADMIN || roleCode === RoleCode.DOXART_ADMIN;
    if (isGlobalRole && !actor.roles.includes(RoleCode.SUPER_ADMIN)) {
      throw Object.assign(new Error('Tylko Super Admin może nadać globalną rolę'), { statusCode: 403 });
    }

    const targetTenantId = actor.tenantId || data.tenantId || tenantId || null;
    if (!isGlobalRole && !targetTenantId) {
      throw Object.assign(new Error('Dla tej roli wybierz tenant klienta'), { statusCode: 400 });
    }
    if (roleCode === RoleCode.TENANT_EMPLOYEE && !data.department?.trim()) {
      throw Object.assign(new Error('Dla pracownika tenanta podaj dział'), { statusCode: 400 });
    }

    const role = await this.getOrCreateSystemRole(roleCode);
    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: {
          tenantId: isGlobalRole ? null : targetTenantId,
          department: roleCode === RoleCode.TENANT_EMPLOYEE ? data.department.trim() : null,
        },
      }),
      prisma.userRole.deleteMany({ where: { userId: id } }),
      prisma.userRole.create({
        data: { userId: id, roleId: role.id, assignedBy: actor.userId },
      }),
    ]);

    return this.getById(id);
  }

  async assignRoles(id: string, roleIds: string[], actor: IJwtPayload, tenantId: string | null) {
    await this.getById(id, actor.tenantId || tenantId);
    const roles = await prisma.role.findMany({ where: { id: { in: roleIds } } });
    const assignsGlobalRole = roles.some((role) =>
      role.code === RoleCode.SUPER_ADMIN || role.code === RoleCode.DOXART_ADMIN
    );
    if (assignsGlobalRole && !actor.roles.includes(RoleCode.SUPER_ADMIN)) {
      throw Object.assign(new Error('Tylko Super Admin może nadać globalną rolę'), { statusCode: 403 });
    }

    // Remove existing roles
    await prisma.userRole.deleteMany({ where: { userId: id } });

    // Assign new roles
    if (roleIds.length > 0) {
      await prisma.userRole.createMany({
        data: roleIds.map(roleId => ({
          userId: id,
          roleId,
          assignedBy: actor.userId,
        })),
      });
    }

    return this.getById(id);
  }

  async deactivate(id: string, tenantId: string | null) {
    await this.getById(id, tenantId);
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    return { deactivated: true };
  }

  async getRoles(tenantId: string | null) {
    const where: Prisma.RoleWhereInput = { code: { in: [...ASSIGNABLE_ROLE_CODES] } };
    return prisma.role.findMany({ where, orderBy: { name: 'asc' } });
  }
}

export const userService = new UserService();
