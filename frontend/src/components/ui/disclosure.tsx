import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import './disclosure.css';

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
      <Collapsible.Trigger className="group disclosure__trigger">
        <ChevronRight
          className="disclosure__icon"
          aria-hidden
        />
        {icon}
        {summary}
      </Collapsible.Trigger>
      <Collapsible.Content
        className={cn(
          'disclosure__content',
        )}
      >
        {!lazy || open ? <div className="disclosure__block">{children}</div> : null}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
