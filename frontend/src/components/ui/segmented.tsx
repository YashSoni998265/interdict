import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import './segmented.css';

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
      className={cn('segmented', className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          aria-label={option.ariaLabel}
          className={cn(
            'segmented-2',
            size === 'xs' ? 'segmented--xs' : 'segmented--not-xs',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
