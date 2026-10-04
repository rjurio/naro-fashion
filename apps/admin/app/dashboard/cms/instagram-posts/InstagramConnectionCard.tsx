'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Link2, Loader2, RefreshCw, ShieldAlert, AlertTriangle } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { adminApi, type InstagramConnectResult, type InstagramTokenStatus } from '@/lib/api';

const EXPLORER_URL = 'https://developers.facebook.com/tools/explorer/';
const REQUIRED_PERMISSIONS = ['instagram_basic', 'pages_show_list', 'pages_read_engagement', 'business_management'];
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

type Health = 'green' | 'amber' | 'red';

function healthOf(s: InstagramTokenStatus | null): { health: Health; label: string } {
  if (!s || !s.connected) return { health: 'red', label: 'Not connected' };
  if (!s.valid) return { health: 'red', label: 'Token invalid — re-connect' };
  if (s.expiresAt && s.expiresAt !== 'never') {
    const left = Date.parse(s.expiresAt) - Date.now();
    if (Number.isFinite(left) && left < FOURTEEN_DAYS_MS) return { health: 'amber', label: 'Expiring soon — re-connect' };
    return { health: 'amber', label: 'Connected (temporary token — re-connect for a permanent one)' };
  }
  if (s.lastError) return { health: 'amber', label: 'Connected — last sync had an error' };
  return { health: 'green', label: 'Connected' };
}

const dotClass: Record<Health, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};
const pillClass: Record<Health, string> = {
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  if (iso === 'never') return 'Never';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso;
}

export default function InstagramConnectionCard({ onConnected }: { onConnected?: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<InstagramTokenStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [result, setResult] = useState<InstagramConnectResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async (force = false) => {
    try {
      if (force) setRefreshing(true);
      const s = await adminApi.getInstagramTokenStatus(force);
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (!value) {
      setError('Paste the User access token first.');
      return;
    }
    setConnecting(true);
    setError(null);
    setResult(null);
    try {
      const r = await adminApi.connectInstagram(value);
      setResult(r);
      setToken('');
      setShowForm(false);
      toast.success(`Instagram connected via "${r.pageName}" — ${r.synced} post(s) synced`);
      await loadStatus(true);
      onConnected?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Instagram');
    } finally {
      setConnecting(false);
    }
  };

  const { health, label } = healthOf(status);
  const needsConnect = !status || !status.connected || !status.valid || (status.expiresAt !== null && status.expiresAt !== 'never');

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex flex-col">
      <dt className="text-xs text-[hsl(var(--muted-foreground))]">{k}</dt>
      <dd className="text-sm font-medium text-[hsl(var(--card-foreground))] break-words">{v}</dd>
    </div>
  );

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-brand-gold/10">
            <Link2 className="w-5 h-5 text-brand-gold" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[hsl(var(--card-foreground))]">Instagram Connection</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              The feed uses a Facebook Page token that does not expire.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loadingStatus ? (
            <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />
          ) : (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${pillClass[health]}`}>
              <span className={`w-2 h-2 rounded-full ${dotClass[health]}`} />
              {label}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => loadStatus(true)}
            disabled={refreshing || loadingStatus}
            title="Re-check the token with Facebook"
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Check
          </Button>
          <Button
            size="sm"
            variant={needsConnect ? 'primary' : 'outline'}
            onClick={() => { setShowForm((v) => !v); setError(null); }}
            disabled={connecting}
          >
            {status?.connected ? 'Re-connect Instagram' : 'Connect Instagram'}
          </Button>
        </div>
      </div>

      {!loadingStatus && status && (
        <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {row('Token type', status.tokenType === 'PAGE' ? 'Page (permanent)' : status.tokenType ?? '—')}
          {row('Facebook Page', status.pageName || '—')}
          {row('Instagram', status.igUsername ? `@${status.igUsername}` : '—')}
          {row('Expires', fmt(status.expiresAt))}
          {row('Last checked', fmt(status.checkedAt))}
          {row('Last sync', fmt(status.lastSyncAt))}
        </dl>
      )}

      {!loadingStatus && status?.lastError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-900/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="break-words">Last error: {status.lastError}</span>
        </div>
      )}

      {result && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-900/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Connected through Page <strong>{result.pageName}</strong>
            {result.igUsername ? <> to <strong>@{result.igUsername}</strong></> : null}. Token expires:{' '}
            <strong>{fmt(result.expiresAt)}</strong>. Synced {result.synced} post(s)
            {result.syncErrors ? `, ${result.syncErrors} error(s)` : ''}.
          </span>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleConnect} className="space-y-3 border-t border-[hsl(var(--border))] pt-4">
          <ol className="list-decimal pl-5 space-y-1 text-xs text-[hsl(var(--muted-foreground))]">
            <li>
              Open{' '}
              <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer" className="text-brand-gold inline-flex items-center gap-0.5 hover:underline">
                Graph API Explorer <ExternalLink className="w-3 h-3" />
              </a>{' '}
              and log in with the Facebook account that is an <strong>admin of the shop&apos;s Facebook Page</strong>.
            </li>
            <li>In &quot;Meta App&quot; choose <strong>Narofashion</strong>. In &quot;User or Page&quot; choose <strong>User Token</strong>.</li>
            <li>
              Under Permissions add: {REQUIRED_PERMISSIONS.map((p, i) => (
                <span key={p}><code className="rounded bg-[hsl(var(--muted))] px-1">{p}</code>{i < REQUIRED_PERMISSIONS.length - 1 ? ', ' : ''}</span>
              ))}.
            </li>
            <li>Click <strong>Generate Access Token</strong>, approve the Facebook pop-up (select the shop&apos;s Page and Instagram account), then click the copy icon next to the token.</li>
            <li>Paste it below and press <strong>Connect</strong>. We exchange it on the server for a permanent Page token — the pasted token is not stored.</li>
          </ol>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={3}
            placeholder="Paste the User access token (starts with EAA…)"
            autoComplete="off"
            spellCheck={false}
            disabled={connecting}
            className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-xs font-mono text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50 disabled:opacity-50"
          />
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300/60 bg-red-50 dark:bg-red-900/10 p-3 text-xs text-red-700 dark:text-red-300">
              <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)} disabled={connecting}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="gap-1.5" disabled={connecting || !token.trim()}>
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
