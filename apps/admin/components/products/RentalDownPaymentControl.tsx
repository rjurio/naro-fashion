'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import adminApi, { ApiError } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import InfoLabel from '@/components/ui/InfoLabel';

/** Server view of a product's setting (GET /products/:id/rental-down-payment). */
export interface DownPaymentState {
  mode: 'INHERIT' | 'CUSTOM' | 'NOT_REVIEWED' | string;
  storedPct: number | null;
  effectivePct: number;
  effectiveSource: 'product' | 'shop' | 'default';
  shopPct: number;
  shopPctSource: 'shop' | 'default';
}

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm text-[hsl(var(--foreground))]';

/**
 * Rental down payment for one product: Inherit shop default / Custom %.
 *
 * Saved on its own (PATCH /products/:id/rental-down-payment, permission
 * `rental-policies:manage`), never by the product form's Save button, so an
 * ordinary product save can't change it. Every percentage shown comes from
 * the API (the same rule quotes and bookings use). Changing it affects NEW
 * bookings only.
 */
export default function RentalDownPaymentControl({ productId }: { productId?: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<DownPaymentState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [choice, setChoice] = useState<'INHERIT' | 'CUSTOM' | null>(null);
  const [pct, setPct] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const apply = useCallback((s: DownPaymentState) => {
    setState(s);
    setChoice(s.mode === 'INHERIT' || s.mode === 'CUSTOM' ? s.mode : null);
    setPct(s.mode === 'CUSTOM' && s.storedPct != null ? String(s.storedPct) : '');
  }, []);

  const load = useCallback(() => {
    setLoadFailed(false);
    const req = productId ? adminApi.getProductDownPayment(productId) : adminApi.getProductDownPaymentDefaults();
    req.then(apply).catch(() => setLoadFailed(true));
  }, [productId, apply]);

  useEffect(() => { load(); }, [load]);

  if (loadFailed) {
    return (
      <div className="text-xs text-amber-600" data-testid="dp-load-error">
        Couldn&apos;t load the down-payment setting.{' '}
        <button type="button" className="underline" onClick={load}>Retry</button>
      </div>
    );
  }
  if (!state) return <div className="h-16 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />;

  const shopLabel = `${state.shopPct}%${state.shopPctSource === 'default' ? ' (no shop policy set: 25% fallback)' : ''}`;
  const pctNum = pct.trim() === '' ? NaN : Number(pct);
  const pctValid = Number.isInteger(pctNum) && pctNum >= 0 && pctNum <= 100;
  const dirty =
    choice !== null &&
    (choice !== state.mode || (choice === 'CUSTOM' && (!pctValid || pctNum !== state.storedPct)));
  const canSave = !!productId && dirty && (choice === 'INHERIT' || pctValid) && !saving;

  const save = async () => {
    if (!productId || !choice) return;
    setSaving(true);
    setError('');
    try {
      const next = await adminApi.setProductDownPayment(productId, {
        mode: choice,
        ...(choice === 'CUSTOM' ? { pct: pctNum } : {}),
        expectedMode: (state.mode === 'INHERIT' || state.mode === 'CUSTOM' ? state.mode : 'NOT_REVIEWED') as 'INHERIT' | 'CUSTOM' | 'NOT_REVIEWED',
        expectedPct: state.storedPct,
      });
      apply(next);
      toast('Down payment saved. It applies to new bookings only.', 'success');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data?.current) {
        apply(e.data.current);
        setError('Nothing was saved: someone else changed this setting. The current setting is shown; choose again.');
      } else if (e instanceof ApiError && e.status === 403) {
        setError('You need the "Manage Rental Down-Payment Terms" permission to change this.');
      } else {
        setError(e instanceof Error ? e.message : 'Saving failed');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sm:col-span-2 lg:col-span-3 rounded-lg border border-[hsl(var(--border))] p-4 space-y-3" data-testid="dp-control">
      <InfoLabel
        label="Down payment"
        tooltip="Share of the rental fee the customer pays to confirm a booking (the refundable deposit is separate). Changes apply to new bookings only; existing bookings keep their amounts."
      />
      <p className="text-sm" data-testid="dp-effective">
        New bookings: <strong>{state.effectivePct}%</strong>{' '}
        <span className="text-[hsl(var(--muted-foreground))]">
          ({state.effectiveSource === 'product' ? 'this product’s own setting' : state.effectiveSource === 'shop' ? 'shop default' : '25% fallback'})
        </span>
      </p>

      {state.mode === 'NOT_REVIEWED' && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="dp-not-reviewed">
          Not reviewed yet: this product has a stored {state.storedPct ?? '—'}% from before shop inheritance existed, and it keeps
          applying until you choose below.
        </p>
      )}

      {productId ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="dp-mode" checked={choice === 'INHERIT'} onChange={() => setChoice('INHERIT')} data-testid="dp-inherit" />
            Inherit shop default <span className="text-[hsl(var(--muted-foreground))]">(currently {shopLabel})</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="dp-mode" checked={choice === 'CUSTOM'} onChange={() => setChoice('CUSTOM')} data-testid="dp-custom" />
            Custom percentage
            <input
              type="number" min={0} max={100} step={1} value={pct} disabled={choice !== 'CUSTOM'}
              onChange={(e) => setPct(e.target.value)} className={`${inputCls} w-24`} data-testid="dp-pct" aria-label="Custom down payment percent"
            />
            %
          </label>
          {choice === 'CUSTOM' && pct !== '' && !pctValid && (
            <p className="text-xs text-red-600">Enter a whole number from 0 to 100 (0 = no down payment).</p>
          )}
          {error && <p className="text-xs text-red-600" data-testid="dp-error">{error}</p>}
          <button
            type="button" onClick={save} disabled={!canSave} data-testid="dp-save"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save down payment
          </button>
        </div>
      ) : (
        <p className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="dp-new-product">
          New products inherit the shop default (currently {shopLabel}). After saving the product you can set a custom percentage here.
        </p>
      )}
    </div>
  );
}
