import { ArrowRight, BadgeCheck, Database, Filter, Network, Play, Radar, Scissors, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useStorm, useSystem } from '@/api/queries';
import { SimulationBadge } from '@/components/layout/SimulationBadge';
import { Num } from '@/components/Num';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { Footer } from '@/components/layout/Footer';
import { restraintExample } from '@/lib/storm';

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Network,
    title: 'Graph',
    body: 'FalkorDB holds the environment: Internet exposure, vulnerabilities, observed network flows, IAM grants and egress policies.',
  },
  {
    icon: Filter,
    title: 'Triage',
    body: 'Every alert gets exactly one class. Only alerts on an Internet → crown-jewel attack path are worth acting on.',
  },
  {
    icon: Scissors,
    title: 'Plan',
    body: 'An exact search over at most 3 egress allowlist policies finds the least disruptive set that cuts every chain.',
  },
  {
    icon: Radar,
    title: 'Hunt',
    body: 'The Path Hunter applies the plan to a copy of the graph and searches again, without the hop limit, using three methods.',
  },
  {
    icon: BadgeCheck,
    title: 'Certificate',
    body: 'Only if all three agree that no path survives: a hashed, expiring “Model-verified containment (simulation)” record.',
  },
];

export default function LandingPage() {
  const storm = useStorm();
  const system = useSystem();
  const s = storm.data;
  const restraint = restraintExample(s?.alerts);
  // The demo continues with the cluster of the workload from the restraint example.
  const firstCluster =
    s?.clusters.find((c) => restraint?.onPath.some((pod) => c.workloads.includes(pod))) ??
    s?.clusters.find((c) => !c.beyond_bound) ??
    s?.clusters[0];

  return (
    <div className="flex flex-1 flex-col">
      <section className="border-b border-line">
        <div className="mx-auto max-w-5xl px-4 pb-14 pt-14 sm:pt-20">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Tag>WeMakeDevs × FalkorDB Graph Hacks 2026 · Track 01: Agents That Act on Connected Data</Tag>
          </div>
          <h1 className="max-w-3xl text-[2.4rem] font-semibold leading-[1.08] tracking-[-0.025em] text-fg sm:text-[3.1rem]">
            Follow the graph, not the alert.
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-7 text-fg-muted">
            Interdict turns an alert storm into the few graph-proven attack paths to your crown-jewel databases, computes
            the cheapest safe egress-policy fix, and certifies, in simulation, that no modelled path survives it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="primary" size="lg">
              <Link to="/storm">
                <Play aria-hidden />
                Run the 60-second demo
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link to="/system">How it is measured</Link>
            </Button>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <SimulationBadge />
            <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-2xs text-fg-muted">
              <Database className="size-3.5" aria-hidden />
              Dataset: synthetic, seed <span className="font-mono text-fg">{system.data?.seed ?? 20261018}</span>
            </span>
            {system.data ? (
              <span className="inline-flex h-7 items-center rounded-md border border-line px-2 text-2xs text-fg-muted">
                FalkorDB <span className="ml-1 font-mono text-fg">{system.data.falkordb_version}</span>
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="how" className="border-b border-line bg-pane">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <h2 id="how" className="section-label mb-4">
            How it works
          </h2>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative rounded-lg border border-line bg-surface p-4">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-md border border-line bg-elevated text-2xs font-semibold text-fg-muted">
                    {index + 1}
                  </span>
                  <step.icon className="size-4 text-fg-muted" aria-hidden />
                  <span className="text-ui font-semibold text-fg">{step.title}</span>
                </div>
                <p className="mt-2.5 text-ui leading-5 text-fg-muted">{step.body}</p>
                {index < STEPS.length - 1 ? (
                  <ArrowRight
                    className="absolute -right-[13px] top-1/2 z-10 hidden size-4 -translate-y-1/2 rounded-full bg-pane text-fg-subtle lg:block"
                    aria-hidden
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-10 md:grid-cols-[1.25fr_1fr]">
        <div className="rounded-lg border border-line bg-surface p-5">
          <h2 className="text-ui font-semibold text-fg">The 60-second path</h2>
          <ol className="mt-3 space-y-3 text-ui text-fg-muted">
            <li className="flex gap-3">
              <span className="font-mono text-2xs text-fg-subtle">0:00</span>
              <span>
                <Link to="/storm" className="text-fg hover:underline">
                  Alert storm
                </Link>
                :{' '}
                {s ? (
                  <>
                    <Num metric="alertsPerClass" value={s.counts.ON_ATTACK_PATH} className="text-fg" /> of{' '}
                    <Num metric="alertsTotal" value={s.total_alerts} className="text-fg" /> alerts sit on a real attack
                    path, in <Num metric="clusters" value={s.clusters.length} className="text-fg" /> clusters.
                  </>
                ) : (
                  'see how many alerts sit on a real attack path.'
                )}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-2xs text-fg-subtle">0:15</span>
              <span>
                Restraint:{' '}
                {restraint ? (
                  <>
                    the same {restraint.cve} is on an attack path on {restraint.onPath.join(', ')} and on no path on{' '}
                    {restraint.notOnPath.join(', ')}.
                  </>
                ) : (
                  'the same vulnerability can matter on one workload and not on another.'
                )}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-2xs text-fg-subtle">0:25</span>
              <span>
                {firstCluster ? (
                  <Link to={`/clusters/${firstCluster.id}`} className="text-fg hover:underline">
                    Investigate {firstCluster.target} via {firstCluster.entry_ingress}
                  </Link>
                ) : (
                  'Investigate a cluster'
                )}
: the Path Hunter re-checks the plan on a copy of the graph, and the plan is widened while any path
                survives, until three independent methods agree.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-2xs text-fg-subtle">0:45</span>
              <span>Break it yourself: expose a workload and add a flow; the certificate stops being current.</span>
            </li>
          </ol>
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface p-5">
            <h2 className="text-ui font-semibold text-fg">The data is synthetic</h2>
            <p className="mt-2 text-ui leading-5 text-fg-muted">
              Generated by our own code (seed {system.data?.seed ?? 20261018}), shaped on Google’s Online Boutique
              (Apache-2.0). Vulnerability IDs are fake (DEMO-CVE-…); attack steps carry MITRE ATT&CK® technique labels
              for display. No real company, cloud account, personal data or scan of a real system is used.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-surface p-5">
            <h2 className="text-ui font-semibold text-fg">What it does not claim</h2>
            <p className="mt-2 text-ui leading-5 text-fg-muted">
              Not real-world containment, not production-equivalent policy simulation, not globally optimal remediation
              (only exact within 3 actions from its catalogue), and no independent validation of the telemetry or the
              threat model. Every result says which of these limits apply.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}
