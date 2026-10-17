import { useQueries } from '@tanstack/react-query';
import { ArrowRight, CircleHelp, Clock, Info, Play, RotateCcw } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { keys, useSandboxOperation, useSandboxReset, useStorm, useSystem } from '@/api/queries';
import type { SandboxOperation, SandboxOpName } from '@/api/types';
import { useBreakIt } from '@/app/breakIt';
import { useApi, useSandboxState } from '@/app/services';
import { cn } from '@/lib/cn';
import { formatUtc, shortHash } from '@/lib/format';
import { tierOfEdge } from '@/lib/evidence';
import { describeSandboxResult } from '@/lib/status';
import { MAX_SANDBOX_OPERATIONS } from '@/state/sandbox';

import { Num } from '../Num';
import { StatusIcon } from '../StatusBadge';
import { Banner, ErrorState } from '../states';
import { Button } from '../ui/button';
import { Disclosure } from '../ui/disclosure';
import { Field, Input, Select } from '../ui/form';
import { Segmented } from '../ui/segmented';
import { Tag } from '../ui/tag';
import './SandboxPanel.css';

const OPS: { op: SandboxOpName; label: string; short: string }[] = [
  { op: 'EXPOSE_WORKLOAD', label: 'Expose a workload', short: 'Expose' },
  { op: 'ADD_LATERAL_REACH', label: 'Add lateral reach', short: 'Add reach' },
  { op: 'EXPIRE_EVIDENCE', label: 'Expire evidence', short: 'Expire' },
];

function opName(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const named = entry as { op?: unknown; name?: unknown };
    if (typeof named.op === 'string') return named.op;
    if (typeof named.name === 'string') return named.name;
  }
  return undefined;
}

/** Plain-language preview of what an operation changes, before it is applied. */
function Preview({ operation }: { operation: SandboxOperation | null }) {
  if (!operation) {
    return <p className="preview">Choose the inputs above to see what this change does.</p>;
  }
  switch (operation.op) {
    case 'EXPOSE_WORKLOAD': {
      const pod = operation.args.pod_id;
      return (
        <div className="preview-2">
          <p>
            Adds a fresh route <span className="preview__label">Internet → default ingress → {pod}</span>’s Service (evidence
            source <code className="preview__code">SANDBOX_USER_CHANGE</code>, valid 2 h).
          </p>
          <p>
            If {pod} runs an active, network-exploitable vulnerability this creates an ENTRY step. Exposure alone does
            not make a workload dangerous: it also needs a route onward to a crown jewel.
          </p>
          <p className="preview__text">The API rejects it if {pod} has no Service.</p>
        </div>
      );
    }
    case 'ADD_LATERAL_REACH': {
      const { src_pod_id: src, dst_pod_id: dst, port } = operation.args;
      return (
        <div className="preview-2">
          <p>
            Adds a fresh observed flow <span className="preview__label">{src} → {dst}:{port}</span>.
          </p>
          <p>
            If {dst} has a network-exploitable vulnerability, the attacker can now move from {src} to {dst} (a LATERAL
            step), which can complete a new chain to a crown jewel.
          </p>
          <p className="preview__text">
            Rejected as “contradicts the egress policies in force” if a policy selecting {src} does not allow it.
          </p>
        </div>
      );
    }
    case 'EXPIRE_EVIDENCE':
      return (
        <div className="preview-2">
          <p>
            Sets <code className="preview__code">valid_until</code> of{' '}
            <span className="preview__label-2">{operation.args.edge_ref}</span> in the past.
          </p>
          <p>
            The sandbox’s evidence is then incomplete, so triage, planning and the Path Hunter answer “Not enough fresh
            evidence” instead of a verdict, and no certificate can be issued until you reset.
          </p>
        </div>
      );
  }
}

