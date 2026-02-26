import { Response } from 'express';

export function successResponse<T>(res: Response, data: T, statusCode = 200, meta?: Record<string, unknown>) {
  return res.status(statusCode).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
  });
}

export function errorResponse(res: Response, message: string, statusCode = 400) {
  return res.status(statusCode).json({
    success: false,
    error: message,
  });
}

export function paginatedResponse<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number
) {
  return res.status(200).json({
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
