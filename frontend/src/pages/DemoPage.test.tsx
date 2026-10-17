import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { recordedCertificateId, renderApp, setViewportWidth } from '@/test/render';

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
    expect(screen.getByText(/Same vulnerability, different verdicts/)).toBeInTheDocument();
    // What an alert needs to matter, and where the other 931 went (549 + 382 + 0).
    expect(screen.getByText('An alert matters only if the graph shows all four')).toBeInTheDocument();
    expect(screen.getByText('Where the other 931 alerts went')).toBeInTheDocument();
    // Severity against the graph's verdict, and real alerts behind the 69.
    expect(screen.getByText('Severity is not the answer')).toBeInTheDocument();
    expect(screen.getByText('A few of the 69 alerts that matter')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Next: The agent/ }));
    expect(await heading()).toHaveTextContent('The agent investigates.');
    await runAgent(user);
    const timeline = screen.getByRole('list', { name: 'The agent’s tool calls' });
    expect(within(timeline).getAllByText('Hunt for paths that survive the plan')).toHaveLength(2);
    expect(screen.getByText(/No AI model and no API key/)).toBeInTheDocument();
    // Each step shows the agent's decision: here, accepting unknown impact after a stricter try.
    expect(within(timeline).getByText('Plan a fix with fully known impact')).toBeInTheDocument();
    expect(within(timeline).getByText(/Accept unknown impact, and flag it/)).toBeInTheDocument();
    expect(screen.getByText('What the agent can and cannot do')).toBeInTheDocument();
    expect(screen.getByText('At most 12 tool calls per investigation')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Next: The hunt/ }));
    expect(await heading()).toHaveTextContent('The first fix wasn’t enough.');
    // The paths the Path Hunter found beyond the first plan, from its round-0 residuals.
    // The rounds card lists the paths the first plan missed.
    expect(screen.getByText('Internet → analytics-1 → prod-payments-db')).toBeInTheDocument();
    // The rounds and the three checks, with the last round's results.
    expect(screen.getByText('2 paths survived')).toBeInTheDocument();
    expect(screen.getByText('no modelled path survives')).toBeInTheDocument();
    expect(screen.getByText('0 chains left')).toBeInTheDocument();
    expect(screen.getByText('Three independent checks, on a copy of the graph')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Next: The action/ }));
    expect(await heading()).toHaveTextContent('It acts, with proof.');
    await waitFor(() => expect(screen.getByText('Model-verified containment (simulation)')).toBeInTheDocument());
    expect(screen.getByText(/This is not evidence of real-world containment/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the certificate/ })).toHaveAttribute(
      'href',
      `/certificates/${await recordedCertificateId()}`,
    );
    expect(screen.getByRole('button', { name: /Download the policies/ })).toBeInTheDocument();
    expect(screen.getByText('A VALID certificate at the current sandbox revision')).toBeInTheDocument();
    // The policy file preview and what the fix costs.
    expect(screen.getByText('Preview of the policy file')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Impact of the fix' })).getByText('attack paths cut')).toBeInTheDocument();
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
    expect(screen.getByText('Your sandbox right now')).toBeInTheDocument();
    expect(screen.getByText('Changes applied')).toBeInTheDocument();
  });

  it('runs the agent by itself when a visitor opens the hunt directly', async () => {
    renderApp('/demo?step=3');
    expect(await screen.findByRole('heading', { level: 1, name: 'The first fix wasn’t enough.' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText('Round by round')).toBeInTheDocument();
  });
});
