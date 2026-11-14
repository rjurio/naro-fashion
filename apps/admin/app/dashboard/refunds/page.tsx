'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useSyncStatus } from '@/contexts/SyncContext';

/**
 * Admin → Refunds (R1b). Every refund — rental, online order, POS sale /
 * exchange, layaway — is a request: approved by someone other than the
 * requester, then paid out by someone other than the requester, with the
 * payout recorded (reference for non-cash; cash from the payer's own shift).
 * A request is "refund due" until paid; a failed payout is due again.
 * The API enforces every rule; this screen only offers the next step.
 */
const TABS = ['REQUESTED', 'APPROVED', 'PAID', 'FAILED', 'REJECTED'] as const;
const LABEL: Record<string, string> = {
  REQUESTED: 'Refund due · waiting for approval',
  APPROVED: 'Refund due · approved, not paid yet',
  PAYING: 'Refund due · payout in progress',
  PAID: 'Paid out',
  FAILED: 'Payout failed · refund due again',
  REJECTED: 'Rejected',
};
const tzs = (n: unknown) => `TZS ${Number(n ?? 0).toLocaleString('en-US')}`;
const inputCls = 'px-2 py-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm';

function target(r: any) {
  if (r.subject === 'RENTAL') return `Rental ${r.rentalOrder?.rentalNumber ?? ''}`;
  if (r.subject === 'LAYAWAY') return `Layaway ${r.layaway?.layawayNumber ?? ''}`;
  return `${r.subject === 'POS_SALE' ? 'POS sale' : 'Order'} ${r.order?.orderNumber ?? ''}${r.exchangeNumber ? ` (exchange ${r.exchangeNumber})` : ''}`;
}

