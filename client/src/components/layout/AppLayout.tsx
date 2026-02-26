import { useState, useEffect, useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from './Sidebar';
import Header from './Header';
import { useGlobalShortcuts, getShortcutList } from '@/hooks/useKeyboardShortcuts';
import Modal from '@/components/ui/Modal';

export default function AppLayout() {
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const shortcutList = useMemo(() => getShortcutList(t), [t]);

  // Register global keyboard shortcuts
  useGlobalShortcuts();

  // Listen for show-shortcuts event
  useEffect(() => {
    const handler = () => setShowShortcuts(true);
    window.addEventListener('show-shortcuts', handler);
    return () => window.removeEventListener('show-shortcuts', handler);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onMenuToggle={() => setSidebarOpen(true)} />
        <main role="main" className="flex-1 overflow-auto p-4 lg:p-6 bg-gray-50">
          <Outlet />
        </main>
      </div>

      {/* Keyboard shortcuts help */}
      <Modal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} title={t('shortcuts.showShortcuts')}>
        <div className="space-y-1">
          {shortcutList.map((s) => (
            <div key={s.key} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <span className="text-sm text-gray-700">{s.description}</span>
              <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs font-mono text-gray-600">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
