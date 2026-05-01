import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

// Duck-typed ZodError detection — `instanceof ZodError` breaks when zod is
// duplicated in the dep tree (e.g. via different workspace resolution paths).
function isZodError(err: unknown): err is { errors?: Array<{ path: (string | number)[]; message: string }>; issues?: Array<{ path: (string | number)[]; message: string }> } {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'ZodError'
  );
}

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = schema.parse(req[source]);
      req[source] = data;
      next();
    } catch (err) {
      if (isZodError(err)) {
        const issues = err.errors ?? err.issues ?? [];
        const details = issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          details,
        });
      }
      next(err);
    }
  };
}
