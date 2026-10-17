import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import './sheet.css';

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
        <DialogPrimitive.Overlay className="sheet__overlay" />
        <DialogPrimitive.Content
          className={cn(
            'sheet__content',
            width === 'md' ? 'sheet__content--md' : 'sheet__content--not-md',
          )}
        >
          <header className="sheet__header">
            <div className="sheet__block">
              <DialogPrimitive.Title className="sheet__title">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sheet__description">
                {description}
              </DialogPrimitive.Description>
            </div>
            {headerExtra}
            <DialogPrimitive.Close
              className="sheet__close"
              aria-label="Close"
            >
              <X className="sheet__icon" aria-hidden />
            </DialogPrimitive.Close>
          </header>
          <div className="sheet__block-2">{children}</div>
          {footer ? <footer className="sheet__footer">{footer}</footer> : null}
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
        <DialogPrimitive.Overlay className="modal__overlay" />
        <DialogPrimitive.Content
          className={cn(
            'modal__content',
            size === 'md' ? 'modal__content--md' : 'modal__content--not-md',
          )}
        >
          <header className="modal__header">
            <div className="modal__block">
              <DialogPrimitive.Title className="modal__title">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="modal__description">
                {description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="modal__close"
              aria-label="Close"
            >
              <X className="modal__icon" aria-hidden />
            </DialogPrimitive.Close>
          </header>
          <div className="modal__block-2">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
