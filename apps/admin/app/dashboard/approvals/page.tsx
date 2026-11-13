'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useSyncStatus } from '@/contexts/SyncContext';

/**
 * Round 25F E — second-person approvals:
 *  - stock write-offs / decreases above the shop's threshold (inventory:approve);
 *  - payment reversals (a different holder of payments:reverse);
 *  - review of card / mobile-money payments confirmed by hand at the till (reports:view).
 * Each section only loads if the signed-in person may see it (403 → hidden).
 */
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-TZ');
const when = (d: unknown) => (d ? new Date(String(d)).toLocaleString() : '—');

export default function ApprovalsPage() {
  const toast = useToast();
  const { online } = useSyncStatus();
  const [stock, setStock] = useState<any[] | null>(null);
  const [reversals, setReversals] = useState<any[] | null>(null);
  const [manual, setManual] = useState<any[] | null>(null);
  const [thresholds, setThresholds] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const quiet = <T,>(p: Promise<T>) => p.catch(() => null);
    const [s, r, m, t] = await Promise.all([
      quiet(adminApi.listInventoryAdjustmentRequests('REQUESTED')),
      quiet(adminApi.listPaymentReversalRequests('REQUESTED')),
      quiet(adminApi.listManualConfirmations('UNREVIEWED')),
      quiet(adminApi.getInventoryApprovalThresholds()),
    ]);
    setStock(s); setReversals(r); setManual(m); setThresholds(t);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Request failed');
    } finally {
      setBusy(null);
    }
  };
  const btn = 'inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-[hsl(var(--border))] disabled:opacity-50';
  const Spin = ({ k }: { k: string }) => (busy === k ? <Loader2 className="w-3 h-3 animate-spin" /> : null);

  if (!online) return <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">Approvals need internet: they are recorded on the server.</div>;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Stock &amp; payment approvals</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Each item here was asked for by one person and must be decided by <b>someone else</b>. Nobody can approve their own request, whatever their role.
        </p>
        {loading && <p className="text-xs mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>}
      </div>

      {stock && (
        <section data-testid="stock-approvals">
          <h2 className="font-semibold mb-1">Stock write-offs and decreases</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">
            {thresholds && (thresholds.maxUnits != null || thresholds.maxPct != null)
              ? `One-step limit set by the owner: ${thresholds.maxUnits != null ? `${thresholds.maxUnits} unit(s)` : ''}${thresholds.maxUnits != null && thresholds.maxPct != null ? ' and ' : ''}${thresholds.maxPct != null ? `${thresholds.maxPct}% of stock` : ''}. Larger decreases come here.`
              : 'No owner threshold is set yet: every write-off and decrease comes here.'}
          </p>
          {stock.length === 0 ? <p className="text-sm">Nothing waiting.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th>Asked</th><th>Type</th><th>Qty</th><th>Stock then</th><th>Reason</th><th>By</th><th /></tr></thead>
              <tbody>
                {stock.map((r) => (
                  <tr key={r.id} className="border-t border-[hsl(var(--border))]">
                    <td>{when(r.createdAt)}</td><td>{r.type === 'DAMAGE' ? 'Write-off' : 'Decrease'}</td><td>−{r.quantity}</td>
                    <td>{r.stockAtRequest} → {r.stockAtRequest - r.quantity}</td><td>{r.note}</td><td className="font-mono text-xs">{String(r.requestedById).slice(-6)}</td>
                    <td className="space-x-1 whitespace-nowrap">
                      <button className={btn} disabled={!!busy} onClick={() => run(`sa${r.id}`, () => adminApi.approveInventoryAdjustment(r.id), 'Applied')}><Spin k={`sa${r.id}`} />Approve</button>
                      <button className={btn} disabled={!!busy} onClick={() => run(`sr${r.id}`, () => adminApi.rejectInventoryAdjustment(r.id), 'Rejected')}><Spin k={`sr${r.id}`} />Reject</button>
                      <button className={btn} disabled={!!busy} onClick={() => run(`sw${r.id}`, () => adminApi.withdrawInventoryAdjustment(r.id), 'Withdrawn')}><Spin k={`sw${r.id}`} />Withdraw (mine)</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {reversals && (
        <section data-testid="reversal-approvals">
          <h2 className="font-semibold mb-1">Payment reversals</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">A reversal runs only when a second person approves it. Requests expire after 48 hours.</p>
          {reversals.length === 0 ? <p className="text-sm">Nothing waiting.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th>Asked</th><th>Payment</th><th>Reason</th><th>By</th><th>Expires</th><th /></tr></thead>
              <tbody>
                {reversals.map((r) => (
                  <tr key={r.id} className="border-t border-[hsl(var(--border))]">
                    <td>{when(r.createdAt)}</td><td className="font-mono text-xs">{r.paymentId}</td><td>{r.reason}</td>
                    <td className="font-mono text-xs">{String(r.requestedById).slice(-6)}</td><td>{when(r.expiresAt)}</td>
                    <td className="space-x-1 whitespace-nowrap">
                      <button className={btn} disabled={!!busy} onClick={() => run(`ra${r.id}`, () => adminApi.approvePaymentReversal(r.id), 'Reversed')}><Spin k={`ra${r.id}`} />Approve &amp; reverse</button>
                      <button className={btn} disabled={!!busy} onClick={() => run(`rr${r.id}`, () => adminApi.rejectPaymentReversal(r.id), 'Rejected')}><Spin k={`rr${r.id}`} />Reject</button>
                      <button className={btn} disabled={!!busy} onClick={() => run(`rw${r.id}`, () => adminApi.withdrawPaymentReversal(r.id), 'Withdrawn')}><Spin k={`rw${r.id}`} />Withdraw (mine)</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {manual && (
        <section data-testid="manual-reviews">
          <h2 className="font-semibold mb-1">Card / mobile-money payments confirmed by hand — to review</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">Check each against the terminal settlement report or the mobile-money statement. A review changes no money; to undo a payment, request a reversal.</p>
          {manual.length === 0 ? <p className="text-sm">Nothing to review.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th>Confirmed</th><th>Method</th><th>Amount</th><th>Reference</th><th>By</th><th>Note</th><th /></tr></thead>
              <tbody>
                {manual.map((p) => (
                  <tr key={p.paymentId} className="border-t border-[hsl(var(--border))]">
                    <td>{when(p.confirmedAt ?? p.createdAt)}</td><td>{p.method}</td><td>{fmt(p.amount)}</td><td className="font-mono text-xs">{p.reference}</td>
                    <td className="font-mono text-xs">{String(p.confirmedById ?? '').slice(-6)}</td>
                    <td><input className="px-2 py-1 text-xs border border-[hsl(var(--border))] rounded bg-transparent" placeholder="note (needed to query)" value={notes[p.paymentId] ?? ''} onChange={(e) => setNotes({ ...notes, [p.paymentId]: e.target.value })} /></td>
                    <td className="space-x-1 whitespace-nowrap">
                      <button className={btn} disabled={!!busy} onClick={() => run(`mo${p.paymentId}`, () => adminApi.reviewManualConfirmation(p.paymentId, 'OK', notes[p.paymentId]), 'Marked as checked')}><Spin k={`mo${p.paymentId}`} />Checked</button>
                      <button className={btn} disabled={!!busy} onClick={() => run(`mq${p.paymentId}`, () => adminApi.reviewManualConfirmation(p.paymentId, 'QUERIED', notes[p.paymentId]), 'Queried')}><Spin k={`mq${p.paymentId}`} />Query</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {!loading && !stock && !reversals && !manual && (
        <p className="text-sm">You don&apos;t hold any of the approval permissions (inventory:approve, payments:reverse, reports:view).</p>
      )}
    </div>
  );
}
