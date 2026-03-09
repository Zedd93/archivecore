import { NavLink, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Box, MapPin, FileText, ClipboardList,
  Users, QrCode, Search, BarChart3, Shield, Clock,
  Building2, Settings, UserCircle, FileSpreadsheet, X, Upload,
} from 'lucide-react';

interface NavItem {
  to: string;
  labelKey: string;
  icon: React.ReactNode;
  permission?: string;
}

const navItems: NavItem[] = [
  { to: '/', labelKey: 'layout.nav.dashboard', icon: <LayoutDashboard size={20} /> },
  { to: '/boxes', labelKey: 'layout.nav.boxes', icon: <Box size={20} />, permission: 'box.read' },
  { to: '/locations', labelKey: 'layout.nav.locations', icon: <MapPin size={20} />, permission: 'location.read' },
  { to: '/orders', labelKey: 'layout.nav.orders', icon: <ClipboardList size={20} />, permission: 'order.read' },
  { to: '/hr', labelKey: 'layout.nav.hr', icon: <UserCircle size={20} />, permission: 'hr.view' },
  { to: '/labels', labelKey: 'layout.nav.labels', icon: <QrCode size={20} />, permission: 'label.read' },
  { to: '/transfer-lists', labelKey: 'layout.nav.transferLists', icon: <FileSpreadsheet size={20} />, permission: 'transfer_list.read' },
  { to: '/import', labelKey: 'layout.nav.import', icon: <Upload size={20} />, permission: 'import.data' },
  { to: '/search', labelKey: 'layout.nav.search', icon: <Search size={20} />, permission: 'search.own' },
  { to: '/reports', labelKey: 'layout.nav.reports', icon: <BarChart3 size={20} />, permission: 'report.view' },
];

const adminItems: NavItem[] = [
  { to: '/admin/users', labelKey: 'layout.nav.users', icon: <Users size={20} />, permission: 'user.manage' },
  { to: '/admin/tenants', labelKey: 'layout.nav.tenants', icon: <Building2 size={20} />, permission: 'tenant.manage' },
  { to: '/admin/retention', labelKey: 'layout.nav.retention', icon: <Clock size={20} />, permission: 'retention.manage' },
  { to: '/admin/audit', labelKey: 'layout.nav.audit', icon: <Shield size={20} />, permission: 'audit.view' },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { hasPermission, user } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    onClose();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive
        ? 'bg-primary-50 text-primary-700 font-medium'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`;

  const visibleNav = navItems.filter(item => !item.permission || hasPermission(item.permission));
  const visibleAdmin = adminItems.filter(item => !item.permission || hasPermission(item.permission));

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-5 border-b border-gray-100">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <Box size={18} className="text-white" />
          </div>
          <span className="font-bold text-lg text-gray-900">{t('layout.appName')}</span>
        </Link>
        {/* Close button on mobile */}
        <button
          onClick={onClose}
          className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
          aria-label="Close navigation menu"
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleNav.map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={linkClass}>
            {item.icon}
            {t(item.labelKey)}
          </NavLink>
        ))}

        {visibleAdmin.length > 0 && (
          <>
            <div className="pt-4 pb-2">
              <span className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {t('layout.adminSection')}
              </span>
            </div>
            {visibleAdmin.map(item => (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                {item.icon}
                {t(item.labelKey)}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User info */}
      <div className="p-4 border-t border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
            <span className="text-xs font-medium text-gray-600">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">
              {user?.firstName} {user?.lastName}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {user?.tenant?.name || t('layout.superAdmin')}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar — always visible on lg+ */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-gray-200 flex-col h-full shrink-0" aria-label="Main navigation">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar — overlay */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 transition-opacity"
            onClick={onClose}
            aria-hidden="true"
          />
          {/* Sidebar panel */}
          <aside className="relative w-64 bg-white flex flex-col h-full shadow-xl animate-slide-in-left" aria-label="Main navigation">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
