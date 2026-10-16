import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

// Semantic surface and text colours come from CSS variables (src/index.css) so a light theme
// can be added without touching components. Status tones use Tailwind's palette directly and
// are mapped in one place: src/lib/status.ts.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', ...defaultTheme.fontFamily.sans],
        mono: ['"JetBrains Mono Variable"', ...defaultTheme.fontFamily.mono],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        ui: ['0.8125rem', { lineHeight: '1.25rem' }],
      },
      colors: {
        canvas: token('canvas'),
        pane: token('pane'),
        surface: token('surface'),
        elevated: token('elevated'),
        hover: token('hover'),
        line: token('line'),
        'line-strong': token('line-strong'),
        fg: token('fg'),
        'fg-muted': token('fg-muted'),
        'fg-subtle': token('fg-subtle'),
        accent: token('accent'),
      },
      borderColor: {
        DEFAULT: token('line'),
      },
      boxShadow: {
        elevated: '0 0 0 1px rgb(var(--line)), 0 12px 32px -12px rgb(0 0 0 / 0.7)',
        focus: '0 0 0 2px rgb(var(--canvas)), 0 0 0 4px rgb(var(--accent))',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'pulse-soft': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
        'collapsible-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-collapsible-content-height)' },
        },
        'collapsible-up': {
          from: { height: 'var(--radix-collapsible-content-height)' },
          to: { height: '0' },
        },
        indeterminate: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(250%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'fade-up': 'fade-up 200ms ease-out',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        'collapsible-down': 'collapsible-down 180ms ease-out',
        'collapsible-up': 'collapsible-up 150ms ease-in',
        indeterminate: 'indeterminate 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
