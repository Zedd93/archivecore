import { Prisma } from '@prisma/client';

export function scanItemDepartmentWhere(department: string): Prisma.OrderItemWhereInput {
  const name = { equals: department, mode: 'insensitive' as const };
  return {
    OR: [
      { folder: { box: { department: name } } },
      { document: { box: { department: name } } },
      { document: { folder: { box: { department: name } } } },
      { transferListItem: { box: { department: name } } },
      { transferListItem: { folder: { box: { department: name } } } },
    ],
  };
}

export function scanOrderVisibility(department: string): Prisma.OrderWhereInput {
  return { OR: [{ orderType: { not: 'scan' } }, { items: { every: scanItemDepartmentWhere(department) } }] };
}
