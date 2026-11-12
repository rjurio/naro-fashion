'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useSyncStatus } from '@/contexts/SyncContext';

/**
 * Physical gowns (R2). Register each physical gown with a unique tag and the
 * sizes it fits; record maintenance / damage / loss / retirement. Per-gown
 * availability switches on ONLY when an inventory manager submits a physical
 * count that matches the registered gowns AND a different person approves it.
 * Until then the product keeps the one-booking-at-a-time rule. Online only.
 */
const STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED', 'SOLD', 'LOST'];
const inputCls = 'px-2 py-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm';
const card = 'rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-3';

function Btn({ busy, children, variant = 'gold', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'gold' | 'outline' | 'danger' }) {
  const v = variant === 'gold' ? 'bg-brand-gold text-white' : variant === 'danger' ? 'bg-red-600 text-white' : 'border border-[hsl(var(--border))]';
  return (
    <button {...p} disabled={busy || p.disabled} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${v} ${p.className ?? ''}`}>
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

export default function PhysicalGownsPage() {
  const toast = useToast();
  const { online } = useSyncStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (tag: string, fn: () => Promise<void>) => {
    setBusy(tag);
    try {
      await fn();
    } catch (e: any) {
      const b = e?.body ?? e?.data ?? {};
      const extra = b.unplaced?.length ? ` (${b.unplaced.map((u: any) => u.rentalNumber).join(', ')})` : b.units?.length ? ` (${b.units.join(', ')})` : '';
      toast.error(`${e?.message || 'Request failed'}${extra}`);
    } finally {
      setBusy(null);
    }
  };

  const [q, setQ] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [product, setProduct] = useState<any>(null);
  const [tracking, setTracking] = useState<any>(null);
  const [nu, setNu] = useState({ code: '', label: '', sizes: [] as string[] });
  const [count, setCount] = useState('');
  const [note, setNote] = useState('');
  const [statusEdit, setStatusEdit] = useState<Record<string, { status: string; note: string }>>({});

  const load = useCallback(async (p = product) => {
    if (p) setTracking(await adminApi.unitTracking(p.id));
  }, [product]);
  useEffect(() => { if (product) load(product).catch(() => toast.error('Failed to load gowns')); }, [product]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!online) {
    return <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">Physical gowns need internet: counts and approvals are checked online.</div>;
  }
  const sizeName = (id: string) => product?.variants?.find((v: any) => v.id === id)?.name ?? id;
  const open = tracking?.openRequest;

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Physical gowns</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Register each gown with its tag and sizes. Per-gown availability starts only after a physical count is submitted and approved by a second person.
        </p>
      </div>

      <div className={card}>
        <div className="flex gap-2">
          <input data-testid="gown-product-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a rental item" className={`${inputCls} flex-1`} />
          <Btn data-testid="gown-product-find" busy={busy === 'find'} onClick={() => run('find', async () => setProducts(await adminApi.posRentalCatalog(q)))}>
            <Search className="w-4 h-4" /> Find
          </Btn>
        </div>
        {products.map((p) => (
          <button key={p.id} data-testid={`gown-product-${p.slug}`} onClick={() => setProduct(p)} className={`block w-full text-left text-sm px-2 py-1 rounded ${product?.id === p.id ? 'bg-[hsl(var(--accent))]' : ''}`}>
            {p.name}
          </button>
        ))}
      </div>

      {product && tracking && (
        <>
          <div className={card} data-testid="gown-tracking">
            <div className="flex justify-between items-center">
              <div className="font-semibold">{product.name}</div>
              <span data-testid="gown-mode" className={`text-xs px-2 py-0.5 rounded ${tracking.mode === 'UNITS' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                {tracking.mode === 'UNITS' ? `Per-gown tracking on since ${String(tracking.activatedAt).slice(0, 10)}` : 'One booking at a time (per-gown tracking off)'}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[hsl(var(--muted-foreground))]"><th>Tag</th><th>Sizes</th><th>Status</th><th>Counted</th><th></th></tr></thead>
              <tbody>
                {tracking.registered.map((u: any) => {
                  const ed = statusEdit[u.id] ?? { status: u.status, note: '' };
                  return (
                    <tr key={u.id} data-testid={`gown-row-${u.code}`} className="border-t border-[hsl(var(--border))]">
                      <td className="font-mono">{u.code}</td>
                      <td>{u.sizes.map(sizeName).join(', ') || <span className="text-red-600">no sizes</span>}</td>
                      <td>
                        <select value={ed.status} onChange={(e) => setStatusEdit({ ...statusEdit, [u.id]: { ...ed, status: e.target.value } })} className={inputCls}>
                          {STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>{u.verified ? 'yes' : <span className="text-amber-700">not counted</span>}</td>
                      <td className="flex gap-1 py-1">
                        {ed.status !== u.status && (
                          <>
                            <input value={ed.note} onChange={(e) => setStatusEdit({ ...statusEdit, [u.id]: { ...ed, note: e.target.value } })} placeholder="Reason" className={inputCls} />
                            <Btn busy={busy === `st-${u.id}`} onClick={() => run(`st-${u.id}`, async () => { await adminApi.updateRentalUnit(u.id, { status: ed.status, note: ed.note || undefined }); setStatusEdit({ ...statusEdit, [u.id]: undefined as any }); await load(); toast.success(`${u.code}: ${ed.status}`); })}>Save</Btn>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="grid grid-cols-4 gap-2 items-start">
              <input data-testid="gown-new-code" value={nu.code} onChange={(e) => setNu({ ...nu, code: e.target.value })} placeholder="Tag (e.g. NF-IVORY-03)" className={inputCls} />
              <input value={nu.label} onChange={(e) => setNu({ ...nu, label: e.target.value })} placeholder="Description (optional)" className={inputCls} />
              <div className="flex flex-wrap gap-2 text-sm">
                {product.variants.map((v: any) => (
                  <label key={v.id} className="flex items-center gap-1">
                    <input type="checkbox" data-testid={`gown-new-size-${v.name}`} checked={nu.sizes.includes(v.id)} onChange={(e) => setNu({ ...nu, sizes: e.target.checked ? [...nu.sizes, v.id] : nu.sizes.filter((x) => x !== v.id) })} />
                    {v.name}
                  </label>
                ))}
              </div>
              <Btn data-testid="gown-register" busy={busy === 'reg'} disabled={!nu.code.trim() || nu.sizes.length === 0} onClick={() => run('reg', async () => { await adminApi.createRentalUnit({ productId: product.id, code: nu.code.trim(), label: nu.label || undefined, variantIds: nu.sizes }); setNu({ code: '', label: '', sizes: [] }); await load(); toast.success('Gown registered (not counted yet)'); })}>Register gown</Btn>
            </div>
          </div>

          <div className={card} data-testid="gown-count">
            <div className="font-semibold">Physical count and activation</div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Registered and in service or maintenance: <b data-testid="gown-serviceable">{tracking.serviceableCount}</b> · open bookings: {tracking.openBookings} · dry run: {tracking.preview.ok ? 'every booking can be placed' : `can't place ${tracking.preview.unplaced.map((u: any) => u.rentalNumber).join(', ')}`}
            </p>
            {open ? (
              <div className="text-sm space-y-2" data-testid="gown-open-request">
                <div>Count of <b>{open.countedQuantity}</b> waiting for approval (submitted {String(open.requestedAt).slice(0, 16).replace('T', ' ')}). The person who counted cannot approve it.</div>
                <div className="flex gap-2">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required to reject)" className={`${inputCls} flex-1`} />
                  <Btn data-testid="gown-approve" busy={busy === 'appr'} onClick={() => run('appr', async () => { await adminApi.decideUnitTracking(open.id, 'approve', { note: note || undefined }); setNote(''); await load(); toast.success('Count approved: per-gown tracking is on'); })}>Approve</Btn>
                  <Btn variant="outline" busy={busy === 'rej'} disabled={!note.trim()} onClick={() => run('rej', async () => { await adminApi.decideUnitTracking(open.id, 'reject', { note }); setNote(''); await load(); })}>Reject</Btn>
                  <Btn variant="outline" busy={busy === 'cxl'} onClick={() => run('cxl', async () => { await adminApi.decideUnitTracking(open.id, 'cancel'); await load(); })}>Cancel</Btn>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <input data-testid="gown-count-input" type="number" min="1" value={count} onChange={(e) => setCount(e.target.value)} placeholder="Gowns counted in the shop" className={inputCls} />
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (where / who counted)" className={`${inputCls} flex-1`} />
                <Btn data-testid="gown-count-submit" busy={busy === 'cnt'} disabled={!(Number(count) > 0)} onClick={() => run('cnt', async () => { await adminApi.requestUnitTracking(product.id, { countedQuantity: Number(count), note: note || undefined }); setCount(''); setNote(''); await load(); toast.success('Count submitted: a second person must approve it'); })}>Submit count</Btn>
              </div>
            )}
            {tracking.mode === 'UNITS' && !open && (
              <div className="flex gap-2 pt-2 border-t border-[hsl(var(--border))]">
                <input data-testid="gown-deactivate-reason" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason to switch back to one booking at a time" className={`${inputCls} flex-1`} />
                <Btn data-testid="gown-deactivate" variant="danger" busy={busy === 'deact'} disabled={!note.trim()} onClick={() => run('deact', async () => { await adminApi.deactivateUnitTracking(product.id, { reason: note }); setNote(''); await load(); toast.success('Back to one booking at a time'); })}>Switch off</Btn>
              </div>
            )}
            {tracking.history.length > 0 && (
              <ul className="text-xs text-[hsl(var(--muted-foreground))] space-y-0.5" data-testid="gown-history">
                {tracking.history.map((h: any) => (
                  <li key={h.id}>{String(h.requestedAt).slice(0, 16).replace('T', ' ')} · {h.action} · {h.status}{h.countedQuantity ? ` · counted ${h.countedQuantity}` : ''}{h.decisionNote ? ` · ${h.decisionNote}` : ''}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
