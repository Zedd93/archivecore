import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  if ((err as any).code || (err as any).meta) {
    console.error('[ERROR DETAILS]', {
      code: (err as any).code,
      meta: (err as any).meta,
      name: err.name,
    });
  }

  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  let statusCode = (err as any).statusCode || 500;
  let message = statusCode === 500 ? 'Wewnętrzny błąd serwera' : err.message;
  const prismaCode = (err as any).code;
  const rawMessage = err.message || String(err);
  const prismaField = String((err as any).meta?.field_name || (err as any).meta?.column || '');

  if (
    (err instanceof Prisma.PrismaClientKnownRequestError || prismaCode) &&
    (prismaCode === 'P2022' || prismaCode === 'P2021')
  ) {
    statusCode = 400;
    message = 'Baza danych wymaga migracji. Uruchom migracje Prisma i zrestartuj aplikację.';
  }
  if (
    (err instanceof Prisma.PrismaClientKnownRequestError || prismaCode) &&
    prismaCode === 'P2003' &&
    (prismaField.includes('transferListItemId') || rawMessage.includes('transferListItemId'))
  ) {
    statusCode = 400;
    message = 'Nie można utworzyć zlecenia dla pozycji Spisu ZO. Sprawdź, czy wybrana teczka istnieje i czy migracje bazy danych są aktualne.';
  }
  if (rawMessage.includes('Unknown argument `address`')) {
    statusCode = 400;
    message = 'Prisma Client na serwerze jest nieaktualny. Uruchom prisma generate i zrestartuj aplikację.';
  }
  if (rawMessage.includes('transferListItemId')) {
    statusCode = 400;
    message = 'Prisma Client na serwerze jest nieaktualny dla zleceń teczek ze Spisów ZO. Uruchom prisma generate i zrestartuj aplikację.';
  }
  if (rawMessage.includes('expectedReturnAt')) {
    statusCode = 400;
    message = 'Baza danych wymaga migracji dla planowanej daty zwrotu wypożyczenia. Uruchom migracje Prisma i zrestartuj aplikację.';
  }
  if (statusCode === 500 && prismaCode) {
    statusCode = 400;
    message = `Błąd bazy danych (${prismaCode}). Szczegóły zapisano w logach serwera.`;
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}
