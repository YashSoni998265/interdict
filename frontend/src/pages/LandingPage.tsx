import { ArrowRight, BadgeCheck, Copy, Database, Eye, FlaskConical, GitBranch, Play, Radar, Scissors, ShieldQuestion, Waypoints, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { useStorm, useSystem } from '@/api/queries';
import { Footer } from '@/components/layout/Footer';
import { StormField, type FieldCluster } from '@/components/landing/StormField';
import { Reveal } from '@/components/motion/Reveal';
import { Button } from '@/components/ui/button';
import { clusterOfPod } from '@/lib/storm';

import './LandingPage.css';

const MOVES: { icon: LucideIcon; title: string; body: string; tools: string[] }[] = [
  {
    icon: Eye,
    title: 'Observe',
    body: 'Joins exposure, vulnerabilities, network flows and IAM grants into attack steps, then walks multi-hop paths from the Internet to each crown-jewel database.',
    tools: ['triage_alert_storm', 'find_evidence_by_workload', 'find_attack_paths_to_asset'],
  },
  {
    icon: Scissors,
    title: 'Decide',
    body: 'Searches every combination of up to 3 egress policies and picks the one that cuts every path while breaking the fewest legitimate connections.',
    tools: ['plan_remediation'],
  },
  {
    icon: Radar,
    title: 'Verify',
    body: 'Applies the plan to a copy of the graph and hunts again with no hop limit. Path search, max-flow and an independent search must all agree.',
    tools: ['hunt_residual_paths'],
  },
  {
    icon: BadgeCheck,
    title: 'Act',
    body: 'Only with a valid certificate does it submit the fix, through a gated and audited action. In this build every action is a simulation.',
    tools: ['submit_remediation_execution'],
  },
];

const GRAPH_POWERS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Waypoints,
    title: 'Multi-hop paths',
    body: 'Variable-length paths and BFS reachability over 11 relationship types find chains that cross several services.',
  },
  {
    icon: GitBranch,
    title: 'Max-flow proof',
    body: 'Unit-capacity max-flow from the Internet to each crown jewel must drop to zero once the fix is applied.',
  },
  {
    icon: Copy,
    title: 'Graph copies',
    body: 'Every visitor gets a private copy of the graph, and every Hunter round runs on its own candidate copy.',
  },
];

