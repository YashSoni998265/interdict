import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { METRICS } from '@/lib/numberSources';

import { Num } from './Num';
import { TooltipProvider } from './ui/tooltip';

function renderNum(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe('<Num> number-source tooltips (solution.md §13.5)', () => {
  it('shows the category and formula on keyboard focus', async () => {
    const user = userEvent.setup();
    renderNum(<Num metric="alertsPerClass" value={69} />);
    const number = screen.getByRole('button', { name: '69' });
    await user.tab();
    expect(number).toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('CALCULATED_GRAPH');
    expect(tooltip).toHaveTextContent('§6.8 partition count');
  });

  it('labels max-flow values as MEASURED_ALGO', async () => {
    const user = userEvent.setup();
    renderNum(<Num metric="maxFlow" value={2} />);
    await user.hover(screen.getByRole('button', { name: '2' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('MEASURED_ALGO');
  });

  it('labels latencies as MEASURED_RUNTIME, formatted as measured', async () => {
    const user = userEvent.setup();
    renderNum(<Num metric="queryLatency" value={22.59} format="ms" />);
    await user.hover(screen.getByRole('button', { name: '22.6 ms' }));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('MEASURED_RUNTIME');
    expect(tooltip).toHaveTextContent('time.perf_counter()');
  });

  it('marks truncated counts with ≥ and says so in the tooltip', async () => {
    const user = userEvent.setup();
    renderNum(<Num metric="chainsBounded" value={3} truncated />);
    const number = screen.getByRole('button', { name: '≥ 3' });
    await user.hover(number);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('the true count is at least this');
  });

  it('includes the qualifier for declared-fixture counts', async () => {
    const user = userEvent.setup();
    renderNum(<Num metric="declaredBroken" value={1} />);
    await user.hover(screen.getByRole('button', { name: '1' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('over DECLARED_FIXTURE');
  });

  it('defines a known category and a formula for every metric', () => {
    const categories = new Set(['CALCULATED_GRAPH', 'MEASURED_ALGO', 'MEASURED_RUNTIME', 'CONSTANT', 'SYNTHETIC_INPUT']);
    for (const [id, source] of Object.entries(METRICS)) {
      expect(categories.has(source.category), id).toBe(true);
      expect(source.formula.length, id).toBeGreaterThan(10);
    }
  });
});
