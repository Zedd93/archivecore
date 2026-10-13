import { useEffect, useRef, useState } from 'react';
import { readWarehouseScans, saveWarehouseScans, warehouseScanKey, type WarehouseScanOperation } from '@/utils/offlineWarehouseScans';

export function useOfflineWarehouseScans(userId: string, tenantId: string, operation: WarehouseScanOperation, scopeId = '') {
  const needsScope = operation === 'issue' || operation === 'inventory';
  const key = userId && tenantId && (!needsScope || scopeId) ? warehouseScanKey(userId, tenantId, operation, scopeId) : '';
  const [codes, setCodes] = useState(() => readWarehouseScans(key));
  const [verifiedCodes, setVerifiedCodes] = useState<string[]>([]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  useEffect(() => {
    setCodes(readWarehouseScans(key));
    setVerifiedCodes([]);
  }, [key]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const stage = (code: string): 'added' | 'duplicate' | 'unavailable' => {
    if (!key) return 'unavailable';
    const current = readWarehouseScans(key);
    if (current.includes(code)) return 'duplicate';
    const next = [...current, code];
    if (!saveWarehouseScans(key, next)) return 'unavailable';
    setCodes(next);
    return 'added';
  };

  const remove = (code: string) => {
    const next = readWarehouseScans(key).filter((item) => item !== code);
    if (saveWarehouseScans(key, next)) {
      setCodes(next);
      setVerifiedCodes((current) => current.filter((item) => item !== code));
    }
  };

  const clear = () => {
    if (saveWarehouseScans(key, [])) {
      setCodes([]);
      setVerifiedCodes([]);
    }
  };

  const verify = async (resolve: (code: string) => Promise<boolean>) => {
    if (!key || syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      for (const code of readWarehouseScans(key).filter((item) => !verifiedCodes.includes(item))) {
        if (!navigator.onLine) break;
        if (await resolve(code)) setVerifiedCodes((current) => current.includes(code) ? current : [...current, code]);
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  };

  return { codes, verifiedCodes, allVerified: codes.every((code) => verifiedCodes.includes(code)), online, syncing, stage, remove, clear, verify };
}
