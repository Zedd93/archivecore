export interface PaginationResult {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export function parsePagination(query: Record<string, unknown>): PaginationResult {
  const page = Math.max(1, parseInt(String(query.page || '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || '20'), 10)));
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
  };
}
