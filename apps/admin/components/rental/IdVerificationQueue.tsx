'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import adminApi from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import PrivateDocument from '@/components/ui/PrivateDocument';
import { formatDate } from '@/lib/utils';

interface PendingVerification {
  id: string;
  idNumber?: string;
  frontImageUrl?: string;
  backImageUrl?: string;
  createdAt: string;
  user?: { firstName?: string; lastName?: string; email?: string; phone?: string };
}

/**
 * Pending National-ID verifications with the uploaded documents. Documents
 * are private (`private://id-documents/...`) and loaded with the bearer
 * token through <PrivateDocument>.
 */
export default function IdVerificationQueue({ onChanged }: { onChanged?: () => void }) {
  const { toast } = useToast();
  const [items, setItems] = useState<PendingVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await adminApi.getPendingVerifications();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (id: string) => {
    setActionId(id);
    try {
      await adminApi.approveVerification(id);
      toast('ID verified', 'success');
      setItems((prev) => prev.filter((v) => v.id !== id));
      onChanged?.();
    } catch (err: any) {
      toast(err?.message || 'Failed to approve verification', 'error');
    } finally {
      setActionId(null);
    }
  };

  const reject = async (id: string) => {
    if (!reason.trim()) {
      toast('Enter a reason for the customer', 'error');
      return;
    }
    setActionId(id);
    try {
      await adminApi.rejectVerification(id, reason.trim());
      toast('Verification rejected', 'success');
      setItems((prev) => prev.filter((v) => v.id !== id));
      setRejectingId(null);
      setReason('');
      onChanged?.();
    } catch (err: any) {
      toast(err?.message || 'Failed to reject verification', 'error');
    } finally {
      setActionId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-brand-gold" />
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--foreground))]">
        <ShieldCheck className="w-4 h-4 text-brand-gold" /> ID verifications awaiting review ({items.length})
      </h2>
      {items.map((v) => {
        const name = `${v.user?.firstName || ''} ${v.user?.lastName || ''}`.trim() || v.user?.email || 'Customer';
        return (
          <div key={v.id} className="rounded-lg border border-[hsl(var(--border))] p-3 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium text-[hsl(var(--foreground))]">{name}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {[v.user?.email, v.user?.phone].filter(Boolean).join(' · ')}
                  {v.idNumber ? ` · ID ${v.idNumber}` : ''} · submitted {formatDate(v.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => approve(v.id)}
                  disabled={actionId === v.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {actionId === v.id && rejectingId !== v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => { setRejectingId(rejectingId === v.id ? null : v.id); setReason(''); }}
                  disabled={actionId === v.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] mb-1">Front</p>
                <PrivateDocument src={v.frontImageUrl} alt={`${name} ID front`} className="w-full h-48" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] mb-1">Back</p>
                <PrivateDocument src={v.backImageUrl} alt={`${name} ID back`} className="w-full h-48" />
              </div>
            </div>
            {rejectingId === v.id && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason shown to the customer (e.g. photo is blurry)"
                  maxLength={500}
                  className="flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm outline-none focus:border-brand-gold"
                />
                <button
                  type="button"
                  onClick={() => reject(v.id)}
                  disabled={actionId === v.id}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {actionId === v.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm reject
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
