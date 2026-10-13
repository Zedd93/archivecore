import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

interface OperationInput {
  operationId?: string;
  tenantId: string;
  userId: string;
  operationType: 'move' | 'receive';
  ids: string[];
  locationId: string;
  notes?: string;
  department?: string;
}

function conflict() {
  return Object.assign(new Error('Identyfikator operacji został użyty dla innych danych lub użytkownika'), { statusCode: 409 });
}

export async function executeWarehouseOperation<T extends Record<string, number>>(
  input: OperationInput,
  execute: (tx: Prisma.TransactionClient) => Promise<T>,
  validate: () => Promise<void>,
): Promise<T & { replayed?: true }> {
  if (!input.operationId) {
    await validate();
    return prisma.$transaction(execute);
  }

  const requestHash = createHash('sha256').update(JSON.stringify({
    operationType: input.operationType,
    ids: [...new Set(input.ids)].sort(),
    locationId: input.locationId,
    notes: input.notes ?? null,
    department: input.department ?? null,
  })).digest('hex');

  const replay = async () => {
    const existing = await prisma.warehouseOperation.findUnique({ where: { id: input.operationId } });
    if (!existing) return null;
    if (existing.tenantId !== input.tenantId || existing.userId !== input.userId
      || existing.operationType !== input.operationType || existing.requestHash !== requestHash) throw conflict();
    if (!existing.response || typeof existing.response !== 'object' || Array.isArray(existing.response)) {
      throw Object.assign(new Error('Niekompletny zapis operacji magazynowej'), { statusCode: 500 });
    }
    return { ...(existing.response as T), replayed: true as const };
  };

  const previous = await replay();
  if (previous) return previous;
  await validate();

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.warehouseOperation.create({
        data: {
          id: input.operationId!, tenantId: input.tenantId, userId: input.userId,
          operationType: input.operationType, requestHash,
        },
      });
      const result = await execute(tx);
      await tx.warehouseOperation.update({ where: { id: input.operationId! }, data: { response: result } });
      return result;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const completed = await replay();
      if (completed) return completed;
    }
    throw error;
  }
}
