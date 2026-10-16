import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Read by screen readers when the sheet opens. */
  description: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg';
  /** Extra content shown in the header, right of the title. */
  headerExtra?: ReactNode;
}

/** A right-hand drawer (modal, focus-trapped, Escape closes). */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'md',
  headerExtra,
}: SheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade-in bg-black/60 backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full animate-slide-in-right flex-col border-l border-line bg-pane shadow-elevated focus:outline-none',
            width === 'md' ? 'sm:max-w-md' : 'sm:max-w-2xl',
          )}
        >
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-sm font-semibold text-fg">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-ui text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            </div>
            {headerExtra}
            <DialogPrimitive.Close
              className="-mr-1 rounded-md p-1 text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              aria-label="Close"
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <footer className="border-t border-line px-5 py-3">{footer}</footer> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  size?: 'md' | 'xl';
}

/** A centred dialog for focused, read-only detail. */
export function Modal({ open, onOpenChange, title, description, children, size = 'md' }: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade-in bg-black/60" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-[5vh] z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 animate-fade-up flex-col overflow-hidden rounded-xl border border-line bg-pane shadow-elevated focus:outline-none',
            size === 'md' ? 'max-w-3xl' : 'max-w-[1500px]',
          )}
        >
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-sm font-semibold text-fg">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-ui text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="-mr-1 rounded-md p-1 text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              aria-label="Close"
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
