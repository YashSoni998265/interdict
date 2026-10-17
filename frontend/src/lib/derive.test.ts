import { describe, expect, it } from 'vitest';

import { fixtures } from '@/api/mock/fixtures';
import type { HuntReportView, PlanReportView } from '@/api/types';

import { buildEvidenceIndex } from './evidence';
import { deriveOverlays, edgeState } from './graphState';
import { deriveInvestigation, railStates } from './investigation';
import { huntPlanHandle, planHandle } from './plan';
import { restraintExample } from './storm';

const AUTH = 'cluster-prod-payments-db-ing-auth';

describe('deriveInvestigation', () => {
  it('pairs tool calls with results and picks out the engine reports', async () => {
    const recording = await fixtures.investigation(AUTH);
    const derived = deriveInvestigation(recording!.events);
    // The agent tries a fix with fully known impact, then accepts unknown impact (backend/agent.py).
    expect(derived.steps.map((s) => s.tool)).toEqual([
      'triage_alert_storm',
      'recall_incident_memory',
      'find_evidence_by_workload',
      'find_attack_paths_to_asset',
      'plan_remediation',
      'hunt_residual_paths',
      'plan_remediation',
      'hunt_residual_paths',
      'submit_remediation_execution',
    ]);
    expect(derived.steps.every((s) => s.state === 'ok')).toBe(true);
    expect(derived.report?.status).toBe('SIMULATED_CONTAINMENT');
    expect(derived.ranMode).toBe('agent');
    expect(derived.notes.some((note) => note.startsWith('Accepted unknown impact'))).toBe(true);
    expect(derived.plan?.status).toBe('PLAN_FOUND');
    expect(derived.hunt?.rounds).toHaveLength(2);
    expect(derived.done?.status).toBe('SIMULATED_CONTAINMENT');
  });

  it('drops duplicate events from a resumed stream and keeps seq order', async () => {
    const recording = await fixtures.investigation(AUTH);
    const events = recording!.events;
    const shuffled = [...events.slice(5), ...events.slice(0, 8)];
    const derived = deriveInvestigation(shuffled);
    expect(derived.items.map((i) => i.seq)).toEqual(deriveInvestigation(events).items.map((i) => i.seq));
    expect(derived.lastSeq).toBe(events.length);
    expect(derived.steps).toHaveLength(9);
  });

  it('shows a running step until its result arrives', async () => {
    const recording = await fixtures.investigation(AUTH);
    const derived = deriveInvestigation(recording!.events.slice(0, 2));
    expect(derived.steps[0]?.state).toBe('running');
    expect(derived.currentState).toBe('TRIAGING');
  });

  it('marks the agent’s narration', () => {
    const derived = deriveInvestigation([
      { seq: 1, at: '2026-10-17T10:00:00Z', type: 'narration', text: 'Planning again.', source: 'agent' },
    ]);
    expect(derived.ranMode).toBe('agent');
  });
});

describe('railStates', () => {
  it('slots unseen typical states in their usual place', () => {
    expect(railStates([])).toEqual(['TRIAGING', 'ANALYZING', 'PLANNING', 'HUNTING', 'EXECUTING']);
    expect(railStates(['TRIAGING', 'ANALYZING', 'SIMULATING'])).toEqual([
      'TRIAGING',
      'ANALYZING',
      'SIMULATING',
      'PLANNING',
      'HUNTING',
      'EXECUTING',
    ]);
  });
});

describe('graph overlays per Hunter round', () => {
  it('cuts the round plan’s steps, marks residual chains and verifies the last round', async () => {
    const subgraph = (await fixtures.subgraph(AUTH))!;
    const plan = (await fixtures.plan(AUTH))!;
    const hunt = (await fixtures.hunt(AUTH))!;
    const overlays = deriveOverlays({ subgraph, initialPlan: plan.plan, hunt });
    expect(overlays.map((o) => o.id)).toEqual(['baseline', 'round:0', 'round:1']);

    const [baseline, round0, round1] = overlays;
    const edge = (id: string) => subgraph.edges.find((e) => e.id === id)!;

    expect(edgeState(edge('auth-1->prod-payments-db'), baseline!)).toBe('active');
    // Round 0 cut auth's GOAL step, but the analytics and frontend→checkout chains survived.
    expect(edgeState(edge('auth-1->prod-payments-db'), round0!)).toBe('cut');
    expect(edgeState(edge('analytics-1->prod-payments-db'), round0!)).toBe('residual');
    expect(edgeState(edge('frontend-1->checkout-1'), round0!)).toBe('residual');
    expect(round0!.verified).toBe(false);
    // Round 1 cut all three GOAL steps; E, F and O found nothing, so the rest is cleared.
    expect(round1!.verified).toBe(true);
    for (const id of ['auth-1->prod-payments-db', 'analytics-1->prod-payments-db', 'checkout-1->prod-payments-db']) {
      expect(edgeState(edge(id), round1!)).toBe('cut');
    }
    expect(edgeState(edge('global-internet->auth-1'), round1!)).toBe('cleared');
  });

  it('shows the proposed plan before the Hunter has run', async () => {
    const subgraph = (await fixtures.subgraph(AUTH))!;
    const plan = (await fixtures.plan(AUTH))!;
    const overlays = deriveOverlays({ subgraph, initialPlan: plan.plan });
    expect(overlays.map((o) => o.kind)).toEqual(['baseline', 'plan']);
    const proposed = overlays[1]!;
    expect([...proposed.cut]).toEqual(['auth-1->prod-payments-db']);
    // Unverified: other steps stay active rather than being claimed safe.
    expect(edgeState(subgraph.edges.find((e) => e.id === 'analytics-1->prod-payments-db')!, proposed)).toBe('active');
  });
});

describe('plan handles', () => {
  it('prefers the API handle and falls back to the engine id in fixtures', async () => {
    const plan = (await fixtures.plan(AUTH))!;
    expect(planHandle(plan)).toBe(plan.plan?.id);
    expect(planHandle({ ...plan, plan_id: 'plan-02431a41871eef51' })).toBe('plan-02431a41871eef51');
    const failed: PlanReportView = { ...plan, status: 'NO_FEASIBLE_PLAN_WITHIN_K', plan_id: null };
    expect(planHandle(failed)).toBeNull();
    const hunt: HuntReportView = (await fixtures.hunt(AUTH))!;
    expect(huntPlanHandle({ ...hunt, plan_id: 'plan-handle' }, plan)).toBe('plan-handle');
    expect(huntPlanHandle(hunt, plan)).toBe(plan.plan?.id);
  });
});

describe('evidence and storm helpers', () => {
  it('indexes backing evidence ids to their provenance', async () => {
    const auth = await fixtures.evidence('auth-1');
    const index = buildEvidenceIndex([auth]);
    const reach = index.get('ev-reach-auth-1-prod-payments-db-5432-tcp');
    expect(reach?.tier).toBe('reachability');
    expect(reach?.provenance[0]?.evidence_source).toBe('SYNTHETIC_GENERATOR');
    expect(index.get('perm-auth-role-prod-payments-db')?.tier).toBe('authorization');
    expect(index.get('vuln-img-shop-auth-DEMO-CVE-001')?.tier).toBe('vulnerability');
  });

  it('finds the restraint example from the engine’s triage classes', async () => {
    const storm = await fixtures.storm();
    expect(restraintExample(storm.alerts)).toEqual({ cve: 'DEMO-CVE-001', onPath: ['auth-1'], notOnPath: ['batch-1'] });
  });
});
