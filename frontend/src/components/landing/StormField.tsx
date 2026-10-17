import { ArrowRight, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

import { staticMotion } from '../motion/staticMotion';
import './StormField.css';

export interface FieldCluster {
  id: string;
  target: string;
  via: string;
  /** Alerts on an attack path that belong to this cluster. */
  count: number;
}

interface Dot {
  x: number;
  y: number;
  delay: number;
  /** Index into the clusters for an alert on a path, or -1. */
  cluster: number;
  tx: number;
  ty: number;
}

/** Milestones of the animation, in ms. */
const T = { appear: 1100, paths: [1300, 2300], gather: [3000, 4700], end: 4900 } as const;
const GREY: [number, number, number] = [110, 110, 115];
const RED: [number, number, number] = [225, 29, 72];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const progress = (t: number, [a, b]: readonly [number, number]) => clamp01((t - a) / (b - a));

/** Split the on-path alerts over the clusters in proportion to their counts. */
function quotas(onPath: number, clusters: FieldCluster[]): number[] {
  const total = clusters.reduce((sum, c) => sum + c.count, 0);
  if (clusters.length === 0) return [];
  const raw = clusters.map((c) => (total > 0 ? (c.count / total) * onPath : onPath / clusters.length));
  const result = raw.map(Math.floor);
  let rest = onPath - result.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
    rest -= 1;
  }
  return result;
}

function layout(width: number, height: number, total: number, onPath: number, clusters: FieldCluster[]) {
  const random = mulberry32(20261018);
  const cols = Math.max(1, Math.ceil(Math.sqrt((total * width) / height)));
  const rows = Math.max(1, Math.ceil(total / cols));
  const sx = width / (cols + 1);
  const sy = height / (rows + 1);
  const radius = Math.max(1.4, Math.min(sx, sy) * 0.24);
  const dots: Dot[] = [];
  for (let i = 0; i < total; i += 1) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    dots.push({
      x: (c + 1) * sx + (random() - 0.5) * sx * 0.5,
      y: (r + 1) * sy + (random() - 0.5) * sy * 0.5,
      delay: random() * 800,
      cluster: -1,
      tx: 0,
      ty: 0,
    });
  }
  // A deterministic, spread-out choice of the alerts on a path.
  const order = dots.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0];
  }
  const shares = quotas(Math.min(onPath, total), clusters);
  const centres = clusters.map((_, i) => ({ x: (width * (i + 1)) / (clusters.length + 1), y: height * 0.42 }));
  const spacing = radius * 2.9;
  let next = 0;
  shares.forEach((share, ci) => {
    for (let k = 0; k < share; k += 1) {
      const dot = dots[order[next] ?? 0];
      next += 1;
      if (!dot) continue;
      const angle = k * 2.39996;
      const dist = spacing * Math.sqrt(k + 0.5);
      dot.cluster = ci;
      dot.tx = (centres[ci]?.x ?? 0) + Math.cos(angle) * dist;
      dot.ty = (centres[ci]?.y ?? 0) + Math.sin(angle) * dist;
    }
  });
  const reach = shares.map((share) => spacing * Math.sqrt(share + 0.5));
  return { dots, radius, centres, reach };
}

type Layout = ReturnType<typeof layout>;

