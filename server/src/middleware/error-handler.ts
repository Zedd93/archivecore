import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  const statusCode = (err as any).statusCode || 500;
  const message = statusCode === 500 ? 'Wewnętrzny błąd serwera' : err.message;

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}
