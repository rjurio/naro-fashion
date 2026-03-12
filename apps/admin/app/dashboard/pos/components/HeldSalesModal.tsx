'use client';

import { useEffect, useState } from 'react';
import { X, Play, Trash2, Clock } from 'lucide-react';
import adminApi from '../../../../lib/api';

interface Props {
  onClose: () => void;
  onResume: (heldSale: any) => void;
}

export default function HeldSalesModal({ onClose, onResume }: Props) {
  const [heldSales, setHeldSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHeldSales();
  }, []);

  const loadHeldSales = async () => {
    try {
      const data = await adminApi.posGetHeldSales();
      setHeldSales(Array.isArray(data) ? data : []);
    } catch {
      setHeldSales([]);
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async (id: string) => {
    try {
      const held = await adminApi.posResumeHeldSale(id);
      onResume(held);
    } catch (err: any) {
      alert(err.message || 'Failed to resume sale');
    }
  };

  const handleDiscard = async (id: string) => {
    if (!confirm('Discard this held sale?')) return;
    try {
      await adminApi.posDiscardHeldSale(id);
      setHeldSales((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to discard');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[hsl(var(--card))] rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Held Sales ({heldSales.length})
          </h3>
          <button onClick={onClose} className="text-[hsl(var(--muted-foreground))]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
              Loading...
            </div>
          )}

          {!loading && heldSales.length === 0 && (
            <div className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
              No held sales
            </div>
          )}

          {heldSales.map((sale) => {
            const items = Array.isArray(sale.items) ? sale.items : [];
            const itemTotal = items.reduce(
              (s: number, i: any) => s + (i.unitPrice * i.quantity - (i.itemDiscount ?? 0)),
              0,
            );
            return (
              <div
                key={sale.id}
                className="px-4 py-3 border-b border-[hsl(var(--border))] last:border-0"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                      {sale.customerName || 'Walk-in Customer'}
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {items.length} item(s) • {new Date(sale.createdAt).toLocaleString()}
                    </p>
                    {sale.note && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))] italic mt-0.5">
                        {sale.note}
                      </p>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    {itemTotal.toLocaleString()} TZS
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleResume(sale.id)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-brand-gold text-black text-xs font-medium"
                  >
                    <Play className="w-3 h-3" />
                    Resume
                  </button>
                  <button
                    onClick={() => handleDiscard(sale.id)}
                    className="px-3 py-1.5 rounded border border-red-300 text-red-500 text-xs hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
