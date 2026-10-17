import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fastMockClient, renderApp } from '@/test/render';

describe('Alert storm', () => {
  it('shows the headline numbers, the funnel with every branch, the clusters and the restraint example', async () => {
    renderApp('/storm');
    // The headline: every alert, the ones on a real attack path, and the places to fix.
    expect(await screen.findByText('alerts in the storm')).toBeInTheDocument();
    expect(screen.getByText('on a real attack path')).toBeInTheDocument();
    // The full funnel, with its graph proofs, is always shown under the headline.
    expect(screen.getByRole('heading', { name: /How we got here/ })).toBeInTheDocument();
    const funnel = screen.getByRole('list', { name: 'Triage funnel' });
    for (const label of ['Alerts', 'Actionable', 'On an attack path', 'Workloads', 'Chains', 'Clusters']) {
      expect(within(funnel).getByText(label)).toBeInTheDocument();
    }
    expect(within(funnel).getByRole('button', { name: '1,000' })).toBeInTheDocument();
    expect(within(funnel).getByRole('button', { name: '69' })).toBeInTheDocument();

    // The inconclusive branch stays visible even when it is empty.
    const branches = screen.getByLabelText('Branches that leave the funnel');
    expect(within(branches).getByText('Not enough fresh evidence')).toBeInTheDocument();
    expect(within(branches).getByText('Vulnerable but not on any attack path')).toBeInTheDocument();
    expect(within(branches).getByText('Not actionable (inactive or not network-exploitable)')).toBeInTheDocument();

    expect(screen.getByText('Same vulnerability, different verdicts')).toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: /prod-payments-db|customer-pii-db/ })).toHaveLength(4);
    expect(screen.getAllByRole('link', { name: /Investigate/ })).toHaveLength(4);
  });
});

describe('Certificate', () => {
  it('shows the claim, the verbatim exclusions and the methods', async () => {
    renderApp('/certificates/cert-4c538538b3304721938d53692dd578ce');
    expect(await screen.findByRole('heading', { name: 'Model-verified containment (simulation)' })).toBeInTheDocument();
    expect(screen.getByText(/not evidence of real-world containment; enforcement depends/)).toBeInTheDocument();
    expect(screen.getByText('E · bounded enumerator')).toBeInTheDocument();
    expect(screen.getByText('F · FalkorDB max-flow')).toBeInTheDocument();
    expect(screen.getByText('O · oracle search')).toBeInTheDocument();
  });

  it('greys the certificate out once a sandbox change supersedes it', async () => {
    const client = fastMockClient();
    await client.createSession();
    await client.applySandboxOperation({ op: 'EXPOSE_WORKLOAD', args: { pod_id: 'batch-1' } });
    renderApp('/certificates/cert-4c538538b3304721938d53692dd578ce', client);
    expect(await screen.findByRole('heading', { name: 'Certificate no longer current' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Superseded: issued at revision 1, the sandbox is now at revision 2/)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Re-run/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Model-verified containment (simulation)' })).not.toBeInTheDocument();
  });

  it('shows a typed error with a retry for an unknown certificate', async () => {
    renderApp('/certificates/cert-unknown');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('NOT_FOUND · HTTP 404')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });
});

describe('System', () => {
  it('lists the FalkorDB version, the seed and measured latencies', async () => {
    renderApp('/system');
    expect(await screen.findByText('4.22.1')).toBeInTheDocument();
    expect(screen.getAllByText('20261018').length).toBeGreaterThan(0);
    expect(await screen.findByRole('table', { name: /Measured latency/ })).toBeInTheDocument();
    expect(screen.getByText(/LIVE disabled: simulation only/)).toBeInTheDocument();
  });
});
