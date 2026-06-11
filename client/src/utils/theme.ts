export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'archivecore-theme';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  return saved === 'dark' || saved === 'system' || saved === 'light' ? saved : 'light';
}

export function applyThemePreference(preference: ThemePreference) {
  if (typeof document === 'undefined') return;

  const resolvedTheme = preference === 'system' ? getSystemTheme() : preference;
  document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  document.documentElement.dataset.theme = preference;

  const metaThemeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.content = resolvedTheme === 'dark' ? '#111827' : '#2563eb';
  }
}

export function setStoredThemePreference(preference: ThemePreference) {
  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  applyThemePreference(preference);
}
