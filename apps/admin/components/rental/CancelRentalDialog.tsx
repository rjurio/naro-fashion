'use client';

/**
 * Cancel a rental with a structured reason (round 25C F). Cancelling before
 * collection never forfeits money: whatever was received becomes full refund
 * REQUESTS (approved by a second person, then paid out) — shown to staff here.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';

export const CANCELLATION_REASON_OPTIONS: Array<[string, string]> = [
  ['CUSTOMER_REQUEST', 'Customer asked to cancel'],
  ['SHOP', 'Shop-caused (item damaged, double-booked, shop closed…)'],
  ['PAYMENT_EXPIRED', 'Down payment not received in time'],
  ['ID_FAILED', 'National ID not approved'],
  ['DUPLICATE', 'Duplicate booking'],
  ['NO_SHOW', 'Customer did not collect'],
  ['OTHER', 'Other (explain below)'],
];

export default function CancelRentalDialog({ rentalLabel, onCancel, onClose }: {
  rentalLabel: string;
  onCancel: (reason: string, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const needsNote = reason === 'OTHER';
  const submit = async () => {
    setBusy(true);
    try { await onCancel(reason, note.trim()); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" data-testid="cancel-rental-dialog">
      <div className="w-full max-w-md rounded-xl bg-[hsl(var(--card))] p-5 space-y-4 shadow-xl">
        <h2 className="text-lg font-semibold">Cancel rental {rentalLabel}</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          The dates are released for other bookings. Everything the customer has paid becomes a full refund request: a second
          person approves it and finance pays it out. Nothing is kept automatically. This can&apos;t be undone.
        </p>
        <label className="block text-sm font-medium">Reason <span className="text-red-500">*</span>
          <select aria-label="Cancellation reason" value={reason} onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm">
            <option value="">Choose…</option>
            {CANCELLATION_REASON_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Note{needsNote && <span className="text-red-500"> *</span>}
          <textarea aria-label="Cancellation note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2}
            className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Keep the booking</Button>
          <Button variant="danger" disabled={busy || !reason || (needsNote && note.trim().length < 5)} onClick={submit}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}Cancel rental
          </Button>
        </div>
      </div>
    </div>
  );
}
