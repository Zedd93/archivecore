import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from './auth.controller';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { loginSchema, changePasswordSchema, totpVerifySchema, mfaEnrollmentTokenSchema, mfaEnrollmentVerifySchema, mfaLoginVerifySchema, updateProfileSchema } from '@archivecore/shared';

const router = Router();
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: 'draft-7', legacyHeaders: false });
const mfaLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: 'draft-7', legacyHeaders: false });
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

router.post('/login', loginLimit, validate(loginSchema), (req, res, next) => authController.login(req, res, next));
router.post('/refresh', (req, res, next) => authController.refresh(req, res, next));
router.post('/logout', (req, res, next) => authController.logout(req, res, next));
router.post('/2fa/setup', mfaLimit, authenticate, (req, res, next) => authController.setupTwoFactor(req, res, next));
router.post('/2fa/verify', mfaLimit, authenticate, validate(totpVerifySchema), (req, res, next) => authController.verifyTwoFactorSetup(req, res, next));
router.post('/2fa/enroll/setup', mfaLimit, validate(mfaEnrollmentTokenSchema), (req, res, next) => authController.setupRequiredTwoFactor(req, res, next));
router.post('/2fa/enroll/verify', mfaLimit, validate(mfaEnrollmentVerifySchema), (req, res, next) => authController.verifyRequiredTwoFactor(req, res, next));
router.post('/2fa/validate', mfaLimit, validate(mfaLoginVerifySchema), (req, res, next) => authController.validateTwoFactor(req, res, next));
router.post('/change-password', authenticate, validate(changePasswordSchema), (req, res, next) => authController.changePassword(req, res, next));
router.patch('/profile', authenticate, validate(updateProfileSchema), (req, res, next) => authController.updateProfile(req, res, next));

export default router;
