'use client';

import { useState } from 'react';
import { Check, Copy, Download, ExternalLink, KeyRound, Loader2, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import Button from '@/components/ui/Button';
import TotpCodeInput from '@/components/auth/TotpCodeInput';
import adminApi from '@/lib/api';

type Mode = 'idle' | 'setup-password' | 'setup-verify' | 'disable' | 'regenerate' | 'show-codes';

interface TwoFactorSettingsProps {
  enabled: boolean;
  /** Unused recovery codes left (from /auth/me), if known. */
  recoveryCodesRemaining?: number;
  /** Used in the downloaded recovery-codes file. */
  accountEmail?: string;
  onEnabledChange: (enabled: boolean) => void;
  onMessage: (msg: string, type: 'success' | 'error') => void;
}

const inputCls =
  'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';

const codeCls =
  'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-center font-mono text-lg tracking-[0.3em] text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';

/** Group a base32 secret in blocks of 4 for easier manual entry. */
function groupSecret(s: string) {
  return s.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Settings → Security → Two-factor authentication (TOTP). Works for tenant
 * admins and platform admins.
 *  Enable:     current password → secret + otpauth link → 6-digit code → recovery codes (shown once)
 *  Disable:    current password + code (authenticator or recovery code)
 *  Regenerate: current password + code → new recovery codes (shown once)
 * Enabling/disabling signs out other sessions (the API bumps tokenVersion and
 * returns fresh tokens for this one — adminApi persists them).
 */
export default function TwoFactorSettings({
  enabled,
  recoveryCodesRemaining,
  accountEmail,
  onEnabledChange,
  onMessage,
}: TwoFactorSettingsProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ otpauthUrl: string; secret: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [remaining, setRemaining] = useState<number | undefined>(undefined);
  const [copied, setCopied] = useState<'secret' | 'codes' | null>(null);
  const [error, setError] = useState('');

  const remainingCount = remaining ?? recoveryCodesRemaining;

  const reset = () => {
    setMode('idle');
    setPassword('');
    setCode('');
    setSetup(null);
    setRecoveryCodes(null);
    setCopied(null);
    setError('');
  };

  const begin = (m: Mode) => {
    reset();
    setMode(m);
  };

  const showCodes = (codes: string[]) => {
    setPassword('');
    setCode('');
    setSetup(null);
    setError('');
    setRecoveryCodes(codes);
    setRemaining(codes.length);
    setMode('show-codes');
  };

  const startSetup = async () => {
    if (!password) {
      setError('Enter your current password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await adminApi.setup2FA(password);
      setSetup({ otpauthUrl: res.otpauthUrl, secret: res.secret });
      setPassword('');
      setCode('');
      setMode('setup-verify');
    } catch (err: any) {
      setError(err?.message || 'Could not start two-factor setup.');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async () => {
    if (code.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await adminApi.enable2FA(code);
      onEnabledChange(true);
      onMessage('Two-factor authentication is on. Other sessions have been signed out.', 'success');
      showCodes(res.recoveryCodes ?? []);
    } catch (err: any) {
      setError(err?.message || 'Invalid code. Try the next one shown in your app.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async () => {
    if (!password || !code.trim()) {
      setError('Enter your current password and a code.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await adminApi.disable2FA(password, code.trim());
      onEnabledChange(false);
      setRemaining(0);
      reset();
      onMessage('Two-factor authentication disabled. Other sessions have been signed out.', 'success');
    } catch (err: any) {
      setError(err?.message || 'Could not disable two-factor authentication.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const confirmRegenerate = async () => {
    if (!password || !code.trim()) {
      setError('Enter your current password and a code.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await adminApi.regenerateRecoveryCodes(password, code.trim());
      onMessage('New recovery codes generated. Your old codes no longer work.', 'success');
      showCodes(res.recoveryCodes ?? []);
    } catch (err: any) {
      setError(err?.message || 'Could not generate new recovery codes.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: 'secret' | 'codes') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      onMessage('Copy failed — select the text and copy it manually.', 'error');
    }
  };

  const downloadCodes = () => {
    if (!recoveryCodes) return;
    const body = [
      'Two-factor recovery codes',
      ...(accountEmail ? [`Account: ${accountEmail}`] : []),
      `Generated: ${new Date().toISOString()}`,
      '',
      'Each code can be used once to sign in or turn off two-factor if you lose your authenticator.',
      '',
      ...recoveryCodes,
      '',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'two-factor-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Password + code form shared by disable / regenerate (code = authenticator OR recovery code).
  const passwordAndCode = (idPrefix: string) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label htmlFor={`${idPrefix}-password`} className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">Current password</label>
        <input
          id={`${idPrefix}-password`}
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          maxLength={256}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-code`} className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">
          Authenticator code or recovery code
        </label>
        <input
          id={`${idPrefix}-code`}
          type="text"
          autoComplete="one-time-code"
          spellCheck={false}
          maxLength={20}
          value={code}
          placeholder="123456 or ABCDE-FGH23"
          onChange={(e) => setCode(e.target.value)}
          className={codeCls}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[hsl(var(--foreground))] flex items-center gap-2">
            Two-Factor Authentication
            {enabled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="w-3 h-3" /> On
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">
                Off
              </span>
            )}
          </p>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            {enabled
              ? 'A code from your authenticator app is required every time you sign in.'
              : 'Protect your account with a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).'}
          </p>
          {enabled && typeof remainingCount === 'number' && (
            <p className={`text-xs mt-1 ${remainingCount <= 2 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-[hsl(var(--muted-foreground))]'}`}>
              {remainingCount} recovery code{remainingCount === 1 ? '' : 's'} left
              {remainingCount <= 2 ? ' — generate new ones soon.' : '.'}
            </p>
          )}
        </div>
        {mode === 'idle' && (
          enabled ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => begin('regenerate')}>
                <RefreshCw className="w-4 h-4" />
                New recovery codes
              </Button>
              <Button variant="outline" onClick={() => begin('disable')}>
                <ShieldOff className="w-4 h-4" />
                Disable
              </Button>
            </div>
          ) : (
            <Button onClick={() => begin('setup-password')}>
              <ShieldCheck className="w-4 h-4" />
              Enable two-factor authentication
            </Button>
          )
        )}
      </div>

      {mode !== 'idle' && (
        <div className="rounded-lg border border-[hsl(var(--border))] p-4 space-y-4">
          {error && (
            <div role="alert" className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {mode === 'setup-password' && (
            <>
              <p className="text-sm text-[hsl(var(--foreground))]">Step 1 of 3 — confirm it&apos;s you.</p>
              <div>
                <label htmlFor="tfa-setup-password" className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">Current password</label>
                <input
                  id="tfa-setup-password"
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  maxLength={256}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) startSetup(); }}
                  className={inputCls}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={reset} disabled={busy}>Cancel</Button>
                <Button onClick={startSetup} disabled={busy || !password}>
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Continue
                </Button>
              </div>
            </>
          )}

          {mode === 'setup-verify' && setup && (
            <>
              <p className="text-sm text-[hsl(var(--foreground))]">
                Step 2 of 3 — add this account to your authenticator app, then enter the code it shows.
              </p>
              <ol className="list-decimal pl-5 space-y-3 text-xs text-[hsl(var(--muted-foreground))]">
                <li>
                  On your phone,{' '}
                  <a href={setup.otpauthUrl} className="inline-flex items-center gap-1 font-medium text-brand-gold hover:underline">
                    open in authenticator app <ExternalLink className="w-3 h-3" />
                  </a>
                  , or choose &ldquo;Enter a setup key&rdquo; in the app and type this key (time-based):
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 select-all break-all rounded-md bg-[hsl(var(--muted))] px-3 py-2 font-mono text-sm text-[hsl(var(--foreground))]">
                      {groupSecret(setup.secret)}
                    </code>
                    <Button variant="outline" size="sm" onClick={() => copy(setup.secret, 'secret')} aria-label="Copy setup key">
                      {copied === 'secret' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied === 'secret' ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                </li>
                <li>
                  Enter the 6-digit code:
                  <div className="mt-2 max-w-xs">
                    <TotpCodeInput value={code} onChange={setCode} autoFocus disabled={busy} className={codeCls} />
                  </div>
                </li>
              </ol>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Enabling signs out your other sessions.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={reset} disabled={busy}>Cancel</Button>
                <Button onClick={confirmEnable} disabled={busy || code.length !== 6}>
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Verify and enable
                </Button>
              </div>
            </>
          )}

          {mode === 'show-codes' && recoveryCodes && (
            <>
              <div className="flex items-start gap-2">
                <KeyRound className="w-5 h-5 text-brand-gold shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-[hsl(var(--foreground))]">Save your recovery codes</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                    If you lose your authenticator, each code lets you sign in (or turn off two-factor) once.
                    They are shown <strong>only now</strong> — store them somewhere safe, like a password manager.
                  </p>
                </div>
              </div>
              <ul className="grid grid-cols-2 gap-2 rounded-md bg-[hsl(var(--muted))] p-3 font-mono text-sm text-[hsl(var(--foreground))] select-all">
                {recoveryCodes.map((c) => (
                  <li key={c} className="text-center">{c}</li>
                ))}
              </ul>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => copy(recoveryCodes.join('\n'), 'codes')}>
                  {copied === 'codes' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied === 'codes' ? 'Copied' : 'Copy'}
                </Button>
                <Button variant="outline" size="sm" onClick={downloadCodes}>
                  <Download className="w-4 h-4" />
                  Download
                </Button>
                <Button size="sm" onClick={reset}>
                  I&apos;ve saved them
                </Button>
              </div>
            </>
          )}

          {mode === 'regenerate' && (
            <>
              <p className="text-sm text-[hsl(var(--foreground))]">
                Generate a new set of 10 recovery codes. Your current codes stop working immediately.
              </p>
              {passwordAndCode('tfa-regen')}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={reset} disabled={busy}>Cancel</Button>
                <Button onClick={confirmRegenerate} disabled={busy || !password || !code.trim()}>
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Generate new codes
                </Button>
              </div>
            </>
          )}

          {mode === 'disable' && (
            <>
              <p className="text-sm text-[hsl(var(--foreground))]">
                Turning off two-factor makes your account easier to break into. Confirm with your password and a code
                (a recovery code works if you&apos;ve lost your device).
              </p>
              {passwordAndCode('tfa-disable')}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={reset} disabled={busy}>Cancel</Button>
                <Button variant="danger" onClick={confirmDisable} disabled={busy || !password || !code.trim()}>
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Disable two-factor
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
