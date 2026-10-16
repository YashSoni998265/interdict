import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface DisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  /** Render children only once opened (for heavy content such as raw JSON). */
  lazy?: boolean;
  icon?: ReactNode;
}

/** An expander ("Show graph proof"). Keyboard: Enter or Space toggles. */
export function Disclosure({ summary, children, defaultOpen = false, className, lazy = true, icon }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={className}>
      <Collapsible.Trigger className="group inline-flex items-center gap-1.5 rounded text-ui font-medium text-fg-muted transition-colors hover:text-fg">
        <ChevronRight
          className="size-3.5 transition-transform duration-150 group-data-[state=open]:rotate-90"
          aria-hidden
        />
        {icon}
        {summary}
      </Collapsible.Trigger>
      <Collapsible.Content
        className={cn(
          'overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down',
        )}
      >
        {!lazy || open ? <div className="pt-2">{children}</div> : null}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
