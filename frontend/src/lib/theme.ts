import { useSyncExternalStore } from 'react';

export type ColorTheme = 'light' | 'dark';

const STORAGE_KEY = 'interdict-theme';
const THEME_COLOR: Record<ColorTheme, string> = { light: '#f5f5f7', dark: '#09090b' };

/** The theme on <html data-theme>, set before the first paint by public/theme.js. */
export function currentTheme(): ColorTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Apply a theme and remember it for the next visit. */
export function applyTheme(theme: ColorTheme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode, disabled site data): the choice lasts for this page only.
  }
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** The current theme, re-rendering when it changes (for components that cannot read CSS variables). */
export function useColorTheme(): ColorTheme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'light');
}
