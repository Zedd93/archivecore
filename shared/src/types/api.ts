export interface IApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface IPaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface IPaginationParams {
  page?: number;
  limit?: number;
}

export interface ISortParams {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
