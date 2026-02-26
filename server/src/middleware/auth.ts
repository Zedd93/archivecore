import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { IJwtPayload } from '@archivecore/shared';

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Brak tokenu autoryzacji' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as IJwtPayload;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Nieprawidłowy lub wygasły token' });
  }
}
