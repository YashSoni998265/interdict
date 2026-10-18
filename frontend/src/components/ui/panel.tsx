import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('section-label', className)}>{children}</div>;
}
