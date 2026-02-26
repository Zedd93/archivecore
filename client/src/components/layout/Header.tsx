import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { Search, Bell, LogOut, Settings, ChevronDown, Menu } from 'lucide-react';

interface HeaderProps {
  onMenuToggle: () => void;
}

export default function Header({ onMenuToggle }: HeaderProps) {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim().length >= 2) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
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
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={t('layout.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:bg-white"
              aria-label={t('layout.searchPlaceholder')}
            />
          </div>
        </form>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 lg:gap-4 ml-4">
        {/* Notifications */}
        <button className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg" aria-label="Notifications">
          <Bell size={20} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" aria-hidden="true" />
        </button>

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
