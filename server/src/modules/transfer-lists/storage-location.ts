export function effectiveStorageLocation(item: {
  boxId: string | null;
  box?: { location?: { fullPath: string } | null } | null;
  storageLocation: string | null;
}): string | null {
  // The imported text is only a fallback for folders that have no box.
  return item.boxId ? item.box?.location?.fullPath ?? null : item.storageLocation;
}
