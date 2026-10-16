import { useQueries } from '@tanstack/react-query';
import { ArrowRight, CircleHelp, Clock, Info, Play, RotateCcw } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { keys, useSandboxOperation, useSandboxReset, useStorm, useSystem } from '@/api/queries';
import type { SandboxOperation, SandboxOpName } from '@/api/types';
import { useApi, useSandboxState } from '@/app/services';
import { cn } from '@/lib/cn';
import { formatUtc, shortHash } from '@/lib/format';
import { describeSandboxResult } from '@/lib/status';

import { Num } from '../Num';
import { StatusIcon } from '../StatusBadge';
import { Banner, ErrorState } from '../states';
import { Button } from '../ui/button';
import { Field, Input, Select } from '../ui/form';
import { Segmented } from '../ui/segmented';
import { Tag } from '../ui/tag';

const OPS: { op: SandboxOpName; label: string; short: string }[] = [
  { op: 'EXPOSE_WORKLOAD', label: 'Expose a workload', short: 'Expose' },
  { op: 'ADD_LATERAL_REACH', label: 'Add lateral reach', short: 'Add reach' },
  { op: 'EXPIRE_EVIDENCE', label: 'Expire evidence', short: 'Expire' },
];

const MAX_OPERATIONS = 20;

function opName(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const named = entry as { op?: unknown; name?: unknown };
    if (typeof named.op === 'string') return named.op;
    if (typeof named.name === 'string') return named.name;
  }
  return undefined;
}

function tierOfEdge(edgeId: string): string {
  if (/^ev-(exposes|routes|targets)-/.test(edgeId)) return 'exposure';
  if (/^ev-(runs|hasvuln)-/.test(edgeId)) return 'vulnerability';
  if (edgeId.startsWith('ev-reach-')) return 'reachability';
  if (/^ev-(assumes|grants|applies)-/.test(edgeId)) return 'authorization';
  return 'evidence';
}

