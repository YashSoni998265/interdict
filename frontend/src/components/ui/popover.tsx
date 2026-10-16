import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function Popover({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  className,
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
  /** Accessible name for the popover content. */
  label: string;
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
          className={cn(
            'z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] animate-fade-in rounded-lg border border-line bg-elevated p-3.5 text-ui text-fg shadow-elevated focus:outline-none',
            className,
          )}
        >
          {children}
          <PopoverPrimitive.Arrow className="fill-elevated" width={12} height={6} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
