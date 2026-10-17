import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import './button.css';

const buttonVariants = cva(
  'button',
  {
    variants: {
      variant: {
        primary: 'button--primary',
        secondary: 'button--secondary',
        outline: 'button--outline',
        ghost: 'button--ghost',
        link: 'button--link',
      },
      size: {
        xs: 'button--xs',
        sm: 'button--sm',
        md: 'button--md',
        lg: 'button--lg',
        icon: 'button--icon',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref,
) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  );
});
