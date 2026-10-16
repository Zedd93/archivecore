export function notificationNavigation(
  actionUrl: string | null | undefined,
  notificationTenantId: string | null | undefined,
  selectedTenantId: string | null,
  canChooseTenant: boolean,
) {
  if (!actionUrl?.startsWith('/') || actionUrl.startsWith('//')) return null;
  return {
    path: actionUrl,
    switchToTenantId: canChooseTenant && notificationTenantId && notificationTenantId !== selectedTenantId
      ? notificationTenantId
      : null,
  };
}
