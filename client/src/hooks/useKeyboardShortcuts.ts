import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
  description: string;
}

/**
 * Hook for registering keyboard shortcuts.
 * Skips shortcuts when the user is typing in an input/textarea/select.
 */
export function useKeyboardShortcut(
  key: string,
  handler: () => void,
  options?: { ctrl?: boolean; shift?: boolean; alt?: boolean; enabled?: boolean }
) {
  const { ctrl = false, shift = false, alt = false, enabled = true } = options || {};

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in a form field
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      const keyMatch = e.key.toLowerCase() === key.toLowerCase();
      const ctrlMatch = ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
      const shiftMatch = shift ? e.shiftKey : !e.shiftKey;
      const altMatch = alt ? e.altKey : !e.altKey;

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        e.preventDefault();
        handler();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [key, handler, ctrl, shift, alt, enabled]);
}

/**
 * Global navigation shortcuts for the app.
 * Call this once in the root layout.
 */
export function useGlobalShortcuts() {
  const navigate = useNavigate();

  // Navigation shortcuts (g + key pattern)
  const goTo = useCallback((path: string) => () => navigate(path), [navigate]);

  // "g" prefix mode for navigation
  useEffect(() => {
    let gPressed = false;
    let timer: ReturnType<typeof setTimeout>;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      // If "g" was pressed, wait for next key
      if (gPressed) {
        gPressed = false;
        clearTimeout(timer);

        switch (e.key.toLowerCase()) {
          case 'd': navigate('/'); break;           // g+d → Dashboard
          case 'b': navigate('/boxes'); break;       // g+b → Boxes
          case 'o': navigate('/orders'); break;      // g+o → Orders
          case 'h': navigate('/hr'); break;          // g+h → HR
          case 'l': navigate('/locations'); break;   // g+l → Locations
          case 's': navigate('/search'); break;      // g+s → Search
          case 'r': navigate('/reports'); break;     // g+r → Reports
          case 't': navigate('/transfer-lists'); break; // g+t → Transfer lists
          case 'i': navigate('/import'); break;      // g+i → Import
          case 'e': navigate('/settings'); break;    // g+e → Settings
        }
        e.preventDefault();
        return;
      }

      if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        gPressed = true;
        timer = setTimeout(() => { gPressed = false; }, 500);
        return;
      }

      // "/" → focus search
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('header input[type="text"]');
        searchInput?.focus();
        return;
      }

      // "?" → show shortcuts help (Shift + /)
      if (e.key === '?' && e.shiftKey) {
        e.preventDefault();
        // Could dispatch a custom event for a shortcuts modal
        window.dispatchEvent(new CustomEvent('show-shortcuts'));
        return;
      }

      // Escape → close modals (blur active element)
      if (e.key === 'Escape') {
        (document.activeElement as HTMLElement)?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);
}

/**
 * Returns the list of all available shortcuts for the help modal.
 * Uses i18n so descriptions are translated.
 */
export function getShortcutList(t: (key: string) => string): { key: string; description: string }[] {
  return [
    { key: '/', description: t('shortcuts.focusSearch') },
    { key: 'g d', description: t('shortcuts.dashboard') },
    { key: 'g b', description: t('shortcuts.boxes') },
    { key: 'g o', description: t('shortcuts.orders') },
    { key: 'g h', description: t('shortcuts.hrRecords') },
    { key: 'g l', description: t('shortcuts.locations') },
    { key: 'g s', description: t('shortcuts.search') },
    { key: 'g r', description: t('shortcuts.reports') },
    { key: 'g t', description: t('shortcuts.transferLists') },
    { key: 'g i', description: t('shortcuts.import') },
    { key: 'g e', description: t('shortcuts.settings') },
    { key: 'Esc', description: t('shortcuts.closeModal') },
    { key: '?', description: t('shortcuts.showShortcuts') },
  ];
}

