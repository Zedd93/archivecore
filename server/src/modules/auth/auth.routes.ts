import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { loginSchema, changePasswordSchema, totpVerifySchema } from '@archivecore/shared';

const router = Router();

router.post('/login', validate(loginSchema), (req, res, next) => authController.login(req, res, next));
router.post('/refresh', (req, res, next) => authController.refresh(req, res, next));
router.post('/logout', (req, res, next) => authController.logout(req, res, next));
router.post('/2fa/setup', authenticate, (req, res, next) => authController.setupTwoFactor(req, res, next));
router.post('/2fa/verify', authenticate, validate(totpVerifySchema), (req, res, next) => authController.verifyTwoFactorSetup(req, res, next));
router.post('/2fa/validate', (req, res, next) => authController.validateTwoFactor(req, res, next));
router.post('/change-password', authenticate, validate(changePasswordSchema), (req, res, next) => authController.changePassword(req, res, next));

export default router;
