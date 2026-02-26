import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { successResponse, errorResponse } from '../../utils/response';

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
      res.cookie('refreshToken', loginResult.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

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
      const { tempToken, totpCode } = req.body;
      const result = await authService.validateTwoFactor(tempToken, totpCode);

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

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
      const token = req.cookies?.refreshToken;
      if (!token) return errorResponse(res, 'Brak tokenu odświeżania', 401);

      const result = await authService.refreshToken(token);

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return successResponse(res, { accessToken: result.accessToken });
    } catch (err) {
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.refreshToken;
      if (token) await authService.logout(token);
      res.clearCookie('refreshToken');
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
}

export const authController = new AuthController();
