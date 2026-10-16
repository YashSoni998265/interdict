import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when the label is icon-only or abbreviated. */
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  label: string;
  size?: 'xs' | 'sm';
  className?: string;
}

/** Single-choice segmented control (arrow keys move between options). */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  size = 'sm',
  className,
}: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      aria-label={label}
      className={cn('inline-flex items-center rounded-md border border-line bg-canvas p-0.5', className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          aria-label={option.ariaLabel}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[5px] font-medium text-fg-muted transition-colors hover:text-fg disabled:pointer-events-none disabled:opacity-40 data-[state=on]:bg-elevated data-[state=on]:text-fg data-[state=on]:shadow-[0_0_0_1px_rgb(var(--line))] [&_svg]:shrink-0',
            size === 'xs' ? 'h-6 px-2 text-2xs [&_svg]:size-3' : 'h-7 px-2.5 text-ui [&_svg]:size-3.5',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
