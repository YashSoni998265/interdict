import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;

export interface TipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
  /** Render the trigger as the child element itself (it must be focusable). */
  asChild?: boolean;
}

/** Tooltip on hover and keyboard focus. The trigger must be focusable for keyboard users. */
export function Tip({ content, children, side = 'top', align = 'center', className, asChild = true }: TipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild={asChild}>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-50 max-w-xs animate-fade-in rounded-md border border-line bg-elevated px-2.5 py-2 text-ui text-fg shadow-elevated',
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-elevated" width={10} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
