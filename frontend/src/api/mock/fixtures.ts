/**
 * Lazy loaders for the recorded engine fixtures (frontend/src/mocks/fixtures, written by
 * backend/scripts/export_ui_fixtures.py). Each file becomes its own chunk, so the 400 KB storm
 * is only fetched when a page needs it.
 */
import type {
  CertificateView,
  HuntReportView,
  InvestigationEvent,
  PlanReportView,
  StormView,
  SubgraphView,
  SystemView,
  WorkloadEvidenceView,
} from '../types';

type Loader<T> = () => Promise<T>;
type Glob<T> = Record<string, Loader<T>>;

const root = import.meta.glob<StormView | SystemView>('../../mocks/fixtures/*.json', {
  import: 'default',
});
const subgraphs = import.meta.glob<SubgraphView>('../../mocks/fixtures/subgraphs/*.json', {
  import: 'default',
});
const plans = import.meta.glob<PlanReportView>('../../mocks/fixtures/plans/*.json', {
  import: 'default',
});
const hunts = import.meta.glob<HuntReportView>('../../mocks/fixtures/hunts/*.json', {
  import: 'default',
});
const certificates = import.meta.glob<CertificateView>(
  '../../mocks/fixtures/certificates/*.json',
  { import: 'default' },
);
const evidence = import.meta.glob<WorkloadEvidenceView>('../../mocks/fixtures/evidence/*.json', {
  import: 'default',
});
const investigations = import.meta.glob<{ investigation_id: string; events: InvestigationEvent[] }>(
  '../../mocks/fixtures/investigations/*.json',
  { import: 'default' },
);

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');
}

function index<T>(glob: Glob<T>): Map<string, Loader<T>> {
  return new Map(Object.entries(glob).map(([path, load]) => [baseName(path), load]));
}

const byName = {
  root: index(root),
  subgraphs: index(subgraphs),
  plans: index(plans),
  hunts: index(hunts),
  certificates: index(certificates),
  evidence: index(evidence),
  investigations: index(investigations),
};

export type FixtureGroup = Exclude<keyof typeof byName, 'root'>;

/** Names available in a group, e.g. the cluster ids that have a subgraph. */
export function fixtureNames(group: FixtureGroup): string[] {
  return [...byName[group].keys()].sort();
}

async function load<T>(map: Map<string, Loader<T>>, name: string): Promise<T | undefined> {
  const loader = map.get(name);
  // Copy, so nothing that reads a fixture can change the recording.
  return loader ? structuredClone(await loader()) : undefined;
}

export const fixtures = {
  storm: () => load(byName.root, 'storm') as Promise<StormView>,
  system: () => load(byName.root, 'system') as Promise<SystemView>,
  subgraph: (clusterId: string) => load(byName.subgraphs, clusterId),
  plan: (clusterId: string) => load(byName.plans, clusterId),
  hunt: (name: string) => load(byName.hunts, name),
  certificate: (certificateId: string) => load(byName.certificates, certificateId),
  evidence: (podId: string) => load(byName.evidence, podId),
  investigation: (clusterId: string) => load(byName.investigations, clusterId),
};
