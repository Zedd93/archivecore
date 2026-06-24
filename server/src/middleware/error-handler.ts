import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  let statusCode = (err as any).statusCode || 500;
  let message = statusCode === 500 ? 'Wewnętrzny błąd serwera' : err.message;

  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2022' || err.code === 'P2021')) {
    message = 'Baza danych wymaga migracji. Uruchom migracje Prisma i zrestartuj aplikację.';
  }
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2003' &&
    String((err.meta as any)?.field_name || err.message).includes('transferListItemId')
  ) {
    statusCode = 400;
    message = 'Nie można utworzyć zlecenia dla pozycji Spisu ZO. Sprawdź, czy wybrana teczka istnieje i czy migracje bazy danych są aktualne.';
  }
  if (err instanceof Prisma.PrismaClientValidationError && err.message.includes('Unknown argument `address`')) {
    message = 'Prisma Client na serwerze jest nieaktualny. Uruchom prisma generate i zrestartuj aplikację.';
  }
  if (err instanceof Prisma.PrismaClientValidationError && err.message.includes('transferListItemId')) {
    statusCode = 400;
    message = 'Prisma Client na serwerze jest nieaktualny dla zleceń teczek ze Spisów ZO. Uruchom prisma generate i zrestartuj aplikację.';
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}
