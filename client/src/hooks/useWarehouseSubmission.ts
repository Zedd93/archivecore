import { useEffect, useState } from 'react';
import {
  clearWarehouseSubmission, readWarehouseSubmission, saveWarehouseSubmission,
  warehouseSubmissionKey, type WarehouseSubmission,
} from '@/utils/warehouseSubmission';

export function useWarehouseSubmission(userId: string, tenantId: string, operation: 'move' | 'receive') {
  const key = userId && tenantId ? warehouseSubmissionKey(userId, tenantId, operation) : '';
  const [pending, setPending] = useState<WarehouseSubmission | null>(() => readWarehouseSubmission(key));
  useEffect(() => { setPending(readWarehouseSubmission(key)); }, [key]);

  const start = (data: Pick<WarehouseSubmission, 'ids' | 'locationId' | 'locationLabel' | 'notes'>) => {
    const entry: WarehouseSubmission = { ...data, operationId: crypto.randomUUID(), createdAt: Date.now() };
    if (!saveWarehouseSubmission(key, entry)) return null;
    setPending(entry);
    return entry;
  };

  const clear = (operationId: string) => {
    if (clearWarehouseSubmission(key, operationId)) setPending(null);
  };

  return { pending, start, clear };
}
