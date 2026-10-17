import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import './form.css';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  return (
    <div className={cn('field', className)}>
      <label htmlFor={htmlFor} className="field__label">
        {label}
      </label>
      {children}
      {error ? (
        <p className="field__text" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="field__text-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const control =
  'form-control';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cn(control, 'select', className)} {...props} />;
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, className)} {...props} />;
});
