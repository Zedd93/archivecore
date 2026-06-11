import { Request, Response, NextFunction, CookieOptions } from 'express';
import { authService } from './auth.service';
import { successResponse, errorResponse } from '../../utils/response';

const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_COOKIE = 'refreshToken';
const EXPIRED_COOKIE_DATE = new Date(0);

function refreshTokenCookieOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'strict',
    path: '/',
  };
}

function setRefreshTokenCookie(req: Request, res: Response, token: string) {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...refreshTokenCookieOptions(req),
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
}

function expireRefreshTokenCookie(res: Response, secure: boolean) {
  const options: CookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
  };

  res.clearCookie(REFRESH_TOKEN_COOKIE, options);
  res.cookie(REFRESH_TOKEN_COOKIE, '', {
    ...options,
    expires: EXPIRED_COOKIE_DATE,
    maxAge: 0,
  });
}

function clearRefreshTokenCookie(req: Request, res: Response) {
  const currentSecure = refreshTokenCookieOptions(req).secure === true;

  // Clear both variants to remove cookies created before/after proxy HTTPS changes.
  for (const secure of new Set([currentSecure, true, false])) {
    expireRefreshTokenCookie(res, secure);
  }
}

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);

      if ('requiresTwoFactor' in result && result.requiresTwoFactor) {
        return successResponse(res, { requiresTwoFactor: true, tempToken: result.tempToken });
      }

      // Narrow type after 2FA check
      const loginResult = result as { accessToken: string; refreshToken: string; user: any };

      // Set refresh token as httpOnly cookie
      setRefreshTokenCookie(req, res, loginResult.refreshToken);

      return successResponse(res, {
        accessToken: loginResult.accessToken,
        user: loginResult.user,
      });
    } catch (err) {
      next(err);
    }
  }

  async validateTwoFactor(req: Request, res: Response, next: NextFunction) {
    try {
      const tempToken = req.body.tempToken || req.body.mfaSessionToken;
      const totpCode = req.body.totpCode || req.body.code;
      const result = await authService.validateTwoFactor(tempToken, totpCode);

      setRefreshTokenCookie(req, res, result.refreshToken);

      return successResponse(res, {
        accessToken: result.accessToken,
        user: result.user,
      });
    } catch (err) {
      next(err);
    }
  }

  async setupTwoFactor(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.setupTwoFactor(req.user!.userId);
      return successResponse(res, result);
    } catch (err) {
      next(err);
    }
  }

  async verifyTwoFactorSetup(req: Request, res: Response, next: NextFunction) {
    try {
      const { totpCode } = req.body;
      const result = await authService.verifyTwoFactorSetup(req.user!.userId, totpCode);
      return successResponse(res, result);
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.[REFRESH_TOKEN_COOKIE];
      if (!token) return errorResponse(res, 'Brak tokenu odświeżania', 401);

      const result = await authService.refreshToken(token);

      setRefreshTokenCookie(req, res, result.refreshToken);

      return successResponse(res, { accessToken: result.accessToken });
    } catch (err) {
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.[REFRESH_TOKEN_COOKIE];
      if (token) await authService.logout(token);
      clearRefreshTokenCookie(req, res);
      return successResponse(res, { message: 'Wylogowano' });
    } catch (err) {
      next(err);
    }
  }

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { oldPassword, newPassword } = req.body;
      await authService.changePassword(req.user!.userId, oldPassword, newPassword);
      return successResponse(res, { message: 'Hasło zmienione' });
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await authService.updateProfile(req.user!.userId, req.body);
      return successResponse(res, user);
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
