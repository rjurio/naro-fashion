'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import adminApi from '../../../../lib/api';

interface Props {
  sessionId: string;
  onClose: () => void;
  onShiftClosed: () => void;
}

export default function CloseShiftModal({ sessionId, onClose, onShiftClosed }: Props) {
  const [closingCash, setClosingCash] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    adminApi.posGetSessionSummary(sessionId).then(setSummary).catch(() => {});
  }, [sessionId]);

  const handleClose = async () => {
    setLoading(true);
    try {
      await adminApi.posCloseSession({ closingCash, notes: notes || undefined });
      onShiftClosed();
    } catch (err: any) {
      alert(err.message || 'Failed to close shift');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[hsl(var(--card))] rounded-2xl p-6 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[hsl(var(--foreground))]">Close Shift</h2>
          <button onClick={onClose} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-[hsl(var(--accent))]">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Total Sales</p>
              <p className="text-lg font-bold text-[hsl(var(--foreground))]">
                {(summary.totalSales ?? 0).toLocaleString()} TZS
              </p>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(var(--accent))]">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Transactions</p>
              <p className="text-lg font-bold text-[hsl(var(--foreground))]">
                {summary.totalTransactions ?? 0}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(var(--accent))]">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Items Sold</p>
              <p className="text-lg font-bold text-[hsl(var(--foreground))]">
                {summary.totalItems ?? 0}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-[hsl(var(--accent))]">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Discounts Given</p>
              <p className="text-lg font-bold text-[hsl(var(--foreground))]">
                {(summary.totalDiscount ?? 0).toLocaleString()} TZS
              </p>
            </div>

            {summary.paymentBreakdown && Object.keys(summary.paymentBreakdown).length > 0 && (
              <div className="col-span-2 p-3 rounded-lg bg-[hsl(var(--accent))]">
                <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">Payment Breakdown</p>
                <div className="space-y-1">
                  {Object.entries(summary.paymentBreakdown).map(([method, amount]) => (
                    <div key={method} className="flex justify-between text-sm">
                      <span className="text-[hsl(var(--muted-foreground))]">{method}</span>
                      <span className="font-medium text-[hsl(var(--foreground))]">
                        {(Number(amount)).toLocaleString()} TZS
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Closing Cash Count (TZS)
            </label>
            <input
              type="number"
              min={0}
              value={closingCash || ''}
              onChange={(e) => setClosingCash(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm"
              placeholder="Count your cash..."
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm resize-none"
              placeholder="Any notes about this shift..."
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--foreground))] text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm font-bold disabled:opacity-50 hover:bg-red-700"
          >
            {loading ? 'Closing...' : 'Close Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}
