'use client';

import { forwardRef } from 'react';

interface TotpCodeInputProps {
  id?: string;
  value: string;
  onChange: (digits: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * Single numeric field for a 6-digit authenticator code. Paste-friendly:
 * anything that isn't a digit (spaces, dashes from "123 456") is stripped
 * and the value is capped at 6 digits. `autoComplete="one-time-code"` lets
 * mobile keyboards / password managers offer the code.
 */
const TotpCodeInput = forwardRef<HTMLInputElement, TotpCodeInputProps>(function TotpCodeInput(
  { id, value, onChange, autoFocus, disabled, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={12}
      autoFocus={autoFocus}
      disabled={disabled}
      value={value}
      placeholder="123456"
      aria-label={rest['aria-label'] ?? 'Authentication code'}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      className={
        className ??
        'w-full px-4 py-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-center text-2xl tracking-[0.5em] font-mono text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] placeholder:tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold transition-colors disabled:opacity-60'
      }
    />
  );
});

export default TotpCodeInput;
