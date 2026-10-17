import { Moon, Sun } from 'lucide-react';

import { applyTheme, useColorTheme } from '@/lib/theme';

import { Tip } from '../ui/tooltip';
import './ThemeToggle.css';

/** Switches between the light and dark themes; the choice is saved for the next visit. */
export function ThemeToggle() {
  const theme = useColorTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} mode`;
  const toggle = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    // A soft cross-fade where the browser supports view transitions.
    if (!reduce && typeof document.startViewTransition === 'function') {
      document.startViewTransition(() => applyTheme(next));
    } else {
      applyTheme(next);
    }
  };
  return (
    <Tip content={label} side="bottom">
      <button type="button" className="theme-toggle" onClick={toggle} aria-label={label}>
        {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
      </button>
    </Tip>
  );
}