function draw(ctx: CanvasRenderingContext2D, data: Layout, t: number, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  const lit = easeOut(progress(t, T.paths));
  const gather = easeInOut(progress(t, T.gather));
  for (const dot of data.dots) {
    const appear = clamp01((t - dot.delay) / 320);
    if (appear <= 0) continue;
    const onPath = dot.cluster >= 0;
    const mix = onPath ? lit : 0;
    const rgb = GREY.map((g, i) => Math.round(g + ((RED[i] ?? g) - g) * mix));
    const alpha = appear * (onPath ? 0.5 + 0.5 * mix : 0.5 - 0.32 * lit);
    const x = onPath ? dot.x + (dot.tx - dot.x) * gather : dot.x;
    const y = onPath ? dot.y + (dot.ty - dot.y) * gather : dot.y;
    const r = data.radius * (onPath ? 1 + 0.35 * mix : 1) * (0.6 + 0.4 * appear);
    if (onPath && mix > 0) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(${RED.join(',')},${0.14 * mix})`;
      ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.fillStyle = `rgba(${rgb.join(',')},${alpha})`;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The landing animation: one dot per alert in the storm. The alerts on a real attack path
 * light up, then gather into their clusters. Every count comes from the storm report.
 */
export function StormField({ total, onPath, clusters }: { total: number; onPath: number; clusters: FieldCluster[] }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState(0);
  const [run, setRun] = useState(0);
  const [labels, setLabels] = useState<{ x: number; y: number }[]>([]);

  useEffect(() => {
    const host = stage.current;
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!host || !element || !ctx) return;
    const still = staticMotion();
    let start = 0;
    let frame = 0;
    let data: Layout | null = null;
    let size = { width: 0, height: 0 };
    let reached = 0;

    const setup = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      size = { width, height };
      data = layout(width, height, total, onPath, clusters);
      setLabels(
        data.centres.map((c, i) => ({
          x: (c.x / width) * 100,
          y: ((c.y + (data?.reach[i] ?? 0) + 10) / height) * 100,
        })),
      );
    };

    const at = (t: number) => {
      if (!data) return;
      draw(ctx, data, t, size.width, size.height);
      const next = t >= T.gather[0] ? 3 : t >= T.paths[0] ? 2 : t > 0 ? 1 : 0;
      if (next !== reached) {
        reached = next;
        setPhase(next);
      }
    };

    const tick = (now: number) => {
      if (!start) start = now;
      const t = now - start;
      at(Math.min(t, T.end));
      if (t < T.end) frame = requestAnimationFrame(tick);
    };

    setup();
    if (still) {
      at(T.end);
    } else {
      setPhase(0);
      frame = requestAnimationFrame(tick);
    }

    const resize = new ResizeObserver(() => {
      if (Math.abs(host.clientWidth - size.width) < 1 && Math.abs(host.clientHeight - size.height) < 1) return;
      setup();
      at(start ? Math.min(performance.now() - start, T.end) : T.end);
    });
    resize.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [total, onPath, clusters, run]);

  return (
    <figure
      className="storm-field"
      aria-label={`${total} alerts in the storm; ${onPath} sit on a real attack path, in ${clusters.length} clusters.`}
    >
      <div ref={stage} className="storm-field__stage">
        <canvas ref={canvas} className="storm-field__canvas" aria-hidden />
        {clusters.map((cluster, i) => {
          const label = labels[i];
          return label ? (
            <div
              key={cluster.id}
              className={cn('storm-field__cluster', phase >= 3 && 'storm-field__cluster--shown')}
              style={{ left: `${label.x}%`, top: `${label.y}%` }}
              aria-hidden
            >
              <span className="storm-field__cluster-target">{cluster.target}</span>
              <span className="storm-field__cluster-via">via {cluster.via}</span>
            </div>
          ) : null;
        })}
      </div>
      <figcaption className="storm-field__steps">
        <span className={cn('storm-field__step', phase >= 1 && 'storm-field__step--on')}>
          <span className="storm-field__value">{total.toLocaleString('en-US')}</span>
          <span className="storm-field__label">alerts in the storm</span>
        </span>
        <ArrowRight className="storm-field__arrow" aria-hidden />
        <span className={cn('storm-field__step storm-field__step--red', phase >= 2 && 'storm-field__step--on')}>
          <span className="storm-field__value">{onPath.toLocaleString('en-US')}</span>
          <span className="storm-field__label">on a real attack path</span>
        </span>
        <ArrowRight className="storm-field__arrow" aria-hidden />
        <span className={cn('storm-field__step', phase >= 3 && 'storm-field__step--on')}>
          <span className="storm-field__value">{clusters.length}</span>
          <span className="storm-field__label">places to fix</span>
        </span>
        <button type="button" className="storm-field__replay" onClick={() => setRun((n) => n + 1)}>
          <RotateCcw aria-hidden />
          Replay
        </button>
      </figcaption>
    </figure>
  );
}
