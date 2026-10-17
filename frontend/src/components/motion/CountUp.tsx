import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

import { staticMotion } from './staticMotion';

const format = (n: number) => n.toLocaleString('en-US');

/** A number that counts to its value when it scrolls into view; screen readers get the final value. */
export function CountUp({
  value,
  from = 0,
  duration = 1400,
  className,
}: {
  value: number;
  from?: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(() => (staticMotion() ? value : from));

  useEffect(() => {
    const element = ref.current;
    if (staticMotion() || !element) {
      setShown(value);
      return;
    }
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - t, 3))));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, from, duration]);

  return (
    <span ref={ref} className={cn('tabular', className)}>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
