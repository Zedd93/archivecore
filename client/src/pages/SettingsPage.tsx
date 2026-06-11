import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import toast from 'react-hot-toast';
import { getApiErrorMessage } from '@/utils/apiError';
import { User, Shield, Bell, Palette, Loader2, Eye, EyeOff } from 'lucide-react';
import { applyThemePreference, getStoredThemePreference, setStoredThemePreference, ThemePreference } from '@/utils/theme';

type Tab = 'profile' | 'security' | 'notifications' | 'appearance';

function meetsPasswordRequirements(password: string) {
  return password.length >= 8 && /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(password) && /[^A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(password);
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('profile');

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile', label: t('settings.tabProfile'), icon: <User size={18} /> },
    { id: 'security', label: t('settings.tabSecurity'), icon: <Shield size={18} /> },
    { id: 'notifications', label: t('settings.tabNotifications'), icon: <Bell size={18} /> },
    { id: 'appearance', label: t('settings.tabAppearance'), icon: <Palette size={18} /> },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4 sm:space-y-6 overflow-hidden">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('settings.title')}</h1>
        <p className="text-sm text-gray-500">{t('settings.subtitle')}</p>
      </div>

      <div className="flex min-w-0 flex-col md:flex-row gap-4 sm:gap-6">
        {/* Tabs sidebar */}
        <nav className="w-full min-w-0 md:w-48 md:shrink-0">
          <div className="flex md:flex-col gap-2 md:gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-1 px-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 md:w-full items-center gap-2 whitespace-nowrap px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Tab content */}
        <div className="min-w-0 flex-1">
          {activeTab === 'profile' && <ProfileTab user={user} />}
          {activeTab === 'security' && <SecurityTab />}
          {activeTab === 'notifications' && <NotificationsTab />}
          {activeTab === 'appearance' && <AppearanceTab />}
        </div>
      </div>
    </div>
  );
}

