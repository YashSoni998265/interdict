import { ArrowRight, BadgeCheck, Database, Filter, Network, Play, Radar, Scissors, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useStorm, useSystem } from '@/api/queries';
import { SimulationBadge } from '@/components/layout/SimulationBadge';
import { Num } from '@/components/Num';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { Footer } from '@/components/layout/Footer';
import { restraintExample } from '@/lib/storm';
import './LandingPage.css';

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
    <div className="landing-page">
      <section className="landing-page__section">
        <div className="landing-page__block">
          <div className="landing-page__row">
            <Tag>WeMakeDevs × FalkorDB Graph Hacks 2026 · Track 01: Agents That Act on Connected Data</Tag>
          </div>
          <h1 className="landing-page__heading">
            Follow the graph, not the alert.
          </h1>
          <p className="landing-page__text">
            Interdict turns an alert storm into the few graph-proven attack paths to your crown-jewel databases, computes
            the cheapest safe egress-policy fix, and certifies, in simulation, that no modelled path survives it.
          </p>
          <div className="landing-page__row-2">
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
          <div className="landing-page__row-3">
            <SimulationBadge />
            <span className="landing-page__chip">
              <Database className="landing-page__icon" aria-hidden />
              Dataset: synthetic, seed <span className="landing-page__label">{system.data?.seed ?? 20261018}</span>
            </span>
            {system.data ? (
              <span className="landing-page__chip-2">
                FalkorDB <span className="landing-page__label-2">{system.data.falkordb_version}</span>
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="how" className="landing-page__section-2">
        <div className="landing-page__block-2">
          <h2 id="how" className="section-label landing-page__title">
            How it works
          </h2>
          <ol className="landing-page__list">
            {STEPS.map((step, index) => (
              <li key={step.title} className="landing-page-2">
                <div className="landing-page__row-4">
                  <span className="landing-page__chip-3">
                    {index + 1}
                  </span>
                  <step.icon className="landing-page__icon-2" aria-hidden />
                  <span className="landing-page__label-3">{step.title}</span>
                </div>
                <p className="landing-page__text-2">{step.body}</p>
                {index < STEPS.length - 1 ? (
                  <ArrowRight
                    className="landing-page__icon-3"
                    aria-hidden
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="landing-page__section-3">
        <div className="landing-page__box">
          <h2 className="landing-page__title-2">The 60-second path</h2>
          <ol className="landing-page__list-2">
            <li className="landing-page__item">
              <span className="landing-page__label-4">0:00</span>
              <span>
                <Link to="/storm" className="landing-page__link">
                  Alert storm
                </Link>
                :{' '}
                {s ? (
                  <>
                    <Num metric="alertsPerClass" value={s.counts.ON_ATTACK_PATH} className="landing-page__num" /> of{' '}
                    <Num metric="alertsTotal" value={s.total_alerts} className="landing-page__num" /> alerts sit on a real attack
                    path, in <Num metric="clusters" value={s.clusters.length} className="landing-page__num" /> clusters.
                  </>
                ) : (
                  'see how many alerts sit on a real attack path.'
                )}
              </span>
            </li>
            <li className="landing-page__item">
              <span className="landing-page__label-4">0:15</span>
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
            <li className="landing-page__item">
              <span className="landing-page__label-4">0:25</span>
              <span>
                {firstCluster ? (
                  <Link to={`/clusters/${firstCluster.id}`} className="landing-page__link">
                    Investigate {firstCluster.target} via {firstCluster.entry_ingress}
                  </Link>
                ) : (
                  'Investigate a cluster'
                )}
: the Path Hunter re-checks the plan on a copy of the graph, and the plan is widened while any path
                survives, until three independent methods agree.
              </span>
            </li>
            <li className="landing-page__item">
              <span className="landing-page__label-4">0:45</span>
              <span>Break it yourself: expose a workload and add a flow; the certificate stops being current.</span>
            </li>
          </ol>
        </div>
        <div className="landing-page__block-3">
          <div className="landing-page__box">
            <h2 className="landing-page__title-2">The data is synthetic</h2>
            <p className="landing-page__text-3">
              Generated by our own code (seed {system.data?.seed ?? 20261018}), shaped on Google’s Online Boutique
              (Apache-2.0). Vulnerability IDs are fake (DEMO-CVE-…); attack steps carry MITRE ATT&CK® technique labels
              for display. No real company, cloud account, personal data or scan of a real system is used.
            </p>
          </div>
          <div className="landing-page__box">
            <h2 className="landing-page__title-2">What it does not claim</h2>
            <p className="landing-page__text-3">
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
