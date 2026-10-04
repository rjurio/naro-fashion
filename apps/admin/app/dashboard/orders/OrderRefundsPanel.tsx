'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  adminApi,
  type OrderRefundMethod,
  type OrderRefundSummary,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

/** paymentStatus values for which the refund panel is relevant. */
export const REFUND_RELEVANT_PAYMENT_STATUSES = [
  'PAID',
  'PARTIAL',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
];

const METHOD_OPTIONS: { value: OrderRefundMethod; label: string }[] = [
  { value: 'MOBILE_MONEY', label: 'Mobile money (sent manually)' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CASH', label: 'Cash' },
  { value: 'GATEWAY', label: 'Payment gateway (automatic)' },
];

const METHOD_LABELS: Record<string, string> = {
  MOBILE_MONEY: 'Mobile money',
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
  GATEWAY: 'Gateway',
};

const tzs = (v: unknown) => `TZS ${(Number(v) || 0).toLocaleString()}`;

const inputCls =
  'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';

interface Props {
  orderId: string;
  orderNumber: string;
  /** Called after a refund so the parent row's payment badge updates. */
  onPaymentStatusChange: (paymentStatus: string) => void;
}

/**
 * Expanded-row refund panel for ONLINE orders: refund history, balances and a
 * "Record refund" modal (POST /orders/:id/refunds, `orders:refund`).
 */
export default function OrderRefundsPanel({ orderId, orderNumber, onPaymentStatusChange }: Props) {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const allowed = hasPermission('orders:refund');

  const [summary, setSummary] = useState<OrderRefundSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<OrderRefundMethod>('MOBILE_MONEY');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await adminApi.getOrderRefunds(orderId);
      setSummary(data);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load refunds');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  if (!allowed) return null;

  const openModal = () => {
    setAmount(summary ? String(summary.refundable) : '');
    setMethod('MOBILE_MONEY');
    setReference('');
    setNote('');
    setFormError(null);
    setOpen(true);
  };

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setFormError('Enter an amount greater than 0.');
      return;
    }
    if (summary && value > summary.refundable) {
      setFormError(`Amount cannot exceed the refundable balance (${tzs(summary.refundable)}).`);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await adminApi.createOrderRefund(orderId, {
        amount: Math.round(value * 100) / 100,
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast(`Refund of ${tzs(value)} recorded for ${orderNumber}`, 'success');
      setOpen(false);
      if (res?.paymentStatus) onPaymentStatusChange(String(res.paymentStatus));
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to record refund');
    } finally {
      setSubmitting(false);
    }
  };

  const refunds = summary?.refunds ?? [];

  return (
    <div className="space-y-2 rounded-lg border border-[hsl(var(--border))] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">Refunds</h4>
        {summary?.canRefund && (
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openModal(); }}>
            <RotateCcw className="w-3.5 h-3.5" />
            Record refund
          </Button>
        )}
      </div>

      {loading && !summary ? (
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-gold" /> Loading refunds…
        </div>
      ) : loadError ? (
        <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>
      ) : summary ? (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
            <span>Collected: <span className="font-medium text-[hsl(var(--foreground))]">{tzs(summary.totalCollected)}</span></span>
            <span>Refunded: <span className="font-medium text-[hsl(var(--foreground))]">{tzs(summary.totalRefunded)}</span></span>
            <span>Refundable: <span className="font-medium text-[hsl(var(--foreground))]">{tzs(summary.refundable)}</span></span>
          </div>
          {refunds.length === 0 ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">No refunds recorded yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[hsl(var(--border))]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
                    <th className="px-3 py-1.5 text-left font-medium">Date</th>
                    <th className="px-3 py-1.5 text-right font-medium">Amount</th>
                    <th className="px-3 py-1.5 text-left font-medium">Method</th>
                    <th className="px-3 py-1.5 text-left font-medium">Reference</th>
                    <th className="px-3 py-1.5 text-left font-medium">By</th>
                    <th className="px-3 py-1.5 text-left font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((r) => (
                    <tr key={r.id} className="border-b border-[hsl(var(--border))] last:border-b-0">
                      <td className="px-3 py-1.5 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right font-medium whitespace-nowrap">{tzs(r.amount)}</td>
                      <td className="px-3 py-1.5">{METHOD_LABELS[r.method] ?? r.method}{r.kind === 'POS_REFUND' ? ' (POS)' : ''}</td>
                      <td className="px-3 py-1.5">{r.reference || '-'}</td>
                      <td className="px-3 py-1.5">{r.refundedByName || r.refundedBy || '-'}</td>
                      <td className="px-3 py-1.5 max-w-[16rem] truncate" title={r.note ?? ''}>{r.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      <Modal
        isOpen={open}
        onClose={() => { if (!submitting) setOpen(false); }}
        title={`Record refund — ${orderNumber}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              {submitting ? 'Recording…' : 'Record refund'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
          {summary && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Refundable balance: <span className="font-medium text-[hsl(var(--foreground))]">{tzs(summary.refundable)}</span>
            </p>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[hsl(var(--foreground))]">Amount (TZS)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              max={summary?.refundable}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[hsl(var(--foreground))]">Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as OrderRefundMethod)} className={inputCls}>
              {METHOD_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            {method === 'GATEWAY' && (
              <span className="block text-[11px] text-amber-700 dark:text-amber-400">
                Gateway refunds are not integrated yet for Selcom or ClickPesa — send the money back yourself and record it with another method.
              </span>
            )}
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[hsl(var(--foreground))]">Reference (optional)</span>
            <input
              type="text"
              maxLength={100}
              placeholder="e.g. M-Pesa receipt or bank reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[hsl(var(--foreground))]">Note (optional)</span>
            <textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputCls}
            />
          </label>
          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
        </div>
      </Modal>
    </div>
  );
}
