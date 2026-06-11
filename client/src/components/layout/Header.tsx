import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useList } from '@/hooks/useApi';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { Search, Bell, LogOut, Settings, ChevronDown, Menu } from 'lucide-react';

interface HeaderProps {
  onMenuToggle: () => void;
}

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export default function Header({ onMenuToggle }: HeaderProps) {
  const { user, logout, hasPermission } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const canChooseTenant = !!user && !user.tenantId && (hasPermission('tenant.manage') || hasPermission('tenant.switch'));
  const { data: tenants } = useList('header-tenants', '/tenants', { page: 1, limit: 100 }, { enabled: canChooseTenant });
  const { data: notificationsData } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const { data } = await api.get('/notifications', { params: { limit: 8 } });
      return data.data as { items: NotificationItem[]; unreadCount: number };
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const previous = queryClient.getQueryData<{ items: NotificationItem[]; unreadCount: number }>(['notifications']);
      queryClient.setQueryData<{ items: NotificationItem[]; unreadCount: number }>(['notifications'], (current) => {
        if (!current) return current;
        const now = new Date().toISOString();
        const wasUnread = current.items.some((item) => item.id === id && !item.readAt);
        return {
          unreadCount: Math.max(0, current.unreadCount - (wasUnread ? 1 : 0)),
          items: current.items.map((item) => item.id === id ? { ...item, readAt: item.readAt || now } : item),
        };
      });
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(['notifications'], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const previous = queryClient.getQueryData<{ items: NotificationItem[]; unreadCount: number }>(['notifications']);
      queryClient.setQueryData<{ items: NotificationItem[]; unreadCount: number }>(['notifications'], (current) => {
        if (!current) return current;
        const now = new Date().toISOString();
        return {
          unreadCount: 0,
          items: current.items.map((item) => ({ ...item, readAt: item.readAt || now })),
        };
      });
      return { previous };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(['notifications'], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const activeTenantId = localStorage.getItem('tenantId') || '';
  const notifications = notificationsData?.items ?? [];
  const unreadCount = notificationsData?.unreadCount ?? 0;

  // Close notifications dropdown when clicking outside
  useEffect(() => {
    if (!showNotifications) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        bellRef.current && !bellRef.current.contains(e.target as Node) &&
        notificationsRef.current && !notificationsRef.current.contains(e.target as Node)
      ) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim().length >= 2) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleTenantChange = (tenantId: string) => {
    if (tenantId) {
      localStorage.setItem('tenantId', tenantId);
    } else {
      localStorage.removeItem('tenantId');
    }
    window.location.reload();
  };

  const handleNotificationClick = async (notification: NotificationItem) => {
    if (!notification.readAt) {
      markRead.mutate(notification.id);
    }
    setShowNotifications(false);
    if (notification.actionUrl) navigate(notification.actionUrl);
  };

  return (
    <header role="banner" className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6">
      {/* Left side: hamburger + search */}
      <div className="flex items-center gap-3 flex-1">
        {/* Hamburger menu — mobile only */}
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          aria-label="Toggle navigation menu"
        >
          <Menu size={20} />
        </button>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex-1 max-w-lg" role="search">
          <div className="relative flex">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={t('layout.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-l-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:bg-white"
                aria-label={t('layout.searchPlaceholder')}
              />
            </div>
            <button
              type="submit"
              className="px-3 py-2 bg-primary-600 text-white rounded-r-lg hover:bg-primary-700 transition-colors border border-primary-600 flex items-center justify-center"
              aria-label={t('common.search')}
            >
              <Search size={16} />
            </button>
          </div>
        </form>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 lg:gap-4 ml-4">
        {canChooseTenant && (
          <select
            value={activeTenantId}
            onChange={(e) => handleTenantChange(e.target.value)}
            className="input-field max-w-56 text-sm py-2"
            aria-label={t('layout.activeTenant')}
          >
            <option value="">{t('layout.chooseTenant')}</option>
            {tenants?.data?.map((tenant: any) => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
        )}
        {/* Notifications */}
        <div className="relative">
          <button
            ref={bellRef}
            onClick={() => {
              setShowMenu(false);
              setShowNotifications((open) => !open);
            }}
            className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            aria-label={t('layout.notifications.title')}
            aria-expanded={showNotifications}
            aria-haspopup="menu"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {showNotifications && (
            <div
              ref={notificationsRef}
              className="fixed right-4 top-16 lg:right-6 w-96 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-gray-200 z-[70] overflow-hidden"
              role="menu"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{t('layout.notifications.title')}</div>
                  <div className="text-xs text-gray-500">
                    {unreadCount > 0
                      ? t('layout.notifications.unreadCount', { count: unreadCount })
                      : t('layout.notifications.noUnread')}
                  </div>
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      markAllRead.mutate();
                    }}
                    disabled={markAllRead.isPending}
                    className="text-xs text-primary-700 hover:text-primary-800 font-medium disabled:opacity-60"
                  >
                    {t('layout.notifications.markAllRead')}
                  </button>
                )}
              </div>

              <div className="max-h-96 overflow-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-500">
                    {t('layout.notifications.empty')}
                  </div>
                ) : notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 ${notification.readAt ? 'bg-white' : 'bg-primary-50/60'}`}
                  >
                    <div className="flex gap-3">
                      <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${notification.readAt ? 'bg-gray-300' : 'bg-primary-600'}`} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{notification.title}</div>
                        <div className="text-xs text-gray-600 mt-0.5">{notification.message}</div>
                        <div className="text-[11px] text-gray-400 mt-1">
                          {new Date(notification.createdAt).toLocaleString('pl-PL')}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="User menu"
            aria-expanded={showMenu}
            aria-haspopup="true"
          >
            <div className="w-7 h-7 bg-primary-100 rounded-full flex items-center justify-center">
              <span className="text-xs font-medium text-primary-700">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </span>
            </div>
            <span className="hidden sm:inline text-sm font-medium text-gray-700">
              {user?.firstName}
            </span>
            <ChevronDown size={14} className="text-gray-400 hidden sm:block" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50" role="menu">
              <button
                role="menuitem"
                onClick={() => { setShowMenu(false); navigate('/settings'); }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Settings size={16} />
                {t('layout.settings')}
              </button>
              <hr className="my-1 border-gray-100" />
              <button
                role="menuitem"
                onClick={() => { setShowMenu(false); logout(); }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                <LogOut size={16} />
                {t('layout.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
