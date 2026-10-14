import { Prisma } from '@prisma/client';

export function scanItemDepartmentWhere(department: string): Prisma.OrderItemWhereInput {
  const name = { equals: department, mode: 'insensitive' as const };
  return {
    OR: [
      { box: { department: name } },
      { folder: { box: { department: name } } },
      { document: { box: { department: name } } },
      { document: { folder: { box: { department: name } } } },
      { transferListItem: { box: { department: name } } },
      { transferListItem: { folder: { box: { department: name } } } },
      { hrFolder: { OR: [
        { department: name },
        { box: { department: name } },
      ] } },
    ],
  };
}

export function departmentOrderVisibility(department: string): Prisma.OrderWhereInput {
  return { AND: [{ items: { some: {} } }, { items: { every: scanItemDepartmentWhere(department) } }] };
}
