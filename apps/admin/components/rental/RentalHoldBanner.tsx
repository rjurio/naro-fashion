'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { needsInternetTitle } from '@/lib/offline/feedback';

/** Unconfirmed statuses whose booking hold (deadline) applies. */
const HOLD_STATUSES = ['PENDING_ID_VERIFICATION', 'ID_VERIFIED', 'PENDING_PAYMENT', 'PENDING'];
/** Hold states staff may extend (API: PATCH /rentals/:id/hold/extend). */
const EXTENDABLE = ['PAYMENT_REVIEW', 'AWAITING_ID', 'ID_REJECTED', 'AWAITING_DOWN_PAYMENT'];

const LABELS: Record<string, string> = {
  AWAITING_ID: 'Waiting for the customer to submit a National ID',
  ID_UNDER_REVIEW: 'ID submitted, waiting for staff review (deadline paused)',
  ID_REJECTED: 'ID not approved, waiting for a new one',
  AWAITING_DOWN_PAYMENT: 'ID approved, waiting for the down payment',
  NO_DOWN_PAYMENT: 'ID approved, no down payment due: confirm the booking',
  PAYMENT_REVIEW: 'Payment review: money received but the booking expired. Extend it, take the rest, or cancel',
  REFUND_DUE: 'Refund due: this cancelled booking still holds money paid by the customer',
  REFUND_RECORDED: 'Refund recorded',
  NO_SHOW_REVIEW: 'No-show: confirmed but not collected by the end of the pickup day. Hand over, reschedule or cancel',
};

export interface HoldRental {
  id: string;
  status: string;
  holdState?: string | null;
  holdExpiresAt?: string | null;
}

/**
 * The booking's hold (rentals/rental-hold.ts in the API): what it waits for,
 * until when, and the two staff actions — extend the deadline
 * (rentals:update-status) and record a refund payout (payments:manage).
 * The API enforces every rule; this only offers the actions.
 */
export default function RentalHoldBanner({
  rental,
  online,
  onUpdate,
}: {
  rental: HoldRental;
  online: boolean;
  onUpdate: (updated: any) => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<'none' | 'extend' | 'refund'>('none');
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'MOBILE_MONEY' | 'BANK_TRANSFER' | 'CASH'>('MOBILE_MONEY');
  const [reference, setReference] = useState('');

  const state = rental.holdState ?? '';
  const visible =
    (HOLD_STATUSES.includes(rental.status) && !!state) || ['REFUND_DUE', 'REFUND_RECORDED', 'NO_SHOW_REVIEW'].includes(state);
  if (!visible) return null;

  const canExtend = HOLD_STATUSES.includes(rental.status) && EXTENDABLE.includes(state);
  const canRecordRefund = rental.status === 'CANCELLED' && state === 'REFUND_DUE';
  const warn = ['PAYMENT_REVIEW', 'REFUND_DUE', 'NO_SHOW_REVIEW'].includes(state);

  const submit = async () => {
    setBusy(true);
    try {
      const updated =
        mode === 'extend'
          ? await adminApi.extendRentalHold(rental.id, { until: new Date(until).toISOString(), note: note.trim() })
          : await adminApi.recordRentalRefund(rental.id, {
              amount: Number(amount),
              method,
              reference: reference.trim() || undefined,
              note: note.trim(),
            });
      onUpdate(updated);
      toast(mode === 'extend' ? 'Deadline extended' : 'Refund recorded', 'success');
      setMode('none');
      setNote('');
    } catch (err: any) {
      toast(err?.message || 'Could not save', 'error');
    } finally {
      setBusy(false);
    }
  };

  const input =
    'px-2 py-1 text-xs rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]';
  const ready = note.trim().length > 0 && (mode === 'extend' ? !!until : Number(amount) > 0);

  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        warn
          ? 'border-red-300/60 bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200'
          : 'border-amber-300/60 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200'
      }`}
    >
      <span className="font-semibold">{LABELS[state] ?? state}.</span>{' '}
      {HOLD_STATUSES.includes(rental.status) &&
        (rental.holdExpiresAt
          ? `Released automatically if not done by ${new Date(rental.holdExpiresAt).toLocaleString()}.`
          : 'No deadline running; released automatically if not confirmed by the end of the pickup day.')}
      {(canExtend || canRecordRefund) && mode === 'none' && (
        <span className="ml-2">
          {canExtend && (
            <button
              type="button"
              onClick={() => setMode('extend')}
              disabled={!online}
              title={needsInternetTitle(online, 'Extend the deadline')}
              className="underline font-medium disabled:opacity-50"
            >
              Extend deadline
            </button>
          )}
          {canRecordRefund && (
            <button
              type="button"
              onClick={() => setMode('refund')}
              disabled={!online}
              title={needsInternetTitle(online, 'Record the refund payout')}
              className="underline font-medium disabled:opacity-50"
            >
              Record refund paid
            </button>
          )}
        </span>
      )}
      {mode !== 'none' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {mode === 'extend' ? (
            <label className="flex items-center gap-1">
              New deadline
              <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className={input} />
            </label>
          ) : (
            <>
              <input type="number" min="1" placeholder="Amount (TZS)" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${input} w-32`} />
              <select value={method} onChange={(e) => setMethod(e.target.value as any)} className={input}>
                <option value="MOBILE_MONEY">Mobile money</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash</option>
              </select>
              <input placeholder="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} className={`${input} w-40`} maxLength={100} />
            </>
          )}
          <input placeholder="Reason (required)" value={note} onChange={(e) => setNote(e.target.value)} className={`${input} flex-1 min-w-[12rem]`} maxLength={500} />
          <button
            type="button"
            onClick={submit}
            disabled={busy || !ready || !online}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-brand-gold text-white font-medium disabled:opacity-50"
          >
            {busy && <Loader2 className="w-3 h-3 animate-spin" />} Save
          </button>
          <button type="button" onClick={() => setMode('none')} disabled={busy} className="underline">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