/** Plain-language preview of what an operation changes, before it is applied. */
function Preview({ operation }: { operation: SandboxOperation | null }) {
  if (!operation) {
    return <p className="text-ui text-fg-muted">Choose the inputs above to see what this change does.</p>;
  }
  switch (operation.op) {
    case 'EXPOSE_WORKLOAD': {
      const pod = operation.args.pod_id;
      return (
        <div className="space-y-2 text-ui text-fg-muted">
          <p>
            Adds a fresh route <span className="text-fg">Internet → default ingress → {pod}</span>’s Service (evidence
            source <code className="font-mono text-2xs">SANDBOX_USER_CHANGE</code>, valid 2 h).
          </p>
          <p>
            If {pod} runs an active, network-exploitable vulnerability this creates an ENTRY step. Exposure alone does
            not make a workload dangerous: it also needs a route onward to a crown jewel.
          </p>
          <p className="text-2xs text-fg-subtle">The API rejects it if {pod} has no Service.</p>
        </div>
      );
    }
    case 'ADD_LATERAL_REACH': {
      const { src_pod_id: src, dst_pod_id: dst, port } = operation.args;
      return (
        <div className="space-y-2 text-ui text-fg-muted">
          <p>
            Adds a fresh observed flow <span className="text-fg">{src} → {dst}:{port}</span>.
          </p>
          <p>
            If {dst} has a network-exploitable vulnerability, the attacker can now move from {src} to {dst} (a LATERAL
            step), which can complete a new chain to a crown jewel.
          </p>
          <p className="text-2xs text-fg-subtle">
            Rejected as “contradicts the egress policies in force” if a policy selecting {src} does not allow it.
          </p>
        </div>
      );
    }
    case 'EXPIRE_EVIDENCE':
      return (
        <div className="space-y-2 text-ui text-fg-muted">
          <p>
            Sets <code className="font-mono text-2xs">valid_until</code> of{' '}
            <span className="font-mono text-[12px] text-fg">{operation.args.edge_ref}</span> in the past.
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
    <div className={cn('space-y-5', compact ? '' : 'max-w-2xl')}>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-muted">
        <Tag>
          Sandbox revision{' '}
          {revision !== null ? <Num metric="revision" value={revision} className="font-mono text-fg" /> : '…'}
        </Tag>
        <Tag>
          <Num metric="sessionOperations" value={applied} className="text-fg" /> of{' '}
          <Num metric="maxOperations" value={MAX_OPERATIONS} className="text-fg" /> operations used
        </Tag>
        <Tag>Your session only</Tag>
      </div>

      {client.mode === 'mock' ? (
        <Banner tone="neutral" icon={Info} title="Mock API: checks only, no recomputation">
          The change is validated and recorded (revision, superseded certificates, audit), but the mock keeps serving
          the revision-1 recording. With the live API, re-running an investigation recomputes every verdict.
        </Banner>
      ) : null}

      <form id={formId} onSubmit={submit} className="space-y-4" aria-label="Sandbox operation">
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
          <div className="space-y-3">
            <Field label="Workload" htmlFor={`${formId}-expose`} hint="EXPOSE_WORKLOAD(pod_id)">
              <Select id={`${formId}-expose`} value={exposeValue} onChange={(e) => setExposePod(e.target.value)}>
                {podOptions}
              </Select>
            </Field>
            {has('batch-1') ? (
              <button
                type="button"
                className="text-2xs text-accent hover:underline"
                onClick={() => setExposePod('batch-1')}
              >
                Demo step 1: expose batch-1 (same DEMO-CVE-001 as auth-1, but not on any path)
              </button>
            ) : null}
          </div>
        ) : null}

        {op === 'ADD_LATERAL_REACH' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr_6rem] sm:items-end">
              <Field label="From" htmlFor={`${formId}-src`}>
                <Select id={`${formId}-src`} value={srcValue} onChange={(e) => setSrc(e.target.value)}>
                  {podOptions}
                </Select>
              </Field>
              <ArrowRight className="mx-auto mb-2 hidden size-4 text-fg-subtle sm:block" aria-hidden />
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
                  className="font-mono"
                />
              </Field>
            </div>
            <p className="text-2xs text-fg-subtle">ADD_LATERAL_REACH(src_pod_id, dst_pod_id, port)</p>
            {has('batch-1') && has('checkout-1') ? (
              <button
                type="button"
                className="text-2xs text-accent hover:underline"
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
          <div className="space-y-3">
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
                  className="font-mono"
                />
              )}
            </Field>
          </div>
        ) : null}

        <div className="rounded-lg border border-line bg-canvas px-3.5 py-3">
          <div className="section-label mb-2">What this changes</div>
          <Preview operation={operation} />
          <div className="mt-3 flex items-start gap-1.5 border-t border-line pt-2.5 text-2xs text-fg-subtle">
            <Clock className="mt-px size-3 shrink-0" aria-hidden />
            If applied: the revision goes up by one, and every certificate issued at the current revision becomes
            “Certificate no longer current”.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={!operation || apply.isPending}>
            <Play aria-hidden />
            {apply.isPending ? 'Applying…' : 'Apply to my sandbox'}
          </Button>
          <span className="text-2xs text-fg-subtle">Typed and allowlisted; the agent can never call these.</span>
        </div>
      </form>

      <div aria-live="polite" className="space-y-3">
        {apply.error ? (
          <ErrorState error={apply.error} title="The operation could not be sent" onRetry={() => operation && apply.mutate(operation)} compact />
        ) : null}
        {last && lastDescriptor ? (
          <div
            className={cn(
              'rounded-lg border px-3.5 py-3',
              last.result === 'APPLIED' ? 'border-line bg-surface' : 'border-zinc-500/30 bg-zinc-500/10',
            )}
          >
            <div className="flex items-center gap-2 text-ui font-medium text-fg">
              <StatusIcon name={lastDescriptor.icon} />
              {lastDescriptor.label}
              <span className="font-mono text-2xs font-normal text-fg-muted">{last.result}</span>
            </div>
            <p className="mt-1 text-ui text-fg-muted">{last.detail}</p>
            {last.superseded_certificates.length > 0 ? (
              <div className="mt-2.5 space-y-1">
                <div className="section-label">Certificate no longer current</div>
                <ul className="space-y-1">
                  {last.superseded_certificates.map((id) => (
                    <li key={id}>
                      <Link to={`/certificates/${id}`} className="font-mono text-[12px] text-accent hover:underline">
                        {shortHash(id, 12, 6)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : last.result === 'APPLIED' ? (
              <p className="mt-2 text-2xs text-fg-subtle">No certificate was current at the previous revision.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {history.length > 0 ? (
        <section className="space-y-2" aria-label="Sandbox history">
          <div className="section-label">This session</div>
          <ol className="divide-y divide-line rounded-lg border border-line">
            {[...history].reverse().map((entry) => {
              const descriptor = entry.response ? describeSandboxResult(entry.response.result) : null;
              return (
                <li key={entry.id} className="flex items-start gap-3 px-3 py-2 text-ui">
                  <span className="mt-0.5 font-mono text-2xs text-fg-subtle">
                    {entry.fromRevision ?? '?'}→{entry.toRevision ?? '?'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-fg">
                      {entry.kind === 'reset' ? 'Reset to the baseline' : entry.operation?.op}
                      {entry.operation ? (
                        <span className="ml-1.5 font-mono text-2xs text-fg-muted">
                          {Object.values(entry.operation.args).join(' · ')}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-2xs text-fg-subtle">
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

      <section className="space-y-2 rounded-lg border border-line px-3.5 py-3" aria-label="Reset">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-ui font-medium text-fg">Reset the sandbox</div>
            <p className="text-2xs text-fg-muted">
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
          <p className="text-2xs text-fg-muted" role="status">
            Reset done: now at revision {reset.data.revision}. Results from earlier revisions are marked as outdated
            until you re-run them.
          </p>
        ) : null}
      </section>

      <p className="flex items-start gap-1.5 text-2xs text-fg-subtle">
        <CircleHelp className="mt-px size-3 shrink-0" aria-hidden />
        GRANT_DB_ACCESS and REMOVE_POLICY are specified but not built in this version (solution.md §3.5).
      </p>
    </div>
  );
}
