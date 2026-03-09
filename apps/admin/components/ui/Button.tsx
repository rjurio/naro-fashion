'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed',
          // Variants
          variant === 'primary' &&
            'bg-brand-gold text-white hover:bg-brand-gold-dark focus:ring-brand-gold/50 shadow-sm hover:shadow-md',
          variant === 'secondary' &&
            'bg-brand-gold text-brand-black hover:bg-brand-gold-dark focus:ring-brand-gold/50 shadow-sm hover:shadow-md',
          variant === 'outline' &&
            'border-2 border-brand-gold text-brand-gold hover:bg-brand-gold hover:text-white focus:ring-brand-gold/50',
          variant === 'ghost' &&
            'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] focus:ring-[hsl(var(--ring))]',
          variant === 'danger' &&
            'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/50 shadow-sm',
          // Sizes
          size === 'sm' && 'px-3 py-1.5 text-sm gap-1.5',
          size === 'md' && 'px-4 py-2.5 text-sm gap-2',
          size === 'lg' && 'px-6 py-3 text-base gap-2',
          size === 'icon' && 'w-10 h-10 p-0',
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
