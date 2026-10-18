import { describe, expect, it } from 'vitest';

import type { FlowRef } from '@/api/types';

import { clusterTitle, describeFlow, formatCount, formatMs, INTERNET_ID, nodeLabel, plural } from './format';

describe('formatMs', () => {
  // Each band at its lower edge and just below it, plus typical values that show the padding and rounding.
  it.each([
    [0.8, '0.80 ms'],
    [9.99, '9.99 ms'],
    [10, '10.0 ms'],
    [99.9, '99.9 ms'],
    [100, '100 ms'],
    [124.9, '125 ms'],
    [654.3, '654 ms'],
    [999, '999 ms'],
    [1000, '1.00 s'],
    [1234, '1.23 s'],
  ])('shows %s ms as "%s"', (ms, text) => {
    expect(formatMs(ms)).toBe(text);
  });

  it('shows a dash when the latency is not a finite number', () => {
    expect(formatMs(NaN)).toBe('–');
    expect(formatMs(Infinity)).toBe('–');
    expect(formatMs(-Infinity)).toBe('–');
  });
});

describe('formatCount', () => {
  it('writes whole numbers with en-US thousands separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('rounds a fraction to the nearest whole number', () => {
    expect(formatCount(1234.4)).toBe('1,234');
    expect(formatCount(1234.6)).toBe('1,235');
  });
});

describe('plural', () => {
  it('uses the singular only for exactly one, and adds an s otherwise', () => {
    expect(plural(1, 'alert')).toBe('alert');
    expect(plural(0, 'alert')).toBe('alerts');
    expect(plural(2, 'alert')).toBe('alerts');
  });

  it('uses the plural it is given for a word that does not just add an s', () => {
    expect(plural(1, 'policy', 'policies')).toBe('policy');
    expect(plural(2, 'policy', 'policies')).toBe('policies');
  });
});

describe('describeFlow', () => {
  const flows: Record<string, FlowRef> = {
    'dep-auth-1-billing-1-8080-tcp': { src: 'auth-1', dst: 'billing-1', port: 8080, protocol: 'TCP' },
  };

  it('names a known flow by its source, destination, port and protocol', () => {
    expect(describeFlow('dep-auth-1-billing-1-8080-tcp', flows)).toBe('auth-1 → billing-1 :8080/TCP');
  });

  it('falls back to the id when the flow is unknown or there are no flows', () => {
    expect(describeFlow('dep-unknown', flows)).toBe('dep-unknown');
    expect(describeFlow('dep-auth-1-billing-1-8080-tcp', undefined)).toBe('dep-auth-1-billing-1-8080-tcp');
  });
});

describe('nodeLabel', () => {
  it('calls the internet node "Internet" and leaves any other id unchanged', () => {
    // Must match the engine's id for the internet node (backend engine/evidence.py).
    expect(INTERNET_ID).toBe('global-internet');
    expect(nodeLabel(INTERNET_ID)).toBe('Internet');
    expect(nodeLabel('auth-1')).toBe('auth-1');
  });
});

describe('clusterTitle', () => {
  it('names a cluster by its target and its entry ingress', () => {
    const cluster = { target: 'prod-payments-db', entry_ingress: 'ing-auth' };
    expect(clusterTitle(cluster)).toBe('prod-payments-db via ing-auth');
  });
});
