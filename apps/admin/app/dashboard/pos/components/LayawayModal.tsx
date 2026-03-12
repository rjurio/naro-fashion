'use client';

import { useState, useEffect } from 'react';
import { X, Clock, Plus, CreditCard, Check } from 'lucide-react';
import adminApi from '../../../../lib/api';
import { PAYMENT_METHOD_LABELS } from '@naro/shared';

interface Props {
  onClose: () => void;
}

const PAYMENT_METHODS = ['CASH', 'MPESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'MIX_BY_YAS', 'CARD'];

export default function LayawayModal({ onClose }: Props) {
  const [tab, setTab] = useState<'list' | 'create'>('list');
  const [layaways, setLayaways] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ACTIVE');

  // Payment modal
  const [payingLayawayId, setPayingLayawayId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('CASH');
  const [payRef, setPayRef] = useState('');
  const [payProcessing, setPayProcessing] = useState(false);

  useEffect(() => {
    loadLayaways();
  }, [statusFilter]);

  const loadLayaways = async () => {
    setLoading(true);
    try {
      const result = await adminApi.posGetLayaways({ status: statusFilter });
      setLayaways(result?.data || []);
    } catch {
      setLayaways([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    if (!payingLayawayId || payAmount <= 0 || payProcessing) return;
    setPayProcessing(true);
    try {
      await adminApi.posLayawayPayment(payingLayawayId, {
        amount: payAmount,
        method: payMethod,
        transactionRef: payRef || undefined,
      });
      setPayingLayawayId(null);
      loadLayaways();
    } catch (err: any) {
      alert(err.message || 'Payment failed');
    } finally {
      setPayProcessing(false);
    }
  };

  const handleComplete = async (id: string) => {
    if (!confirm('Complete this layaway? This will create an order and deduct stock.')) return;
    try {
      await adminApi.posCompleteLayaway(id);
      loadLayaways();
    } catch (err: any) {
      alert(err.message || 'Failed to complete layaway');
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this layaway?')) return;
    try {
      await adminApi.posCancelLayaway(id);
      loadLayaways();
    } catch (err: any) {
      alert(err.message || 'Failed to cancel');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[hsl(var(--card))] rounded-xl w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
            <Clock className="w-4 h-4 text-brand-gold" />
            Layaway Management
          </h3>
          <button onClick={onClose} className="text-[hsl(var(--muted-foreground))]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Tabs */}
        <div className="px-4 py-2 border-b border-[hsl(var(--border))] flex gap-2">
          {['ACTIVE', 'COMPLETED', 'CANCELLED'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1 rounded-full text-xs ${
                statusFilter === status
                  ? 'bg-brand-gold text-black'
                  : 'bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))]'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[hsl(var(--border))]">
          {loading && (
            <div className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">Loading...</div>
          )}

          {!loading && layaways.length === 0 && (
            <div className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
              No {statusFilter.toLowerCase()} layaways
            </div>
          )}

          {layaways.map((lay) => {
            const items = Array.isArray(lay.items) ? lay.items : [];
            return (
              <div key={lay.id} className="px-4 py-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                      {lay.layawayNumber}
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {lay.customer?.firstName} {lay.customer?.lastName} • {lay.customer?.phone}
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {items.length} item(s) • Due: {new Date(lay.dueDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[hsl(var(--foreground))]">
                      {Number(lay.total).toLocaleString()} TZS
                    </p>
                    <p className="text-xs text-green-600">
                      Paid: {Number(lay.depositPaid).toLocaleString()}
                    </p>
                    <p className="text-xs text-amber-500">
                      Due: {Number(lay.balanceDue).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-1.5 bg-[hsl(var(--accent))] rounded-full mb-2">
                  <div
                    className="h-full bg-brand-gold rounded-full"
                    style={{
                      width: `${Math.min(100, (Number(lay.depositPaid) / Number(lay.total)) * 100)}%`,
                    }}
                  />
                </div>

                {/* Actions */}
                {lay.status === 'ACTIVE' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setPayingLayawayId(lay.id);
                        setPayAmount(Number(lay.balanceDue));
                      }}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-brand-gold text-black text-xs font-medium"
                    >
                      <CreditCard className="w-3 h-3" />
                      Record Payment
                    </button>
                    {Number(lay.balanceDue) <= 0 && (
                      <button
                        onClick={() => handleComplete(lay.id)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded bg-green-600 text-white text-xs font-medium"
                      >
                        <Check className="w-3 h-3" />
                        Complete
                      </button>
                    )}
                    <button
                      onClick={() => handleCancel(lay.id)}
                      className="px-3 py-1.5 rounded border border-red-300 text-red-500 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Payments History */}
                {lay.payments && lay.payments.length > 0 && (
                  <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                    {lay.payments.map((p: any, i: number) => (
                      <div key={i} className="flex justify-between">
                        <span>{PAYMENT_METHOD_LABELS[p.method] ?? p.method} • {new Date(p.createdAt).toLocaleDateString()}</span>
                        <span>{Number(p.amount).toLocaleString()} TZS</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Payment Sub-Modal */}
        {payingLayawayId && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl">
            <div className="bg-[hsl(var(--card))] rounded-lg p-4 w-80 shadow-lg">
              <h4 className="text-sm font-semibold mb-3 text-[hsl(var(--foreground))]">Record Payment</h4>
              <div className="space-y-2">
                <input
                  type="number"
                  value={payAmount || ''}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm"
                  placeholder="Amount..."
                />
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m] ?? m}</option>
                  ))}
                </select>
                {payMethod !== 'CASH' && (
                  <input
                    type="text"
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm"
                    placeholder="Transaction ref..."
                  />
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setPayingLayawayId(null)}
                  className="flex-1 py-2 rounded border border-[hsl(var(--border))] text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePayment}
                  disabled={payProcessing || payAmount <= 0}
                  className="flex-1 py-2 rounded bg-brand-gold text-black text-sm font-medium disabled:opacity-40"
                >
                  {payProcessing ? 'Processing...' : 'Pay'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
