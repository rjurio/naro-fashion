'use client';

/**
 * Admin → Financials → Shift reconciliation (R4, round 25D F). Read-only.
 *
 * Each shift opens into GET /pos/sessions/:id/reconciliation. A manager
 * (reports:view) gets the MANAGER view; the shift's own cashier gets the
 * CASHIER view (their drawer, without the shop-wide sections). Round 25E: a
 * completeness banner lists every warning, and every payment without a shift
 * tag is listed with its reason and totalled — never counted as zero.
 * The reconciliation shows:
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
import { useAuth } from '@/contexts/AuthContext';

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

const COMPONENT_LABELS: Record<string, string> = {
  RENTAL_FEE: 'Rental fee refunded',
  DEPOSIT: 'Deposit returned',
  LATE_FEE: 'Late fee refunded',
  OVERPAID: 'Overpayment returned (surplus)',
  UNALLOCATED: 'Not allocated',
};

function RowList({ rows, money = true }: { rows: any[]; money?: boolean }) {
  return (
    <ul className="list-disc ml-5">
      {rows.map((x: any) => (
        <li key={x.id}>
          {x.direction === 'OUT' ? 'Paid out' : x.direction === 'IN' ? 'Received' : 'Reversed'} {money ? tzs(x.amount) : `(${tzs(x.amount)}, not money)`} · {x.method} · {x.category} · {when(x.createdAt)}
          <span className="block text-[hsl(var(--muted-foreground))]">{x.reason}</span>
        </li>
      ))}
    </ul>
  );
}

function Reconciliation({ r }: { r: any }) {
  const d = r.drawer;
  const diffCls = d.difference == null ? '' : d.difference === 0 ? 'text-emerald-600' : 'text-red-600';
  const receipts = Object.entries(r.receipts ?? {}).filter(([, b]: any) => b.count > 0);
  const payouts = Object.entries(r.payouts ?? {}).filter(([, b]: any) => b.count > 0);
  const na = r.notAttributed ?? {};
  const cashNoShift = na.cashWithoutShift?.rows ?? [];
  const nonCashMine = na.nonCashByThisCashier?.rows ?? [];
  const nonCashOthers = na.nonCashByOtherStaff?.rows ?? [];
  const online = na.onlineInWindow?.rows ?? [];
  const reversedNoShift = na.reversedWithoutShift?.rows ?? [];
  const anyNotAttributed = cashNoShift.length + nonCashMine.length + nonCashOthers.length + online.length + reversedNoShift.length > 0 || Number(na.totals?.hiddenRows) > 0;
  const warn = (r.warnings ?? []).filter((w: any) => w.severity === 'WARN');
  const info = (r.warnings ?? []).filter((w: any) => w.severity === 'INFO');
  const L = r.liabilitiesNow;
  const byComponent = Object.entries(r.rentalPayoutsByComponent ?? {});
  const allChecks = r.checks?.everyTaggedRowAccounted && r.checks?.receiptsAddUp && r.checks?.payoutsAddUp;
  return (
    <div className="border-t border-[hsl(var(--border))] p-3 text-sm grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="shift-reconciliation">
      <div className="lg:col-span-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-2 py-0.5 font-medium ${r.view === 'CASHIER' ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' : 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'}`} data-testid="recon-view">
          {r.view === 'CASHIER' ? 'Cashier view: your drawer' : 'Manager view'}
        </span>
        {r.view === 'CASHIER' && <span className="text-[hsl(var(--muted-foreground))]">Shop-wide liabilities and other staff&apos;s rows are shown to managers only.</span>}
      </div>
      <div
        className={`lg:col-span-2 rounded-lg border p-3 text-xs ${r.complete ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' : 'border-red-300 bg-red-50 dark:bg-red-950/30'}`}
        data-testid="recon-completeness"
        data-complete={r.complete ? 'true' : 'false'}
      >
        <div className="flex items-center gap-2 font-medium">
          {r.complete ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-red-600" />}
          {r.complete ? 'Complete: every payment in this shift is accounted for.' : `Incomplete: ${warn.length} item(s) need checking before this shift is signed off.`}
        </div>
        {warn.length > 0 && <ul className="list-disc ml-6 mt-1" data-testid="recon-warnings">{warn.map((w: any) => <li key={w.code}>{w.message}</li>)}</ul>}
        {info.length > 0 && <ul className="ml-6 mt-1 text-[hsl(var(--muted-foreground))]">{info.map((w: any) => <li key={w.code}>{w.message}</li>)}</ul>}
      </div>
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
        {Number(r.books.overpaymentsReturned) > 0 && (
          <Row label="Overpayments returned (customer surplus)" value={tzs(r.books.overpaymentsReturned)} testId="recon-overpaid-returned" />
        )}
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
        {byComponent.length > 0 && (
          <ul className="mt-2 text-xs" data-testid="recon-rental-payouts">
            {byComponent.map(([k, b]: any) => <li key={k} data-testid={`recon-rental-payout-${k}`}>{COMPONENT_LABELS[k] ?? k}: {tzs(b.total)}</li>)}
          </ul>
        )}
        <div className="mt-2 text-xs">
          <div className="font-medium">By method (in / out)</div>
          <ul data-testid="recon-methods">
            {Object.entries(r.byMethod ?? {}).map(([m, v]: any) => <li key={m}>{m}: {tzs(v.in)} in · {tzs(v.out)} out</li>)}
            {Object.keys(r.byMethod ?? {}).length === 0 && <li>No money moved.</li>}
          </ul>
        </div>
      </Section>

      {anyNotAttributed && (
        <div className="lg:col-span-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-2" data-testid="recon-not-attributed">
          <div className="flex gap-2 font-medium"><AlertTriangle className="w-4 h-4 text-amber-600" /> Money with no shift tag: listed, NOT in the expected cash, never counted as zero</div>
          <div data-testid="recon-not-attributed-totals">
            Not attributed: cash {tzs(na.totals?.cash?.net)} ({na.totals?.cash?.rows ?? 0} row(s)) · non-cash {tzs(na.totals?.nonCash?.net)} ({na.totals?.nonCash?.rows ?? 0} row(s))
            {Number(na.totals?.online?.rows) > 0 && <> · online {tzs(na.totals.online.net)} ({na.totals.online.rows})</>} — not in the drawer figure.
          </div>
          {cashNoShift.length > 0 && <div><div className="font-medium">Cash without a drawer tag (net {tzs(na.cashWithoutShift.net)})</div><RowList rows={cashNoShift} /></div>}
          {nonCashMine.length > 0 && <div><div className="font-medium">Non-cash recorded by this cashier without a shift tag</div><RowList rows={nonCashMine} /></div>}
          {nonCashOthers.length > 0 && <div><div className="font-medium">Non-cash recorded by other or unknown staff without a shift tag</div><RowList rows={nonCashOthers} /></div>}
          {online.length > 0 && <div><div className="font-medium">Online gateway payments during the shift (online channel)</div><RowList rows={online} /></div>}
          {reversedNoShift.length > 0 && <div><div className="font-medium">Reversed payments without a shift tag</div><RowList rows={reversedNoShift} money={false} /></div>}
          {na.hiddenNote && <p className="italic" data-testid="recon-hidden-note">{na.hiddenNote}</p>}
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

      {L ? (
        <Section title={`Shop liabilities now (${when(L.asOf)})`}>
          <Row label={`Deposits held (${L.depositsHeld?.rentals ?? 0} bookings)`} value={tzs(L.depositsHeld?.amount)} testId="recon-deposits-held" />
          <Row label={`Layaway money held (${L.layawayPrepaymentsHeld?.layaways ?? 0})`} value={tzs(L.layawayPrepaymentsHeld?.amount)} />
          <Row label={`Refunds approved, not paid (${L.refundRequestsApprovedUnpaid?.count ?? 0})`} value={tzs(L.refundRequestsApprovedUnpaid?.amount)} testId="recon-approved-unpaid" />
          <Row label={`Refunds awaiting approval (${L.refundRequestsAwaitingApproval?.count ?? 0})`} value={tzs(L.refundRequestsAwaitingApproval?.amount)} />
          <Row label={`Cancelled bookings with money due back (${L.cancelledRentalsRefundDue?.count ?? 0})`} value={tzs(L.cancelledRentalsRefundDue?.held)} />
        </Section>
      ) : (
        <Section title="Shop liabilities now">
          <p className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="recon-liabilities-hidden">Shown to managers (View Reports) only.</p>
        </Section>
      )}

      <div className="lg:col-span-2 text-xs flex items-center gap-2" data-testid="recon-checks">
        {allChecks ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-red-600" />}
        {allChecks ? 'Every payment tagged with this shift is accounted for exactly once.' : 'Check failed: some payments could not be accounted for — report this.'}
        {r.reversed?.length > 0 && <span className="text-[hsl(var(--muted-foreground))]">({r.reversed.length} reversed payment(s) listed, not counted)</span>}
      </div>
    </div>
  );
}

export default function ShiftsPage() {
  const { user } = useAuth();
  const [mineOnly, setMineOnly] = useState(false);
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
      setReconError((m) => ({ ...m, [id]: e?.status === 403 ? 'Only the cashier who ran this shift, or a manager with the "View Reports" permission, can see its reconciliation.' : e?.message || 'Could not load the reconciliation' }));
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
        <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} data-testid="shifts-mine-only" /> My shifts only
        </label>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm disabled:opacity-60"
          data-testid="shifts-refresh"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
        </div>
      </div>
      {loading && rows.length === 0 ? <Loader2 className="w-5 h-5 animate-spin text-brand-gold" /> : error ? <p className="text-sm text-red-600">{error}</p> : rows.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No shifts yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.filter((s) => !mineOnly || s.adminUserId === user?.id).map((s) => {
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