export function SandboxPanel({ preset, compact = false }: { preset?: SandboxOperation | undefined; compact?: boolean }) {
  const client = useApi();
  const storm = useStorm();
  const system = useSystem();
  const revision = useSandboxState((s) => s.revision);
  const history = useSandboxState((s) => s.history);
  const apply = useSandboxOperation();
  const reset = useSandboxReset();
  const formId = useId();
  const quickly = useBreakIt(storm.data?.workloads_on_path[0] ?? null);

  const allowedOps = useMemo(() => {
    const listed = system.data?.sandbox_operations?.map(opName).filter(Boolean) as string[] | undefined;
    return listed && listed.length > 0 ? OPS.filter((o) => listed.includes(o.op)) : OPS;
  }, [system.data]);

  const pods = useMemo(() => {
    const data = storm.data;
    if (!data) return { onPath: [] as string[], other: [] as string[] };
    const onPath = [...data.workloads_on_path].sort();
    const all = new Set((data.alerts ?? []).map((a) => a.pod));
    return { onPath, other: [...all].filter((p) => !onPath.includes(p)).sort() };
  }, [storm.data]);
  const allPods = useMemo(() => [...pods.onPath, ...pods.other], [pods]);
  const has = (pod: string) => allPods.includes(pod);

  const [op, setOp] = useState<SandboxOpName>(preset?.op ?? 'EXPOSE_WORKLOAD');
  const [exposePod, setExposePod] = useState(preset?.op === 'EXPOSE_WORKLOAD' ? preset.args.pod_id : '');
  const [src, setSrc] = useState(preset?.op === 'ADD_LATERAL_REACH' ? preset.args.src_pod_id : '');
  const [dst, setDst] = useState(preset?.op === 'ADD_LATERAL_REACH' ? preset.args.dst_pod_id : '');
  const [port, setPort] = useState(preset?.op === 'ADD_LATERAL_REACH' ? String(preset.args.port) : '8080');
  const [edgeRef, setEdgeRef] = useState(preset?.op === 'EXPIRE_EVIDENCE' ? preset.args.edge_ref : '');

  // Evidence edges to offer for EXPIRE_EVIDENCE: the provenance of workloads on attack paths.
  const evidenceQueries = useQueries({
    queries: (op === 'EXPIRE_EVIDENCE' ? pods.onPath : []).map((pod) => ({
      queryKey: keys.evidence(pod),
      queryFn: () => client.getWorkloadEvidence(pod),
      staleTime: 60_000,
    })),
  });
  const edgeOptions = useMemo(() => {
    const options: { pod: string; tier: string; id: string }[] = [];
    const seen = new Set<string>();
    for (const query of evidenceQueries) {
      const view = query.data;
      if (!view) continue;
      for (const tier of Object.values(view.tiers)) {
        for (const record of tier.records as { evidence: { edge_id: string }[] }[]) {
          for (const provenance of record.evidence) {
            if (seen.has(provenance.edge_id)) continue;
            seen.add(provenance.edge_id);
            options.push({ pod: view.pod.id, tier: tierOfEdge(provenance.edge_id), id: provenance.edge_id });
          }
        }
      }
    }
    return options.sort((a, b) => a.pod.localeCompare(b.pod) || a.tier.localeCompare(b.tier) || a.id.localeCompare(b.id));
  }, [evidenceQueries]);

  const exposeValue = exposePod || (has('batch-1') ? 'batch-1' : (pods.other[0] ?? ''));
  const srcValue = src || (has('batch-1') ? 'batch-1' : (allPods[0] ?? ''));
  const dstValue = dst || (has('checkout-1') ? 'checkout-1' : (allPods[1] ?? ''));
  const edgeValue = edgeRef || (edgeOptions.find((o) => o.tier === 'reachability')?.id ?? edgeOptions[0]?.id ?? '');
  const portNumber = Number(port);
  const portError =
    port.trim() === '' || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535
      ? 'Use a whole number from 1 to 65535.'
      : null;

  const operation: SandboxOperation | null = (() => {
    switch (op) {
      case 'EXPOSE_WORKLOAD':
        return exposeValue ? { op, args: { pod_id: exposeValue } } : null;
      case 'ADD_LATERAL_REACH':
        return srcValue && dstValue && !portError
          ? { op, args: { src_pod_id: srcValue, dst_pod_id: dstValue, port: portNumber } }
          : null;
      case 'EXPIRE_EVIDENCE':
        return edgeValue ? { op, args: { edge_ref: edgeValue.trim() } } : null;
    }
  })();

  const applied = history.filter((e) => e.response?.result === 'APPLIED').length;
  const last = apply.data;
  const lastDescriptor = last ? describeSandboxResult(last.result) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (operation) apply.mutate(operation);
  };

  const podOptions = (
    <>
      <optgroup label="On attack paths">
        {pods.onPath.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </optgroup>
      <optgroup label="Other workloads with alerts">
        {pods.other.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </optgroup>
    </>
  );

  return (
    <div className={cn('sandbox-panel', compact ? '' : 'sandbox-panel--not-compact')}>
      <div className="sandbox-panel__row">
        <Tag>
          Sandbox revision{' '}
          {revision !== null ? <Num metric="revision" value={revision} className="sandbox-panel__num" /> : '…'}
        </Tag>
        <Tag>
          <Num metric="sessionOperations" value={applied} className="sandbox-panel__num-2" /> of{' '}
          <Num metric="maxOperations" value={MAX_SANDBOX_OPERATIONS} className="sandbox-panel__num-2" /> operations used
        </Tag>
        <Tag>Your session only</Tag>
      </div>

      {client.mode === 'mock' ? (
        <Banner tone="neutral" icon={Info} title="Mock API: checks only, no recomputation">
          The change is validated and recorded (revision, superseded certificates, audit), but the mock keeps serving
          the revision-1 recording. With the live API, re-running an investigation recomputes every verdict.
        </Banner>
      ) : null}

      <section className="sandbox-quick" aria-label="One-click scenarios">
        <div className="sandbox-quick__card">
          <div className="sandbox-quick__title">Open a new attack path</div>
          <p className="sandbox-quick__text">
            Exposes <span className="sandbox-quick__mono">batch-1</span> (same DEMO-CVE-001 as auth-1) and lets it reach{' '}
            <span className="sandbox-quick__mono">checkout-1</span> on port 8080: a new chain to prod-payments-db.
          </p>
          <Button variant="primary" size="sm" onClick={() => void quickly.openPath()} disabled={!quickly.canOpenPath || quickly.busy}>
            <Play aria-hidden />
            Open a new attack path
          </Button>
        </div>
        <div className="sandbox-quick__card">
          <div className="sandbox-quick__title">Make evidence stale</div>
          <p className="sandbox-quick__text">
            Expires one piece of evidence. Verdicts that depend on it become inconclusive, never “safe”.
          </p>
          <Button variant="secondary" size="sm" onClick={() => void quickly.makeStale()} disabled={!quickly.canMakeStale || quickly.busy}>
            <Clock aria-hidden />
            Make evidence stale
          </Button>
        </div>
        {quickly.last && quickly.last.scenario !== 'reset' ? (
          <p className="sandbox-quick__result" aria-live="polite">
            Now at revision {quickly.last.revision}:{' '}
            {quickly.last.responses.map((r) => describeSandboxResult(r.result).label).join(', ')}. Certificates from earlier
            revisions are no longer current; re-run an investigation to recompute.
          </p>
        ) : null}
        {quickly.error ? <ErrorState error={quickly.error} title="The sandbox change failed" compact /> : null}
      </section>

      <Disclosure summary="Advanced: make a custom change" defaultOpen={Boolean(preset)} className="sandbox-panel__advanced">
        <div className="sandbox-panel__advanced-body">
          <form id={formId} onSubmit={submit} className="sandbox-panel__form" aria-label="Sandbox operation">
            <Segmented
              label="Operation"
              value={op}
              onValueChange={(value) => {
                setOp(value);
                apply.reset();
              }}
              options={allowedOps.map((o) => ({ value: o.op, label: o.short, ariaLabel: o.label }))}
            />

            {op === 'EXPOSE_WORKLOAD' ? (
              <div className="sandbox-panel__block">
                <Field label="Workload" htmlFor={`${formId}-expose`} hint="EXPOSE_WORKLOAD(pod_id)">
                  <Select id={`${formId}-expose`} value={exposeValue} onChange={(e) => setExposePod(e.target.value)}>
                    {podOptions}
                  </Select>
                </Field>
                {has('batch-1') ? (
                  <button
                    type="button"
                    className="sandbox-panel__button"
                    onClick={() => setExposePod('batch-1')}
                  >
                    Demo step 1: expose batch-1 (same DEMO-CVE-001 as auth-1, but not on any path)
                  </button>
                ) : null}
              </div>
            ) : null}

            {op === 'ADD_LATERAL_REACH' ? (
              <div className="sandbox-panel__block">
                <div className="sandbox-panel__grid">
                  <Field label="From" htmlFor={`${formId}-src`}>
                    <Select id={`${formId}-src`} value={srcValue} onChange={(e) => setSrc(e.target.value)}>
                      {podOptions}
                    </Select>
                  </Field>
                  <ArrowRight className="sandbox-panel__icon" aria-hidden />
                  <Field label="To" htmlFor={`${formId}-dst`}>
                    <Select id={`${formId}-dst`} value={dstValue} onChange={(e) => setDst(e.target.value)}>
                      {podOptions}
                    </Select>
                  </Field>
                  <Field label="Port" htmlFor={`${formId}-port`} error={portError}>
                    <Input
                      id={`${formId}-port`}
                      inputMode="numeric"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      aria-invalid={portError ? true : undefined}
                      className="sandbox-panel__input"
                    />
                  </Field>
                </div>
                <p className="sandbox-panel__text">ADD_LATERAL_REACH(src_pod_id, dst_pod_id, port)</p>
                {has('batch-1') && has('checkout-1') ? (
                  <button
                    type="button"
                    className="sandbox-panel__button"
                    onClick={() => {
                      setSrc('batch-1');
                      setDst('checkout-1');
                      setPort('8080');
                    }}
                  >
                    Demo step 2: batch-1 → checkout-1 :8080 (creates a new chain to prod-payments-db)
                  </button>
                ) : null}
              </div>
            ) : null}

            {op === 'EXPIRE_EVIDENCE' ? (
              <div className="sandbox-panel__block">
                <Field
                  label="Evidence edge"
                  htmlFor={`${formId}-edge`}
                  hint="EXPIRE_EVIDENCE(edge_ref): edges recorded for workloads on attack paths"
                >
                  {edgeOptions.length > 0 ? (
                    <Select id={`${formId}-edge`} value={edgeValue} onChange={(e) => setEdgeRef(e.target.value)}>
                      {[...new Set(edgeOptions.map((o) => o.pod))].map((pod) => (
                        <optgroup key={pod} label={pod}>
                          {edgeOptions
                            .filter((o) => o.pod === pod)
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.tier} · {o.id}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      id={`${formId}-edge`}
                      value={edgeRef}
                      onChange={(e) => setEdgeRef(e.target.value)}
                      placeholder={evidenceQueries.some((q) => q.isLoading) ? 'Loading evidence edges…' : 'ev-reach-…'}
                      className="sandbox-panel__input"
                    />
                  )}
                </Field>
              </div>
            ) : null}

            <div className="sandbox-panel__box">
              <div className="section-label sandbox-panel__block-2">What this changes</div>
              <Preview operation={operation} />
              <div className="sandbox-panel__row-2">
                <Clock className="sandbox-panel__icon-2" aria-hidden />
                If applied: the revision goes up by one, and every certificate issued at the current revision becomes
                “Certificate no longer current”.
              </div>
            </div>

            <div className="sandbox-panel__row-3">
              <Button type="submit" variant="primary" disabled={!operation || apply.isPending}>
                <Play aria-hidden />
                {apply.isPending ? 'Applying…' : 'Apply to my sandbox'}
              </Button>
              <span className="sandbox-panel__label">Typed and allowlisted; the agent can never call these.</span>
            </div>
          </form>

          <div aria-live="polite" className="sandbox-panel__block">
            {apply.error ? (
              <ErrorState error={apply.error} title="The operation could not be sent" onRetry={() => operation && apply.mutate(operation)} compact />
            ) : null}
            {last && lastDescriptor ? (
              <div
                className={cn(
                  'sandbox-panel__box-2',
                  last.result === 'APPLIED' ? 'sandbox-panel__box--applied' : 'sandbox-panel__box--not-applied',
                )}
              >
                <div className="sandbox-panel__row-4">
                  <StatusIcon name={lastDescriptor.icon} />
                  {lastDescriptor.label}
                  <span className="sandbox-panel__label-2">{last.result}</span>
                </div>
                <p className="sandbox-panel__text-2">{last.detail}</p>
                {last.superseded_certificates.length > 0 ? (
                  <div className="sandbox-panel__block-3">
                    <div className="section-label">Certificate no longer current</div>
                    <ul className="sandbox-panel__list">
                      {last.superseded_certificates.map((id) => (
                        <li key={id}>
                          <Link to={`/certificates/${id}`} className="sandbox-panel__link">
                            {shortHash(id, 12, 6)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : last.result === 'APPLIED' ? (
                  <p className="sandbox-panel__text-3">No certificate was current at the previous revision.</p>
                ) : null}
              </div>
            ) : null}
          </div>

        </div>
      </Disclosure>

      {history.length > 0 ? (
        <section className="sandbox-panel__section" aria-label="Sandbox history">
          <div className="section-label">This session</div>
          <ol className="sandbox-panel__list-2">
            {[...history].reverse().map((entry) => {
              const descriptor = entry.response ? describeSandboxResult(entry.response.result) : null;
              return (
                <li key={entry.id} className="sandbox-panel-2">
                  <span className="sandbox-panel__label-3">
                    {entry.fromRevision ?? '?'}→{entry.toRevision ?? '?'}
                  </span>
                  <div className="sandbox-panel__block-4">
                    <div className="sandbox-panel__block-5">
                      {entry.kind === 'reset' ? 'Reset to the baseline' : entry.operation?.op}
                      {entry.operation ? (
                        <span className="sandbox-panel__label-4">
                          {Object.values(entry.operation.args).join(' · ')}
                        </span>
                      ) : null}
                    </div>
                    <div className="sandbox-panel__block-6">
                      {formatUtc(entry.at)}
                      {descriptor ? ` · ${descriptor.label}` : ''}
                      {entry.error ? ` · ${entry.error.code}: ${entry.error.message}` : ''}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      <section className="sandbox-panel__section-2" aria-label="Reset">
        <div className="sandbox-panel__row-5">
          <div className="sandbox-panel__block-4">
            <div className="sandbox-panel__block-7">Reset the sandbox</div>
            <p className="sandbox-panel__text-4">
              Re-copies the baseline graph. The revision still goes up (it never goes back), so earlier certificates
              stay no longer current.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => reset.mutate()} disabled={reset.isPending}>
            <RotateCcw aria-hidden />
            {reset.isPending ? 'Resetting…' : 'Reset sandbox'}
          </Button>
        </div>
        {reset.error ? <ErrorState error={reset.error} title="Reset failed" onRetry={() => reset.mutate()} compact /> : null}
        {reset.data ? (
          <p className="sandbox-panel__text-4" role="status">
            Reset done: now at revision {reset.data.revision}. Results from earlier revisions are marked as outdated
            until you re-run them.
          </p>
        ) : null}
      </section>

      <p className="sandbox-panel__text-5">
        <CircleHelp className="sandbox-panel__icon-2" aria-hidden />
        GRANT_DB_ACCESS and REMOVE_POLICY are specified but not built in this version (solution.md §3.5).
      </p>
    </div>
  );
}
