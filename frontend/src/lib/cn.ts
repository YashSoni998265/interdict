import { clsx, type ClassValue } from 'clsx';

/**
 * Join class names. Conditional and caller-supplied classes come later in the list, and their
 * rules come later in the stylesheets, so they override the base classes they are combined with.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
