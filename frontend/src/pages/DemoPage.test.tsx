import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { renderApp, setViewportWidth } from '@/test/render';

const heading = () => screen.findByRole('heading', { level: 1 });

async function runAgent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Run the agent' }));
  await screen.findByRole('button', { name: 'Run it again' }, { timeout: 10_000 });
}

describe('Guided demo', () => {
  beforeEach(() => {
    setViewportWidth(1440);
  });

  it('tells the story from the storm to the proof, with the engine’s own results', async () => {
    const user = userEvent.setup();
    renderApp('/demo');
    expect(await heading()).toHaveTextContent(/1,000 alerts\.\s*Only 69 matter\./);
    expect(screen.getByText('Same vulnerability, different verdicts')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Next: The agent/ }));
    expect(await heading()).toHaveTextContent('The agent investigates.');
    await runAgent(user);
    const timeline = screen.getByRole('list', { name: 'The agent’s tool calls' });
    expect(within(timeline).getByText('Hunt for paths that survive the plan')).toBeInTheDocument();
    expect(screen.getByText(/generated without the AI narrator/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Next: The hunt/ }));
    expect(await heading()).toHaveTextContent('The first fix wasn’t enough.');
    // The paths the Path Hunter found beyond the first plan, from its round-0 residuals.
    expect(screen.getByText('Paths the first plan missed')).toBeInTheDocument();
    expect(screen.getByText('analytics-1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Next: The action/ }));
    expect(await heading()).toHaveTextContent('It acts, with proof.');
    await waitFor(() => expect(screen.getByText('Model-verified containment (simulation)')).toBeInTheDocument());
    expect(screen.getByText(/This is not evidence of real-world containment/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the certificate/ })).toHaveAttribute(
      'href',
      '/certificates/cert-4c538538b3304721938d53692dd578ce',
    );
    expect(screen.getByRole('button', { name: /Download the policies/ })).toBeInTheDocument();
  });

  it('marks the certificate no longer current once a new attack path is opened', async () => {
    const user = userEvent.setup();
    renderApp('/demo?step=2');
    await runAgent(user);
    await user.click(screen.getByRole('button', { name: /Break it/ }));
    expect(await heading()).toHaveTextContent('Now try to break it.');
    await user.click(screen.getByRole('button', { name: 'Open a new attack path' }));
    await waitFor(() => expect(screen.getByText('no longer current')).toBeInTheDocument());
    expect(screen.getByText('2 changes applied', { exact: false })).toBeInTheDocument();
  });

  it('asks for the agent’s run before showing the hunt', async () => {
    renderApp('/demo?step=3');
    expect(await screen.findByText('This step needs the agent’s results')).toBeInTheDocument();
  });
});