export default function RefundsPage() {
  const toast = useToast();
  const { online } = useSyncStatus();
  const [tab, setTab] = useState<(typeof TABS)[number]>('REQUESTED');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { method: string; reference: string; note: string; verificationNote: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminApi.refundRequests({ status: tab === 'APPROVED' ? undefined : tab }).then((r) => (tab === 'APPROVED' ? r.filter((x: any) => ['APPROVED', 'PAYING'].includes(x.status)) : r)));
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load refunds');
    } finally {
      setLoading(false);
    }
  }, [tab, toast]);
  useEffect(() => { load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e: any) {
      const problems = e?.body?.problems ?? e?.data?.problems;
      toast.error(`${e?.message || 'Request failed'}${Array.isArray(problems) ? `: ${problems.join('; ')}` : ''}`);
    } finally {
      setBusy(null);
    }
  };
  const f = (id: string) => form[id] ?? { method: 'CASH', reference: '', note: '', verificationNote: '' };
  const setF = (id: string, patch: Partial<ReturnType<typeof f>>) => setForm({ ...form, [id]: { ...f(id), ...patch } });

  if (!online) return <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">Refunds need internet: approvals and payouts are recorded on the server.</div>;

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Refunds</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Each refund is approved by a second person and paid out by someone other than the person who asked for it. Until it is paid out, it is a refund <b>due</b>, not a refund made.
        </p>
      </div>
      <div className="flex gap-1 text-sm" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" data-testid={`refund-tab-${t}`} aria-selected={tab === t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md ${tab === t ? 'bg-brand-gold text-white' : 'border border-[hsl(var(--border))]'}`}>
            {t === 'REQUESTED' ? 'Waiting for approval' : t === 'APPROVED' ? 'To pay out' : t === 'PAID' ? 'Paid out' : t === 'FAILED' ? 'Failed payouts' : 'Rejected'}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-gold" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]" data-testid="refund-empty">Nothing here.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const v = f(r.id);
            return (
              <div key={r.id} data-testid={`refund-row-${r.id}`} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 space-y-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <div className="font-semibold">{target(r)} · {tzs(r.amount)}{Number(r.retainedAmount) > 0 ? ` (kept ${tzs(r.retainedAmount)})` : ''}</div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">{r.kind} · {r.reason}</div>
                  </div>
                  <span data-testid={`refund-state-${r.id}`} className="text-xs">{LABEL[r.status] ?? r.status}</span>
                </div>
                <div className="text-xs text-[hsl(var(--muted-foreground))]">
                  Requested {String(r.createdAt).slice(0, 16).replace('T', ' ')} by {r.requestedById}
                  {r.approvedById ? ` · approved by ${r.approvedById}` : ''}
                  {r.paidById ? ` · paid by ${r.paidById} on ${String(r.paidAt).slice(0, 16).replace('T', ' ')} via ${r.payoutMethod}${r.payoutReference ? ` (ref ${r.payoutReference})` : ''}` : ''}
                  {r.failureReason ? ` · failed: ${r.failureReason}` : ''}
                  {r.rejectionReason ? ` · rejected: ${r.rejectionReason}` : ''}
                </div>

                {r.status === 'REQUESTED' && (
                  <div className="flex flex-wrap gap-2">
                    <input value={v.note} onChange={(e) => setF(r.id, { note: e.target.value })} placeholder="Note (required to reject)" className={`${inputCls} flex-1`} />
                    <button data-testid={`refund-approve-${r.id}`} disabled={!!busy} onClick={() => run(`a-${r.id}`, () => adminApi.decideRefundRequest(r.id, 'approve', { note: v.note || undefined }), 'Approved: it can now be paid out')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-brand-gold text-white disabled:opacity-50">{busy === `a-${r.id}` && <Loader2 className="w-4 h-4 animate-spin" />}Approve</button>
                    <button disabled={!!busy || !v.note.trim()} onClick={() => run(`r-${r.id}`, () => adminApi.decideRefundRequest(r.id, 'reject', { reason: v.note }), 'Rejected')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-[hsl(var(--border))] disabled:opacity-50">{busy === `r-${r.id}` && <Loader2 className="w-4 h-4 animate-spin" />}Reject</button>
                  </div>
                )}

                {r.status === 'APPROVED' && (
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <select data-testid={`refund-method-${r.id}`} value={v.method} onChange={(e) => setF(r.id, { method: e.target.value })} className={inputCls}>
                      <option value="CASH">Cash (from your open shift)</option>
                      <option value="MOBILE_MONEY">Mobile money</option>
                      <option value="BANK_TRANSFER">Bank transfer</option>
                    </select>
                    <input data-testid={`refund-ref-${r.id}`} value={v.reference} onChange={(e) => setF(r.id, { reference: e.target.value })} placeholder={v.method === 'CASH' ? 'Receipt no. (optional)' : 'Payout reference *'} className={inputCls} />
                    <input value={v.verificationNote} onChange={(e) => setF(r.id, { verificationNote: e.target.value })} placeholder="If paying by another method than the customer used: how you verified the account" className={inputCls} />
                    <button data-testid={`refund-pay-${r.id}`} disabled={!!busy} onClick={() => run(`p-${r.id}`, () => adminApi.payRefundRequest(r.id, { method: v.method, reference: v.reference || undefined, verificationNote: v.verificationNote || undefined }), 'Payout recorded')}
                      className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-brand-gold text-white disabled:opacity-50">{busy === `p-${r.id}` && <Loader2 className="w-4 h-4 animate-spin" />}Record payout</button>
                  </div>
                )}

                {r.status === 'PAID' && (
                  <div className="flex gap-2">
                    <input value={v.note} onChange={(e) => setF(r.id, { note: e.target.value })} placeholder="Why the payout did not reach the customer" className={`${inputCls} flex-1`} />
                    <button disabled={!!busy || !v.note.trim()} onClick={() => run(`f-${r.id}`, () => adminApi.decideRefundRequest(r.id, 'fail', { reason: v.note }), 'Marked failed: the refund is due again')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-[hsl(var(--border))] disabled:opacity-50">{busy === `f-${r.id}` && <Loader2 className="w-4 h-4 animate-spin" />}Payout failed</button>
                  </div>
                )}

                {r.status === 'FAILED' && r.subject !== 'RENTAL' && (
                  <div className="flex gap-2">
                    <input value={v.note} onChange={(e) => setF(r.id, { note: e.target.value })} placeholder="Reason for the new payout attempt" className={`${inputCls} flex-1`} />
                    <button disabled={!!busy || !v.note.trim()} onClick={() => run(`t-${r.id}`, () => adminApi.retryRefundRequest(r.id, v.note), 'A new refund request was created (approval needed again)')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-[hsl(var(--border))] disabled:opacity-50">{busy === `t-${r.id}` && <Loader2 className="w-4 h-4 animate-spin" />}Request again</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