// ─── Profile Tab ─────────────────────────────────────────
function ProfileTab({ user }: { user: any }) {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/auth/profile', { firstName: firstName.trim(), lastName: lastName.trim() });
      await refreshUser();
      toast.success(t('auth.profileUpdated'));
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('auth.profileUpdateError')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-4 sm:p-6 space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">{t('auth.profile')}</h2>

      {/* Avatar */}
      <div className="flex items-start sm:items-center gap-4">
        <div className="w-16 h-16 shrink-0 bg-primary-100 rounded-full flex items-center justify-center">
          <span className="text-xl font-bold text-primary-700">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </span>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 break-all">{user?.email}</div>
          <div className="text-xs text-gray-500">{user?.tenant?.name || t('layout.superAdmin')}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="settings-profile-firstName" className="label-text">{t('auth.firstName')}</label>
          <input
            id="settings-profile-firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label htmlFor="settings-profile-lastName" className="label-text">{t('auth.lastName')}</label>
          <input
            id="settings-profile-lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="input-field"
          />
        </div>
      </div>

      <div>
        <label htmlFor="settings-profile-email" className="label-text">{t('auth.email')}</label>
        <input
          id="settings-profile-email"
          value={user?.email || ''}
          disabled
          className="input-field bg-gray-50 text-gray-500 cursor-not-allowed"
        />
        <p className="text-xs text-gray-400 mt-1">{t('auth.emailCannotChange')}</p>
      </div>

      <div className="flex justify-end pt-4 border-t">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex w-full sm:w-auto items-center justify-center gap-2">
          {saving && <Loader2 size={16} className="animate-spin" />}
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

// ─── Security Tab ────────────────────────────────────────
function SecurityTab() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(!!user?.mfaEnabled);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; qrCodeUrl: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);

  useEffect(() => {
    setMfaEnabled(!!user?.mfaEnabled);
  }, [user?.mfaEnabled]);

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error(t('settings.security.passwordMismatch'));
      return;
    }
    if (!meetsPasswordRequirements(newPassword)) {
      toast.error(t('settings.security.passwordRequirements'));
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { oldPassword: currentPassword, newPassword });
      toast.success(t('settings.security.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('settings.security.passwordError')));
    } finally {
      setSaving(false);
    }
  };

  const handleSetupMfa = async () => {
    setMfaLoading(true);
    try {
      const { data } = await api.post('/auth/2fa/setup');
      setMfaSetup(data.data);
      setMfaCode('');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('settings.security.twoFaSetupError')));
    } finally {
      setMfaLoading(false);
    }
  };

  const handleVerifyMfa = async () => {
    setMfaLoading(true);
    try {
      await api.post('/auth/2fa/verify', { totpCode: mfaCode });
      toast.success(t('settings.security.twoFaEnabled'));
      setMfaEnabled(true);
      setMfaSetup(null);
      setMfaCode('');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, t('settings.security.twoFaVerifyError')));
    } finally {
      setMfaLoading(false);
    }
  };

  return (
    <div className="card p-4 sm:p-6 space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">{t('settings.security.title')}</h2>

      <div className="space-y-4">
        <div>
          <label htmlFor="settings-security-currentPassword" className="label-text">{t('settings.security.currentPassword')}</label>
          <div className="relative">
            <input
              id="settings-security-currentPassword"
              type={showPasswords ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="input-field pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPasswords(!showPasswords)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}
            >
              {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="settings-security-newPassword" className="label-text">{t('settings.security.newPassword')}</label>
          <input
            id="settings-security-newPassword"
            type={showPasswords ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="input-field"
            placeholder={t('settings.security.newPasswordHint')}
          />
        </div>

        <div>
          <label htmlFor="settings-security-confirmPassword" className="label-text">{t('settings.security.confirmPassword')}</label>
          <input
            id="settings-security-confirmPassword"
            type={showPasswords ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input-field"
          />
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t">
        <button
          onClick={handleChangePassword}
          disabled={saving || !currentPassword || !newPassword || !confirmPassword}
          className="btn-primary flex w-full sm:w-auto items-center justify-center gap-2"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {t('settings.security.changeButton')}
        </button>
      </div>

      {/* 2FA section */}
      <div className="pt-6 border-t">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('settings.security.twoFaTitle')}</h3>
        <p className="text-sm text-gray-500 mb-3">
          {t('settings.security.twoFaDesc')}
        </p>
        <div className="p-4 bg-gray-50 rounded-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">{t('settings.security.totp')}</div>
              <div className="text-xs text-gray-500">{t('settings.security.totpDesc')}</div>
            </div>
            <span className={`${mfaEnabled ? 'badge-green' : 'badge-gray'} w-fit`}>
              {mfaEnabled ? t('settings.security.twoFaEnabledBadge') : t('settings.security.twoFaDisabledBadge')}
            </span>
          </div>

          {!mfaEnabled && !mfaSetup && (
            <button
              type="button"
              onClick={handleSetupMfa}
              disabled={mfaLoading}
              className="btn-primary flex w-full sm:w-auto items-center justify-center gap-2"
            >
              {mfaLoading && <Loader2 size={16} className="animate-spin" />}
              {t('settings.security.twoFaSetupButton')}
            </button>
          )}

          {!mfaEnabled && mfaSetup && (
            <div className="grid min-w-0 grid-cols-1 md:grid-cols-[240px_1fr] gap-5 items-start">
              <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center justify-center">
                <img src={mfaSetup.qrCodeUrl} alt={t('settings.security.twoFaQrAlt')} className="w-full max-w-56 h-auto" />
              </div>
              <div className="min-w-0 space-y-4">
                <div>
                  <div className="text-sm font-medium text-gray-900">{t('settings.security.twoFaScanTitle')}</div>
                  <p className="text-xs text-gray-500 mt-1">{t('settings.security.twoFaScanDesc')}</p>
                </div>
                <div>
                  <label htmlFor="settings-security-mfa-secret" className="label-text">{t('settings.security.twoFaManualKey')}</label>
                  <input
                    id="settings-security-mfa-secret"
                    value={mfaSetup.secret}
                    readOnly
                    className="input-field min-w-0 font-mono text-xs bg-white"
                  />
                </div>
                <div>
                  <label htmlFor="settings-security-mfa-code" className="label-text">{t('settings.security.twoFaCode')}</label>
                  <input
                    id="settings-security-mfa-code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="input-field text-center text-xl tracking-widest"
                    placeholder="000000"
                    inputMode="numeric"
                    maxLength={6}
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={handleVerifyMfa}
                    disabled={mfaLoading || mfaCode.length !== 6}
                    className="btn-primary flex w-full sm:w-auto items-center justify-center gap-2"
                  >
                    {mfaLoading && <Loader2 size={16} className="animate-spin" />}
                    {t('settings.security.twoFaVerifyButton')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMfaSetup(null); setMfaCode(''); }}
                    disabled={mfaLoading}
                    className="btn-secondary w-full sm:w-auto"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {mfaEnabled && (
            <p className="text-xs text-green-700">{t('settings.security.twoFaEnabledDesc')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Notifications Tab ───────────────────────────────────
function NotificationsTab() {
  const { t } = useTranslation();

  const activeEvents = [
    t('settings.notifications.newOrders'),
    t('settings.notifications.orderStatus'),
    t('settings.notifications.retention'),
  ];

  return (
    <div className="card p-4 sm:p-6 space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">{t('settings.notifications.title')}</h2>

      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-green-900">{t('settings.notifications.inAppActive')}</div>
            <p className="text-sm text-green-800 mt-1">{t('settings.notifications.inAppDesc')}</p>
          </div>
          <span className="badge-green w-fit">{t('common.active')}</span>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('settings.notifications.eventsTitle')}</h3>
        <div className="space-y-2">
          {activeEvents.map((label) => (
            <div key={label} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
              <span className="text-sm text-gray-700">{label}</span>
              <span className="badge-blue w-fit">{t('settings.notifications.channelInApp')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
        {t('settings.notifications.futureChannels')}
      </div>
    </div>
  );
}

// ─── Appearance Tab ──────────────────────────────────────
function AppearanceTab() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<ThemePreference>(() => getStoredThemePreference());

  const handleLanguageChange = (lng: string) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('archivecore-lang', lng);
  };

  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyThemePreference('system');
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const handleThemeChange = (nextTheme: ThemePreference) => {
    setTheme(nextTheme);
    setStoredThemePreference(nextTheme);
    toast.success(t('settings.appearance.themeChanged', { theme: t(`settings.appearance.theme${nextTheme[0].toUpperCase()}${nextTheme.slice(1)}`) }));
  };

  return (
    <div className="card p-4 sm:p-6 space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">{t('settings.appearance.title')}</h2>

      <div>
        <label htmlFor="settings-appearance-theme" className="label-text mb-3 block">{t('settings.appearance.theme')}</label>
        <select
          id="settings-appearance-theme"
          className="input-field w-full sm:w-64"
          value={theme}
          onChange={(e) => handleThemeChange(e.target.value as ThemePreference)}
        >
          <option value="light">{t('settings.appearance.themeLight')}</option>
          <option value="dark">{t('settings.appearance.themeDark')}</option>
          <option value="system">{t('settings.appearance.themeSystem')}</option>
        </select>
        <p className="mt-2 text-xs text-gray-500">{t('settings.appearance.themeHint')}</p>
      </div>

      <div>
        <label htmlFor="settings-appearance-language" className="label-text mb-3 block">{t('settings.appearance.language')}</label>
        <select
          id="settings-appearance-language"
          className="input-field w-full sm:w-48"
          value={i18n.language}
          onChange={(e) => handleLanguageChange(e.target.value)}
        >
          <option value="pl">Polski (PL)</option>
          <option value="en">English (EN)</option>
        </select>
      </div>
    </div>
  );
}
