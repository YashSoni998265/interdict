import type { FlowRef } from '@/api/types';

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatCount(value: number): string {
  return integer.format(value);
}

/** Latency as measured: two decimals under 10 ms, one under 100 ms, seconds from 1,000 ms. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "17 Oct 2026, 10:00:00 UTC". Data timestamps are shown in UTC so they match the records. */
export function formatUtc(iso: string | null | undefined, options: { seconds?: boolean } = {}): string {
  if (!iso) return 'not recorded';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}${
    options.seconds === false ? '' : `:${pad(date.getUTCSeconds())}`
  }`;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${time} UTC`;
}

/** "10:00:02.340 UTC" for timeline events. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${String(
    date.getUTCMilliseconds(),
  ).padStart(3, '0')}`;
}

/** "in 11 h 4 min" / "3 min ago": a display convenience against the app clock. */
export function formatRelative(iso: string, now: Date): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '';
  const diff = target - now.getTime();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  let text: string;
  if (minutes < 1) text = 'less than a minute';
  else if (minutes < 60) text = `${minutes} min`;
  else {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    text = hours < 48 ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${Math.round(hours / 24)} days`;
  }
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

/** Seconds since the first event, e.g. "+1.26 s". */
export function formatOffset(iso: string, startIso: string): string {
  const offset = (new Date(iso).getTime() - new Date(startIso).getTime()) / 1000;
  return Number.isFinite(offset) ? `+${offset.toFixed(2)} s` : '';
}

/** "sha256:5bec0202…a71acb". */
export function shortHash(hash: string | null | undefined, head = 8, tail = 6): string {
  if (!hash) return 'not recorded';
  const [prefix, hex] = hash.includes(':') ? (hash.split(':', 2) as [string, string]) : ['', hash];
  if (hex.length <= head + tail + 1) return hash;
  return `${prefix ? `${prefix}:` : ''}${hex.slice(0, head)}…${tail > 0 ? hex.slice(-tail) : ''}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** "auth-1 → billing-1 :8080/TCP" for a flow or dependency id, or the id itself. */
export function describeFlow(id: string, flows: Record<string, FlowRef> | undefined): string {
  const flow = flows?.[id];
  return flow ? `${flow.src} → ${flow.dst} :${flow.port}/${flow.protocol}` : id;
}

export const INTERNET_ID = 'global-internet';

export function nodeLabel(id: string): string {
  return id === INTERNET_ID ? 'Internet' : id;
}

/** Human title for a cluster: "prod-payments-db via ing-auth". */
export function clusterTitle(cluster: { target: string; entry_ingress: string }): string {
  return `${cluster.target} via ${cluster.entry_ingress}`;
}
