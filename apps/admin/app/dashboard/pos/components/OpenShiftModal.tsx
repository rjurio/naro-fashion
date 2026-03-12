'use client';

import { useState } from 'react';
import { DollarSign } from 'lucide-react';

interface Props {
  onOpen: (openingCash: number) => Promise<void>;
  onCancel?: () => void;
}

export default function OpenShiftModal({ onOpen, onCancel }: Props) {
  const [openingCash, setOpeningCash] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onOpen(openingCash);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[hsl(var(--card))] rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-brand-gold/10 flex items-center justify-center mx-auto mb-4">
            <DollarSign className="w-8 h-8 text-brand-gold" />
          </div>
          <h2 className="text-xl font-bold text-[hsl(var(--foreground))]">Open Shift</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Enter the opening cash amount in the drawer
          </p>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-2">
            Opening Cash (TZS)
          </label>
          <input
            type="number"
            min={0}
            value={openingCash || ''}
            onChange={(e) => setOpeningCash(Number(e.target.value))}
            className="w-full px-4 py-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-lg text-center font-semibold focus:outline-none focus:ring-2 focus:ring-brand-gold"
            placeholder="0"
            autoFocus
          />
        </div>

        <div className="flex gap-3">
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 py-3 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--foreground))] font-medium text-base hover:bg-[hsl(var(--accent))] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 py-3 rounded-lg bg-brand-gold text-black font-bold text-base disabled:opacity-50 hover:bg-brand-gold/90 transition-colors"
          >
            {loading ? 'Opening...' : 'Start Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}
