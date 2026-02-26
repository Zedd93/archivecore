import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { Box, Eye, EyeOff, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { login, verifyMfa } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await login(email, password);
      if (result.requiresMfa) {
        setMfaStep(true);
        setMfaToken(result.mfaSessionToken || '');
        toast(t('auth.twoFaRequired'), { icon: '🔐' });
      } else {
        navigate('/');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('auth.loginError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await verifyMfa(mfaToken, mfaCode);
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('auth.twoFaInvalid'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-blue-100 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3">
            <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center shadow-lg">
              <Box size={24} className="text-white" />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold text-gray-900">{t('layout.appName')}</h1>
              <p className="text-sm text-gray-500">{t('auth.systemName')}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {!mfaStep ? (
            <form onSubmit={handleLogin} className="space-y-5">
              <h2 className="text-xl font-semibold text-gray-900 text-center">{t('auth.login')}</h2>

              <div>
                <label htmlFor="login-email" className="label-text">{t('auth.email')}</label>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  placeholder="admin@archivecore.local"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="login-password" className="label-text">{t('auth.password')}</label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field pr-10"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
              >
                {isLoading ? <Loader2 size={18} className="animate-spin" /> : null}
                {t('auth.loginButton')}
              </button>
            </form>
          ) : (
            <form onSubmit={handleMfa} className="space-y-5">
              <h2 className="text-xl font-semibold text-gray-900 text-center">{t('auth.twoFaTitle')}</h2>
              <p className="text-sm text-gray-500 text-center">
                {t('auth.twoFaPrompt')}
              </p>

              <div>
                <label htmlFor="login-mfaCode" className="label-text">{t('auth.twoFaCode')}</label>
                <input
                  id="login-mfaCode"
                  type="text"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="input-field text-center text-xl tracking-widest"
                  placeholder="000000"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || mfaCode.length < 6}
                className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
              >
                {isLoading ? <Loader2 size={18} className="animate-spin" /> : null}
                {t('auth.twoFaVerify')}
              </button>

              <button
                type="button"
                onClick={() => { setMfaStep(false); setMfaCode(''); }}
                className="w-full text-sm text-gray-500 hover:text-gray-700 text-center"
              >
                ← {t('auth.twoFaBack')}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          {t('auth.footer')}
        </p>
      </div>
    </div>
  );
}