export default function LandingPage() {
  const storm = useStorm();
  const system = useSystem();
  const s = storm.data;
  const seed = system.data?.seed ?? 20261018;

  const clusters = useMemo<FieldCluster[]>(() => {
    if (!s) return [];
    const counts = new Map<string, number>();
    for (const alert of s.alerts ?? []) {
      if (alert.triage_class !== 'ON_ATTACK_PATH') continue;
      const cluster = clusterOfPod(s, alert.pod);
      if (cluster) counts.set(cluster.id, (counts.get(cluster.id) ?? 0) + 1);
    }
    return s.clusters.map((c) => ({ id: c.id, target: c.target, via: c.entry_ingress, count: counts.get(c.id) ?? 0 }));
  }, [s]);

  return (
    <div className="landing">
      <section className="landing-hero">
        <p className="landing-hero__eyebrow">WeMakeDevs × FalkorDB Graph Hacks 2026 · Agents That Act on Connected Data</p>
        <h1 className="landing-hero__title">
          Follow the graph,
          <br />
          not the alert.
        </h1>
        <p className="landing-hero__lede">
          An agent that turns a storm of security alerts into the few real attack paths, fixes them with the smallest safe
          change, and verifies the fix on a copy of the graph before it acts.
        </p>
        <div className="landing-hero__actions">
          <Button asChild variant="primary" size="lg">
            <Link to="/demo">
              <Play aria-hidden />
              Start the demo
            </Link>
          </Button>
          <Button asChild variant="link" size="lg">
            <Link to="/storm">
              Explore on your own
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
        <div className="landing-hero__field">
          {s && !s.complete ? (
            <p className="landing-hero__inconclusive">
              Evidence in your sandbox is stale, so the triage is inconclusive: {s.counts.TRIAGE_INCONCLUSIVE} alerts cannot
              be classified, and none is called safe. Reset the sandbox to see the storm again.
            </p>
          ) : s ? (
            <StormField total={s.total_alerts} onPath={s.counts.ON_ATTACK_PATH} clusters={clusters} />
          ) : (
            <div className="landing-hero__field-placeholder" aria-hidden />
          )}
        </div>
      </section>

      <section className="landing-section" aria-labelledby="moves">
        <Reveal className="landing-section__intro">
          <p className="landing-section__eyebrow">How the agent works</p>
          <h2 id="moves" className="landing-section__title">
            Four moves. Each one a graph tool.
          </h2>
          <p className="landing-section__lede">
            The agent reaches FalkorDB only through seven typed MCP tools. It chooses the next move; the graph decides every
            verdict.
          </p>
        </Reveal>
        <ol className="landing-moves">
          {MOVES.map((move, index) => (
            <li key={move.title}>
              <Reveal delay={index * 120} className="landing-move">
                <span className="landing-move__index">{index + 1}</span>
                <move.icon className="landing-move__icon" aria-hidden />
                <h3 className="landing-move__title">{move.title}</h3>
                <p className="landing-move__body">{move.body}</p>
                <ul className="landing-move__tools" aria-label="MCP tools">
                  {move.tools.map((tool) => (
                    <li key={tool} className="landing-move__tool">
                      {tool}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section landing-section--dark" aria-labelledby="graph">
        <Reveal className="landing-section__intro">
          <p className="landing-section__eyebrow">Why the graph</p>
          <h2 id="graph" className="landing-section__title">
            Every verdict comes from the graph.
          </h2>
          <p className="landing-section__lede">
            Remove FalkorDB and nothing can be computed: triage, planning, the Path Hunter and the certificates all run as
            graph operations.
          </p>
        </Reveal>
        <div className="landing-powers">
          {GRAPH_POWERS.map((power, index) => (
            <Reveal key={power.title} delay={index * 120} className="landing-power">
              <power.icon className="landing-power__icon" aria-hidden />
              <h3 className="landing-power__title">{power.title}</h3>
              <p className="landing-power__body">{power.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="landing-section" aria-labelledby="break">
        <Reveal className="landing-break">
          <p className="landing-section__eyebrow">Try to break it</p>
          <h2 id="break" className="landing-section__title">
            Change the graph. Watch the proof fall.
          </h2>
          <p className="landing-section__lede">
            Open a new attack path in your private copy of the graph. The certificate stops being current at once, and the
            next run re-plans from the changed graph.
          </p>
          <Button asChild variant="primary" size="lg">
            <Link to="/demo?step=5">
              Try it in the demo
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </Reveal>
      </section>

      <section className="landing-section landing-section--soft" aria-labelledby="honest">
        <Reveal className="landing-section__intro">
          <p className="landing-section__eyebrow">Honest by design</p>
          <h2 id="honest" className="landing-section__title">
            It says what it cannot prove.
          </h2>
        </Reveal>
        <div className="landing-honest">
          <Reveal className="landing-honest__item">
            <Database className="landing-honest__icon" aria-hidden />
            <h3 className="landing-honest__title">Synthetic data</h3>
            <p className="landing-honest__body">
              Generated by our own code (seed {seed}), shaped on Google’s Online Boutique. Vulnerability IDs are fake
              (DEMO-CVE-…). No real company or cloud data.
            </p>
          </Reveal>
          <Reveal delay={120} className="landing-honest__item">
            <FlaskConical className="landing-honest__icon" aria-hidden />
            <h3 className="landing-honest__title">Simulation only</h3>
            <p className="landing-honest__body">
              Policies are applied to copies of the graph. A certificate means model-verified containment, in simulation;
              it is not evidence of real-world containment.
            </p>
          </Reveal>
          <Reveal delay={240} className="landing-honest__item">
            <ShieldQuestion className="landing-honest__icon" aria-hidden />
            <h3 className="landing-honest__title">Says when it cannot be sure</h3>
            <p className="landing-honest__body">
              Stale or missing evidence makes a verdict inconclusive, never “safe”. When no plan of 3 changes is enough,
              it says so.
            </p>
          </Reveal>
        </div>
        <p className="landing-honest__fine">
          Not claimed: real-world containment, production-equivalent policy simulation, or globally optimal remediation (the
          plan is exact only among plans of at most 3 actions from its catalogue).
        </p>
      </section>
      <Footer />
    </div>
  );
}
