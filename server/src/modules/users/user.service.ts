import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';

export class UserService {
  async list(tenantId: string | null, filters: any, skip: number, take: number) {
    const where: Prisma.UserWhereInput = {};
    if (tenantId) where.tenantId = tenantId;
    if (filters.isActive !== undefined) where.isActive = filters.isActive === 'true';
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

  async create(data: any, tenantId: string | null, assignedBy?: string) {
    // Check duplicate email
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw Object.assign(new Error('Użytkownik o tym adresie email już istnieje'), { statusCode: 409 });

    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await prisma.user.create({
      data: {
        tenantId: tenantId || data.tenantId,
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        isActive: data.isActive ?? true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Assign roles if provided
    if (data.roleIds && data.roleIds.length > 0) {
      await prisma.userRole.createMany({
        data: data.roleIds.map((roleId: string) => ({
          userId: user.id,
          roleId,
          assignedBy,
        })),
      });
    }

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

  async assignRoles(id: string, roleIds: string[], assignedBy: string) {
    // Remove existing roles
    await prisma.userRole.deleteMany({ where: { userId: id } });

    // Assign new roles
    if (roleIds.length > 0) {
      await prisma.userRole.createMany({
        data: roleIds.map(roleId => ({
          userId: id,
          roleId,
          assignedBy,
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
    const where: Prisma.RoleWhereInput = {};
    if (tenantId) {
      where.OR = [{ tenantId }, { tenantId: null, isSystem: true }];
    }
    return prisma.role.findMany({ where, orderBy: { name: 'asc' } });
  }
}

export const userService = new UserService();
