'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck, X, Ban } from 'lucide-react';
import { adminApi } from '@/lib/api';

/**
 * Round 25F D — two-person activation of a checklist template.
 * APPROVE: a person who did not prepare this version ticks EVERY item with its
 * quantity and the scope, then approves the exact version + content hash.
 * WITHDRAW: stops the template being used for new bookings (reason required).
 */
export interface ApprovalTemplate {
  id: string;
  name: string;
  version?: number;
  contentHash?: string;
  approvalStatus?: string;
  productId?: string | null;
  categoryId?: string | null;
  items: Array<{ id: string; label: string; quantity?: number; itemType: string; isMandatory?: boolean }>;
}

export default function TemplateApprovalDialog({
  template, mode, scopeLabel, onClose, onDone,
}: {
  template: ApprovalTemplate;
  mode: 'approve' | 'withdraw';
  scopeLabel: string;
  onClose: () => void;
  onDone: (updated: any) => void;
}) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [scopeOk, setScopeOk] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = template.items ?? [];
  const allTicked = scopeOk && items.length > 0 && items.every((i) => ticked[i.id]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = mode === 'approve'
        ? await adminApi.approveChecklistTemplate(template.id, {
            version: template.version ?? 1,
            hash: template.contentHash ?? '',
            scope: { productId: template.productId ?? null, categoryId: template.categoryId ?? null },
            confirmedItems: items.map((i) => ({ itemId: i.id, quantity: i.quantity ?? 1 })),
          })
        : await adminApi.withdrawChecklistTemplate(template.id, { reason: reason.trim() });
      onDone(updated);
    } catch (e: any) {
      const body = e?.body ?? e?.data ?? {};
      setError(body?.problems?.length ? `${e?.message ?? 'Refused'}` : (e?.message ?? 'Request failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="template-approval-dialog">
      <div className="w-full max-w-lg rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
          <h2 className="font-semibold text-[hsl(var(--foreground))]">
            {mode === 'approve' ? 'Approve checklist' : 'Withdraw checklist'}: {template.name} (version {template.version ?? 1})
          </h2>
          <button onClick={onClose} disabled={busy} className="p-1 rounded hover:bg-[hsl(var(--muted))]" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          {mode === 'approve' ? (
            <>
              <p className="text-[hsl(var(--muted-foreground))]">
                Check each item against the real gown and what goes out with it. You can only approve a version you did not prepare or edit.
              </p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={scopeOk} onChange={(e) => setScopeOk(e.target.checked)} aria-label="Confirm scope" />
                <span>Applies to: <strong>{scopeLabel}</strong></span>
              </label>
              <ul className="space-y-2" aria-label="Items to confirm">
                {items.map((i) => (
                  <li key={i.id}>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!ticked[i.id]} onChange={(e) => setTicked((t) => ({ ...t, [i.id]: e.target.checked }))} aria-label={`Confirm ${i.label}`} />
                      <span><strong>{i.quantity ?? 1} ×</strong> {i.label} <span className="text-xs text-[hsl(var(--muted-foreground))]">({i.itemType === 'RETURN' ? 'return check' : 'goes out and comes back'}{i.isMandatory === false ? ', optional' : ''})</span></span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[hsl(var(--muted-foreground))] break-all">Content code: {template.contentHash?.slice(0, 16)}…</p>
            </>
          ) : (
            <>
              <p className="text-[hsl(var(--muted-foreground))]">New bookings will not get this checklist; bookings that already have it keep it unchanged.</p>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why (at least 10 characters)" aria-label="Withdrawal reason"
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-transparent p-2" />
            </>
          )}
          {error && <p className="text-red-600" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-[hsl(var(--border))]">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg border border-[hsl(var(--border))]">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || (mode === 'approve' ? !allTicked : reason.trim().length < 10)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-gold text-black disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'approve' ? <ShieldCheck className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
            {mode === 'approve' ? 'Approve this version' : 'Withdraw'}
          </button>
        </div>
      </div>
    </div>
  );
}
