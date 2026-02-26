export enum RoleCode {
  SUPER_ADMIN = 'SA',
  ADMIN_TENANT = 'AT',
  COORDINATOR_ARCHIVE = 'KA',
  OPERATOR_WAREHOUSE = 'OM',
  COORDINATOR_CLIENT = 'KK',
  USER_HR = 'HR',
  AUDITOR = 'AU',
  READ_ONLY = 'RO',
}

export const ROLE_LABELS: Record<RoleCode, string> = {
  [RoleCode.SUPER_ADMIN]: 'Super Administrator',
  [RoleCode.ADMIN_TENANT]: 'Administrator Klienta',
  [RoleCode.COORDINATOR_ARCHIVE]: 'Koordynator Archiwum',
  [RoleCode.OPERATOR_WAREHOUSE]: 'Operator Magazynu',
  [RoleCode.COORDINATOR_CLIENT]: 'Koordynator Klienta',
  [RoleCode.USER_HR]: 'Użytkownik HR',
  [RoleCode.AUDITOR]: 'Audytor',
  [RoleCode.READ_ONLY]: 'Tylko odczyt',
};

export const ROLE_DESCRIPTIONS: Record<RoleCode, string> = {
  [RoleCode.SUPER_ADMIN]: 'Pełny dostęp do wszystkich tenantów i konfiguracji',
  [RoleCode.ADMIN_TENANT]: 'Zarządzanie użytkownikami i konfiguracją w ramach swojego tenanta',
  [RoleCode.COORDINATOR_ARCHIVE]: 'Operacje archiwalne, zlecenia, raporty, brakowanie',
  [RoleCode.OPERATOR_WAREHOUSE]: 'Operacje fizyczne: przyjęcie, przesunięcie, wydanie, inwentaryzacja',
  [RoleCode.COORDINATOR_CLIENT]: 'Przegląd swoich danych, zlecenia, pobieranie skanów',
  [RoleCode.USER_HR]: 'Dostęp do modułu akt osobowych',
  [RoleCode.AUDITOR]: 'Tylko odczyt + logi audytu',
  [RoleCode.READ_ONLY]: 'Tylko przeglądanie, bez operacji',
};
