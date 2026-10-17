import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { renderApp } from '@/test/render';

describe('Theme toggle', () => {
  afterEach(() => {
    document.documentElement.dataset.theme = 'light';
    window.localStorage.clear();
  });

  it('switches between light and dark and remembers the choice', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('interdict-theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('interdict-theme')).toBe('light');
  });
});
