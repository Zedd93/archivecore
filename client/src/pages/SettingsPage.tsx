import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import toast from 'react-hot-toast';
import { User, Shield, Bell, Palette, Loader2, Eye, EyeOff } from 'lucide-react';

type Tab = 'profile' | 'security' | 'notifications' | 'appearance';

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
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('settings.title')}</h1>
        <p className="text-sm text-gray-500">{t('settings.subtitle')}</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Tabs sidebar */}
        <nav className="w-full md:w-48 md:shrink-0">
          <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
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
        <div className="flex-1">
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
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/auth/profile', { firstName, lastName });
      toast.success(t('auth.profileUpdated'));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('auth.profileUpdateError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">{t('auth.profile')}</h2>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
          <span className="text-xl font-bold text-primary-700">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </span>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-900">{user?.email}</div>
          <div className="text-xs text-gray-500">{user?.tenant?.name || t('layout.superAdmin')}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
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
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          {saving && <Loader2 size={16} className="animate-spin" />}
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

// ─── Security Tab ────────────────────────────────────────
function SecurityTab() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error(t('settings.security.passwordMismatch'));
      return;
    }
    if (newPassword.length < 8) {
      toast.error(t('settings.security.passwordTooShort'));
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success(t('settings.security.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('settings.security.passwordError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card space-y-6">
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
          className="btn-primary flex items-center gap-2"
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
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div>
            <div className="text-sm font-medium text-gray-900">{t('settings.security.totp')}</div>
            <div className="text-xs text-gray-500">{t('settings.security.totpDesc')}</div>
          </div>
          <span className="badge badge-gray">{t('settings.security.comingSoon')}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Notifications Tab ───────────────────────────────────
function NotificationsTab() {
  const { t } = useTranslation();

  const items = [
    { label: t('settings.notifications.newOrders'), desc: t('settings.notifications.newOrdersDesc') },
    { label: t('settings.notifications.orderStatus'), desc: t('settings.notifications.orderStatusDesc') },
    { label: t('settings.notifications.retention'), desc: t('settings.notifications.retentionDesc') },
    { label: t('settings.notifications.weeklyReport'), desc: t('settings.notifications.weeklyReportDesc') },
  ];

  return (
    <div className="card space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">{t('settings.notifications.title')}</h2>

      <div className="space-y-4">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
            <div>
              <div className="text-sm font-medium text-gray-900">{item.label}</div>
              <div className="text-xs text-gray-500">{item.desc}</div>
            </div>
            <label className="relative inline-flex items-center cursor-not-allowed opacity-50">
              <input type="checkbox" className="sr-only peer" disabled />
              <div className="w-9 h-5 bg-gray-200 peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
            </label>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 text-center">
        {t('settings.notifications.comingSoon')}
      </p>
    </div>
  );
}

// ─── Appearance Tab ──────────────────────────────────────
function AppearanceTab() {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (lng: string) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('archivecore-lang', lng);
  };

  return (
    <div className="card space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">{t('settings.appearance.title')}</h2>

      <div>
        <label htmlFor="settings-appearance-language" className="label-text mb-3 block">{t('settings.appearance.language')}</label>
        <select
          id="settings-appearance-language"
          className="input-field w-48"
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
