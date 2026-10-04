'use client';

import { useState } from 'react';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import Button from '@/components/ui/Button';
import TotpCodeInput from '@/components/auth/TotpCodeInput';

interface TwoFactorLoginStepProps {
  /** Called with a 6-digit TOTP code or a recovery code (XXXXX-XXXXX). Throw to show an error. */
  onVerify: (code: string) => Promise<void>;
  onBack: () => void;
  /** 'brand' = tenant admin login (gold), 'platform' = dark platform-login page. */
  variant?: 'brand' | 'platform';
}

const RECOVERY_RE = /^[A-Za-z2-7]{5}-?[A-Za-z2-7]{5}$/;

/**
 * Second sign-in step for admins / platform admins with TOTP enabled.
 * Authenticator code by default; "Use a recovery code" switches to a
 * one-time recovery code (each works once).
 */
export default function TwoFactorLoginStep({ onVerify, onBack, variant = 'brand' }: TwoFactorLoginStepProps) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const platform = variant === 'platform';
  const value = useRecovery ? recovery.trim() : code;
  const valid = useRecovery ? RECOVERY_RE.test(value) : code.length === 6;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || loading) {
      setError(useRecovery ? 'Enter a recovery code like ABCDE-FGH23.' : 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onVerify(value);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid authentication code');
      setCode('');
      setRecovery('');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setUseRecovery((v) => !v);
    setError('');
    setCode('');
    setRecovery('');
  };

  const labelCls = platform
    ? 'flex items-center gap-2 text-sm font-medium text-gray-300 mb-1'
    : 'flex items-center gap-2 text-sm font-medium text-[hsl(var(--foreground))] mb-2';
  const hintCls = platform ? 'mt-2 text-xs text-gray-400' : 'mt-2 text-xs text-[hsl(var(--muted-foreground))]';
  const linkCls = platform
    ? 'text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50'
    : 'text-sm text-brand-gold hover:text-brand-gold-dark disabled:opacity-50';
  const codeInputCls = platform
    ? 'w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded text-white text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60'
    : undefined;
  const recoveryInputCls = platform
    ? 'w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded text-white text-center text-lg tracking-widest font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60'
    : 'w-full px-4 py-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-center text-lg tracking-widest font-mono uppercase text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold transition-colors disabled:opacity-60';
  const submitCls =
    'w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded font-medium transition-colors';
  const errorCls = platform
    ? 'bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded text-sm'
    : 'p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm';

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && (
        <div role="alert" className={errorCls}>
          {error}
        </div>
      )}

      {useRecovery ? (
        <div>
          <label htmlFor="tfa-recovery" className={labelCls}>
            <KeyRound className={`w-4 h-4 ${platform ? 'text-blue-400' : 'text-brand-gold'}`} />
            Recovery code
          </label>
          <input
            id="tfa-recovery"
            type="text"
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            value={recovery}
            disabled={loading}
            placeholder="ABCDE-FGH23"
            onChange={(e) => setRecovery(e.target.value)}
            className={recoveryInputCls}
          />
          <p className={hintCls}>Each recovery code works only once.</p>
        </div>
      ) : (
        <div>
          <label htmlFor="tfa-code" className={labelCls}>
            <ShieldCheck className={`w-4 h-4 ${platform ? 'text-blue-400' : 'text-brand-gold'}`} />
            Authentication code
          </label>
          <TotpCodeInput id="tfa-code" value={code} onChange={setCode} autoFocus disabled={loading} className={codeInputCls} />
          <p className={hintCls}>This step expires after 5 minutes.</p>
        </div>
      )}

      {platform ? (
        <button type="submit" disabled={loading || !valid} className={submitCls}>
          {loading ? 'Verifying...' : 'Verify and sign in'}
        </button>
      ) : (
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading || !valid}>
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Verifying...
            </span>
          ) : (
            'Verify and sign in'
          )}
        </Button>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} disabled={loading} className={`flex items-center gap-1 ${linkCls}`}>
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button type="button" onClick={toggleMode} disabled={loading} className={linkCls}>
          {useRecovery ? 'Use authenticator code' : 'Use a recovery code'}
        </button>
      </div>
    </form>
  );
}
