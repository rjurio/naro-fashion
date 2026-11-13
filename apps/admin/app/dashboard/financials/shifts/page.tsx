'use client';

/**
 * Admin → Financials → Shift reconciliation (R4, round 25D F). Read-only.
 *
 * Each shift opens into GET /pos/sessions/:id/reconciliation (reports:view):
 *  - the drawer: opening + cash in − cash out = expected, against the cash
 *    counted at close (and the expected figure saved at close, if it differs);
 *  - money received by category (POS sales, rental fee, deposit, late fee,
 *    layaway, …) split cash / non-cash, and refunds paid out by subject;
 *  - income vs customer money held: deposits and layaway instalments are
 *    liabilities, never income;
 *  - money that has no shift tag (shown, never guessed into the drawer);
 *  - the rental ledger for the rentals the shift touched, and the shop's open
 *    liabilities now.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';
import { adminApi } from '@/lib/api';

const tzs = (n: unknown) => (n == null ? '—' : `TZS ${Number(n).toLocaleString('en-US')}`);
const when = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');

const RECEIPT_LABELS: Record<string, string> = {
  POS_SALE: 'POS sales',
  EXCHANGE_TOPUP: 'Exchange top-ups',
  RENTAL_FEE: 'Rental fees',
  DEPOSIT: 'Refundable deposits',
  LATE_FEE: 'Late fees',
  LAYAWAY: 'Layaway instalments',
  RENTAL_UNALLOCATED: 'Rental money (not allocated)',
  OTHER: 'Other',
};
const PAYOUT_LABELS: Record<string, string> = {
  RENTAL: 'Rental refunds',
  POS_SALE: 'POS sale refunds',
  ORDER: 'Online order refunds',
  LAYAWAY: 'Layaway refunds',
  OTHER: 'Other payouts',
};
const NATURE: Record<string, { label: string; cls: string }> = {
  INCOME: { label: 'Income', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' },
  LIABILITY: { label: 'Held for customer', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  UNCLASSIFIED: { label: 'To classify', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200' },
};

function Row({ label, value, strong, testId }: { label: string; value: React.ReactNode; strong?: boolean; testId?: string }) {
  return (
    <div className={`flex justify-between gap-3 py-0.5 ${strong ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span data-testid={testId}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] p-3">
      <div className="font-medium mb-2">{title}</div>
      {children}
    </div>
  );
}

function Reconciliation({ r }: { r: any }) {
  const d = r.drawer;
  const diffCls = d.difference == null ? '' : d.difference === 0 ? 'text-emerald-600' : 'text-red-600';
  const receipts = Object.entries(r.receipts ?? {}).filter(([, b]: any) => b.count > 0);
  const payouts = Object.entries(r.payouts ?? {}).filter(([, b]: any) => b.count > 0);
  const cashNoShift = r.notAttributed?.cashWithoutShift?.rows ?? [];
  const nonCashMine = r.notAttributed?.nonCashByThisCashier?.rows ?? [];
  const L = r.liabilitiesNow ?? {};
  const allChecks = r.checks?.everyTaggedRowAccounted && r.checks?.receiptsAddUp && r.checks?.payoutsAddUp;
  return (
    <div className="border-t border-[hsl(var(--border))] p-3 text-sm grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="shift-reconciliation">
      <Section title="Drawer cash">
        <Row label="Opening float" value={tzs(d.openingCash)} />
        <Row label="+ Cash received" value={tzs(d.cashIn)} testId="recon-cash-in" />
        <Row label="− Cash paid out" value={tzs(d.cashOut)} testId="recon-cash-out" />
        <Row label="= Expected in drawer" value={tzs(d.expectedCash)} strong testId="recon-expected" />
        <Row label="Counted at close" value={tzs(d.countedCash)} testId="recon-counted" />
        <Row label="Difference (counted − expected)" value={<span className={diffCls}>{tzs(d.difference)}</span>} strong testId="recon-difference" />
        {r.checks?.expectedMatchesClose === false && (
          <p className="mt-2 text-xs text-red-600" data-testid="recon-close-mismatch">
            The expected cash saved when the shift closed was {tzs(d.expectedCashAtClose)}. Money was recorded against this shift after it closed (for example an offline sale synced later).
          </p>
        )}
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Only cash moves the drawer. Card, mobile money and bank money is listed below but never counted here.</p>
      </Section>

      <Section title="Income and customer money (this shift)">
        <Row label="Income received" value={tzs(r.books.incomeReceived)} testId="recon-income" />
        <Row label="− Income refunded" value={tzs(r.books.incomeRefunded)} />
        <Row label="= Net income" value={tzs(r.books.netIncome)} strong testId="recon-net-income" />
        <div className="my-2 border-t border-[hsl(var(--border))]" />
        <Row label="Deposits received (held, not income)" value={tzs(r.books.depositsReceived)} testId="recon-deposits-received" />
        <Row label="Deposits returned" value={tzs(r.books.depositsReturned)} testId="recon-deposits-returned" />
        <Row label="Layaway instalments received (held)" value={tzs(r.books.layawayPrepaymentsReceived)} />
        <Row label="Layaway money returned" value={tzs(r.books.layawayPrepaymentsReturned)} />
        {Number(r.books.depositsRetainedAsIncome?.amount) > 0 && (
          <Row label="Deposits kept for damage (became income, no cash)" value={tzs(r.books.depositsRetainedAsIncome.amount)} />
        )}
        {Number(r.books.unclassified) > 0 && <Row label="Not yet classified" value={tzs(r.books.unclassified)} />}
      </Section>

      <Section title="Money received, by category">
        {receipts.length === 0 ? <p className="text-xs">Nothing received in this shift.</p> : (
          <table className="w-full text-xs" data-testid="recon-receipts">
            <thead><tr className="text-left text-[hsl(var(--muted-foreground))]"><th>Category</th><th className="text-right pl-3 whitespace-nowrap">Cash</th><th className="text-right pl-3 whitespace-nowrap">Non-cash</th><th className="text-right pl-3 whitespace-nowrap">Total</th></tr></thead>
            <tbody>
              {receipts.map(([k, b]: any) => (
                <tr key={k} data-testid={`recon-receipt-${k}`}>
                  <td className="py-0.5">
                    {RECEIPT_LABELS[k] ?? k} <span className="text-[hsl(var(--muted-foreground))]">({b.count})</span>{' '}
                    <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${NATURE[b.nature]?.cls ?? ''}`}>{NATURE[b.nature]?.label ?? b.nature}</span>
                  </td>
                  <td className="text-right pl-3 whitespace-nowrap">{tzs(b.cash)}</td>
                  <td className="text-right pl-3 whitespace-nowrap">{tzs(b.nonCash)}</td>
                  <td className="text-right pl-3 whitespace-nowrap font-medium">{tzs(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Refunds paid out, by subject">
        {payouts.length === 0 ? <p className="text-xs">No refunds paid out in this shift.</p> : (
          <table className="w-full text-xs" data-testid="recon-payouts">
            <thead><tr className="text-left text-[hsl(var(--muted-foreground))]"><th>Subject</th><th className="text-right pl-3 whitespace-nowrap">Cash</th><th className="text-right pl-3 whitespace-nowrap">Non-cash</th><th className="text-right pl-3 whitespace-nowrap">Total</th></tr></thead>
            <tbody>
              {payouts.map(([k, b]: any) => (
                <tr key={k} data-testid={`recon-payout-${k}`}>
                  <td className="py-0.5">{PAYOUT_LABELS[k] ?? k} <span className="text-[hsl(var(--muted-foreground))]">({b.count})</span></td>
                  <td className="text-right pl-3 whitespace-nowrap">{tzs(b.cash)}</td>
                  <td className="text-right pl-3 whitespace-nowrap">{tzs(b.nonCash)}</td>
                  <td className="text-right pl-3 whitespace-nowrap font-medium">{tzs(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-2 text-xs">
          <div className="font-medium">By method (in / out)</div>
          <ul data-testid="recon-methods">
            {Object.entries(r.byMethod ?? {}).map(([m, v]: any) => <li key={m}>{m}: {tzs(v.in)} in · {tzs(v.out)} out</li>)}
            {Object.keys(r.byMethod ?? {}).length === 0 && <li>No money moved.</li>}
          </ul>
        </div>
      </Section>

      {(cashNoShift.length > 0 || nonCashMine.length > 0) && (
        <div className="lg:col-span-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-2" data-testid="recon-not-attributed">
          <div className="flex gap-2 font-medium"><AlertTriangle className="w-4 h-4 text-amber-600" /> Money with no shift tag (not in the expected cash)</div>
          {cashNoShift.length > 0 && (
            <div>
              <div>Cash recorded during this shift without a drawer (net {tzs(r.notAttributed.cashWithoutShift.net)}). Check whether it went through this drawer:</div>
              <ul className="list-disc ml-5">{cashNoShift.map((x: any) => <li key={x.id}>{x.status === 'COMPLETED' ? 'Received' : 'Paid out'} {tzs(x.amount)} · {x.category} · {when(x.createdAt)}</li>)}</ul>
            </div>
          )}
          {nonCashMine.length > 0 && (
            <div>
              <div>Non-cash money this cashier recorded without a shift tag (doesn&apos;t affect the drawer):</div>
              <ul className="list-disc ml-5">{nonCashMine.map((x: any) => <li key={x.id}>{x.method} {tzs(x.amount)} · {x.category} · {when(x.createdAt)}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {(r.rentals ?? []).length > 0 && (
        <Section title="Rentals in this shift (against the rental ledger now)">
          <table className="w-full text-xs" data-testid="recon-rentals">
            <thead><tr className="text-left text-[hsl(var(--muted-foreground))]"><th>Booking</th><th className="text-right pl-3 whitespace-nowrap">Fee in</th><th className="text-right pl-3 whitespace-nowrap">Deposit in</th><th className="text-right pl-3 whitespace-nowrap">Deposit out</th><th className="text-right pl-3 whitespace-nowrap">Deposit held now</th></tr></thead>
            <tbody>
              {r.rentals.map((x: any) => (
                <tr key={x.rentalOrderId}>
                  <td className="py-0.5">{x.rentalNumber ?? x.rentalOrderId} <span className="text-[hsl(var(--muted-foreground))]">{x.status}</span></td>
                  <td className="text-right pl-3 whitespace-nowrap">{tzs(x.thisShift.feeReceived)}</td>
                  <td className="text-right pl-3 whitespace-nowrap">{tzs(x.thisShift.depositReceived)}</td>
                  <td className="text-right pl-3 whitespace-nowrap">{tzs(x.thisShift.depositReturned)}</td>
                  <td className="text-right pl-3 whitespace-nowrap">{tzs(x.ledgerNow.depositHeld)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title={`Shop liabilities now (${when(L.asOf)})`}>
        <Row label={`Deposits held (${L.depositsHeld?.rentals ?? 0} bookings)`} value={tzs(L.depositsHeld?.amount)} testId="recon-deposits-held" />
        <Row label={`Layaway money held (${L.layawayPrepaymentsHeld?.layaways ?? 0})`} value={tzs(L.layawayPrepaymentsHeld?.amount)} />
        <Row label={`Refunds approved, not paid (${L.refundRequestsApprovedUnpaid?.count ?? 0})`} value={tzs(L.refundRequestsApprovedUnpaid?.amount)} testId="recon-approved-unpaid" />
        <Row label={`Refunds awaiting approval (${L.refundRequestsAwaitingApproval?.count ?? 0})`} value={tzs(L.refundRequestsAwaitingApproval?.amount)} />
        <Row label={`Cancelled bookings with money due back (${L.cancelledRentalsRefundDue?.count ?? 0})`} value={tzs(L.cancelledRentalsRefundDue?.held)} />
      </Section>

      <div className="lg:col-span-2 text-xs flex items-center gap-2" data-testid="recon-checks">
        {allChecks ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-red-600" />}
        {allChecks ? 'Every payment tagged with this shift is accounted for exactly once.' : 'Check failed: some payments could not be accounted for — report this.'}
        {r.reversed?.length > 0 && <span className="text-[hsl(var(--muted-foreground))]">({r.reversed.length} reversed payment(s) listed, not counted)</span>}
      </div>
    </div>
  );
}

export default function ShiftsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [recon, setRecon] = useState<Record<string, any>>({});
  const [reconError, setReconError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await adminApi.posGetSessions({ limit: '50' });
      setRows(res?.data ?? res ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load shifts');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const fetchRecon = async (id: string) => {
    setBusy(id);
    try {
      const r = await adminApi.posGetSessionReconciliation(id);
      setRecon((m) => ({ ...m, [id]: r }));
      setReconError((m) => { const n = { ...m }; delete n[id]; return n; });
    } catch (e: any) {
      setReconError((m) => ({ ...m, [id]: e?.status === 403 ? 'You need the "View Reports" permission to see the reconciliation.' : e?.message || 'Could not load the reconciliation' }));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!recon[id]) await fetchRecon(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Shift reconciliation</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Cash counted at the close of each POS shift against the cash the system expected, with every payment behind it.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm disabled:opacity-60"
          data-testid="shifts-refresh"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
      </div>
      {loading && rows.length === 0 ? <Loader2 className="w-5 h-5 animate-spin text-brand-gold" /> : error ? <p className="text-sm text-red-600">{error}</p> : rows.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No shifts yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => {
            const diff = s.cashDifference == null ? null : Number(s.cashDifference);
            return (
              <div key={s.id} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]" data-testid={`shift-${s.id}`}>
                <button className="w-full flex flex-wrap items-center justify-between gap-2 p-3 text-left text-sm disabled:opacity-60" onClick={() => toggle(s.id)} disabled={busy === s.id}>
                  <span className="font-medium">{when(s.openedAt)} → {s.closedAt ? when(s.closedAt) : 'open'}</span>
                  <span>Opening {tzs(s.openingCash)} · Expected {tzs(s.expectedCash)} · Counted {tzs(s.closingCash)}</span>
                  <span className={diff == null ? 'text-[hsl(var(--muted-foreground))]' : diff === 0 ? 'text-emerald-600' : 'text-red-600 font-semibold'} data-testid={`shift-diff-${s.id}`}>
                    {diff == null ? s.status : diff === 0 ? 'Balanced' : `Difference ${tzs(diff)}`}
                  </span>
                  {busy === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : open === s.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {open === s.id && reconError[s.id] && <p className="border-t border-[hsl(var(--border))] p-3 text-sm text-red-600">{reconError[s.id]}</p>}
                {open === s.id && recon[s.id] && (
                  <>
                    <Reconciliation r={recon[s.id]} />
                    <div className="px-3 pb-3">
                      <button onClick={() => fetchRecon(s.id)} disabled={busy === s.id} className="inline-flex items-center gap-1 text-xs underline disabled:opacity-60">
                        {busy === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Recalculate
                      </button>
                      {s.notes && <span className="ml-3 text-xs italic">Note at close: {s.notes}</span>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
