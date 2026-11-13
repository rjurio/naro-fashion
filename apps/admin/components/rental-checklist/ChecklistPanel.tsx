'use client';

/**
 * R3 mandatory rental checklist — one panel for the Admin rental page and the
 * POS hand-over / return. Everything is decided by the API
 * (/rental-checklist/rentals/:id); this screen only records evidence and
 * shows what is still missing:
 *   - hand-over: item, quantity, condition per mandatory item (who + when);
 *   - exceptions: requested here, decided by a different person;
 *   - return: inspection against what was handed over; discrepancies per
 *     item, reviewed by someone other than the inspector.
 * Corrections add a new record naming the one they replace; a 409 means
 * someone else recorded meanwhile — the panel reloads, never overwrites.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';

type Item = {
  id: string; label: string; labelSwahili?: string | null; stage: 'BOTH' | 'RETURN'; quantity: number;
  isMandatory: boolean; requiresCondition: boolean; instructions?: string | null;
  handover?: Rec | null; return?: Rec | null;
  /** What physically went out (null = not recorded) and therefore what must come back (round 25C B). */
  issuedQuantity?: number | null; expectedReturn?: number;
  exception?: { id: string; kind: string; substituteNote?: string | null } | null;
};
type Rec = { id: string; quantity: number; condition?: string | null; note?: string | null; recordedById: string; recordedAt: string };
type Exc = { id: string; kind: string; snapshotItemIds: string[]; substituteNote?: string | null; reason: string; status: string; requestedById: string; decidedById?: string | null; decisionNote?: string | null; usedById?: string | null };
type Disc = { id: string; snapshotItemId: string; kind: string; quantity: number; note?: string | null; status: string; resolutionNote?: string | null; resolvedById?: string | null };
type State = {
  rental: { id: string; rentalNumber: string; status: string; unitCode?: string | null };
  snapshot: null | { source: string; templateName?: string | null; templateVersion?: number | null; currentTemplateVersion?: number | null; frozenAt: string; unitCode?: string | null };
  items: Item[]; exceptions: Exc[]; discrepancies: Disc[];
  handover: { stageOpen: boolean; unresolved: string[] };
  inspection: { stageOpen: boolean; complete: boolean; notInspected: string[]; openDiscrepancies: string[] };
  people: Record<string, string>;
};
type Draft = { quantity: string; condition: string; note: string };

const CONDITIONS = [
  ['GOOD', 'Good'], ['MINOR_WEAR', 'Minor wear'], ['DAMAGED', 'Damaged'], ['ALTERED', 'Altered'], ['MISSING', 'Missing'],
] as const;
const RESOLUTIONS = [
  ['RESOLVED_NO_CHARGE', 'No charge'], ['RESOLVED_DEDUCTED', 'Deduct from deposit'], ['RESOLVED_WAIVED', 'Waived'],
] as const;
const SOURCE: Record<string, string> = {
  PRODUCT: 'product checklist', CATEGORY: 'category checklist', SHOP_DEFAULT: 'shop default checklist', NONE: 'no checklist template', LEGACY_DESK: 'created at the desk',
};
const when = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');
const condLabel = (c?: string | null) => CONDITIONS.find(([k]) => k === c)?.[1] ?? (c || '—');

export default function ChecklistPanel({ rentalId, online = true, onChanged, compact = false }: {
  rentalId: string; online?: boolean; onChanged?: () => void; compact?: boolean;
}) {
  const { toast } = useToast();
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [excForm, setExcForm] = useState<{ kind: string; items: string[]; reason: string; substituteNote: string } | null>(null);
  const [resolveForm, setResolveForm] = useState<Record<string, { resolution: string; note: string }>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      setState(await adminApi.getChecklistState(rentalId));
    } catch (e: any) {
      setError(e?.message || 'Could not load the checklist');
    } finally {
      setLoading(false);
    }
  }, [rentalId]);
  useEffect(() => { load(); }, [load]);

  const stage: 'HANDOVER' | 'RETURN' | null = state?.handover.stageOpen ? 'HANDOVER' : state?.inspection.stageOpen ? 'RETURN' : null;
  const stageItems = useMemo(() => (state?.items ?? []).filter((i) => stage === 'RETURN' || i.stage === 'BOTH'), [state, stage]);
  const current = (i: Item) => (stage === 'RETURN' ? i.return : i.handover) ?? null;
  const who = (id?: string | null) => (id ? state?.people[id] || 'staff member' : '—');

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast(ok, 'success');
      await load();
      onChanged?.();
    } catch (e: any) {
      const code = e?.serverCode || e?.data?.code;
      if (code === 'CHECKLIST_CHANGED') toast('Someone else recorded this item meanwhile. The latest record is shown — check it before correcting.', 'warning');
      else toast(e?.message || 'Action failed', 'error');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const draftFor = (i: Item): Draft => drafts[i.id] ?? {
    quantity: String(current(i)?.quantity ?? i.quantity), condition: current(i)?.condition ?? (i.requiresCondition ? '' : ''), note: '',
  };
  const setDraft = (i: Item, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [i.id]: { ...draftFor(i), ...patch } }));

  const saveItem = (i: Item) => {
    const d = draftFor(i);
    if (i.requiresCondition && !d.condition) { toast(`Choose the condition of "${i.label}"`, 'warning'); return; }
    const prev = current(i);
    run(`rec:${i.id}`, () => adminApi.recordChecklist(rentalId, {
      stage: stage!, entries: [{
        snapshotItemId: i.id, quantity: Number(d.quantity || 0), ...(d.condition ? { condition: d.condition } : {}),
        ...(d.note.trim() ? { note: d.note.trim() } : {}), ...(prev ? { supersedesId: prev.id } : {}),
      }],
    }).then(() => setDrafts((x) => { const n = { ...x }; delete n[i.id]; return n; })), prev ? `"${i.label}" corrected` : `"${i.label}" recorded`);
  };

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-brand-gold" /></div>;
  if (error || !state) {
    return (
      <div className="text-sm text-red-600 flex items-center gap-2">
        <XCircle className="w-4 h-4" /> {error}
        <button onClick={load} className="underline">Retry</button>
      </div>
    );
  }

  const s = state;
  const openExc = s.exceptions.filter((e) => e.status === 'REQUESTED' || e.status === 'APPROVED');
  const labelOf = (id: string) => s.items.find((i) => i.id === id)?.label ?? id;

  return (
    <div className="space-y-4" data-testid="checklist-panel">
      {/* Header: where the list came from + the gate's verdict */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-xs text-[hsl(var(--muted-foreground))]">
          {s.snapshot ? (
            <>Fixed {when(s.snapshot.frozenAt)} from the {SOURCE[s.snapshot.source] ?? s.snapshot.source}
              {s.snapshot.templateName ? ` "${s.snapshot.templateName}"` : ''}{s.snapshot.templateVersion ? ` v${s.snapshot.templateVersion}` : ''}
              {s.snapshot.currentTemplateVersion && s.snapshot.templateVersion && s.snapshot.currentTemplateVersion !== s.snapshot.templateVersion
                ? ` (the template is now v${s.snapshot.currentTemplateVersion}; this booking keeps its own list)` : ''}
              {s.rental.unitCode ? ` · gown ${s.rental.unitCode}` : ''}</>
          ) : 'This booking has no checklist yet.'}
        </div>
        <button onClick={load} className="text-xs flex items-center gap-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"><RefreshCw className="w-3 h-3" /> Reload</button>
      </div>

      {!s.snapshot && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm space-y-2">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="w-4 h-4 text-amber-600" /> Nothing can be handed over until this booking has its checklist.</p>
          <Button size="sm" onClick={() => run('freeze', () => adminApi.freezeChecklistAtDesk(rentalId), 'Checklist created for this booking')} disabled={!online || busy !== null}>
            {busy === 'freeze' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />} Create the checklist from today&apos;s template
          </Button>
        </div>
      )}

      {s.snapshot && s.handover.stageOpen && (
        <div data-testid="handover-verdict" className={`rounded-lg p-3 text-sm flex items-center gap-2 ${s.handover.unresolved.length ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300' : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'}`}>
          {s.handover.unresolved.length
            ? <><ShieldAlert className="w-4 h-4" /> Hand-over blocked — still to check: {s.handover.unresolved.join(', ')}</>
            : <><CheckCircle2 className="w-4 h-4" /> Checklist complete — the item may be handed over (other conditions permitting).</>}
        </div>
      )}
      {s.snapshot && s.inspection.stageOpen && (
        <div data-testid="inspection-verdict" className={`rounded-lg p-3 text-sm flex items-center gap-2 ${s.inspection.complete && !s.inspection.openDiscrepancies.length ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700' : 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'}`}>
          {!s.inspection.complete
            ? <><AlertTriangle className="w-4 h-4" /> Return inspection incomplete — not yet inspected: {s.inspection.notInspected.join(', ')}. The rental can&apos;t close and the deposit can&apos;t be settled yet.</>
            : s.inspection.openDiscrepancies.length
              ? <><AlertTriangle className="w-4 h-4" /> {s.inspection.openDiscrepancies.length} discrepancy(ies) waiting for a reviewer. The rental can&apos;t close and the deposit can&apos;t be settled yet.</>
              : <><CheckCircle2 className="w-4 h-4" /> Inspection complete, nothing open.</>}
        </div>
      )}

      {/* Items */}
      {s.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))]">
                <th className="py-2 pr-2">Item</th>
                <th className="py-2 pr-2">Handed over</th>
                <th className="py-2 pr-2">Returned</th>
                {stage && <th className="py-2">{stage === 'HANDOVER' ? 'Record hand-over' : 'Record return'}</th>}
              </tr>
            </thead>
            <tbody>
              {s.items.map((i) => {
                const editable = !!stage && stageItems.includes(i);
                const d = draftFor(i);
                const rec = (r?: Rec | null) => r
                  ? <span>{r.quantity} × {condLabel(r.condition)}<br /><span className="text-xs text-[hsl(var(--muted-foreground))]">{who(r.recordedById)} · {when(r.recordedAt)}</span>{r.note ? <><br /><em className="text-xs">{r.note}</em></> : null}</span>
                  : <span className="text-[hsl(var(--muted-foreground))]">—</span>;
                return (
                  <tr key={i.id} className="border-b border-[hsl(var(--border))] align-top" data-testid={`item-${i.label}`}>
                    <td className="py-2 pr-2">
                      <span className="font-medium">{i.label}</span>
                      {i.quantity > 1 && <span className="text-xs"> × {i.quantity}</span>}
                      {!i.isMandatory && <span className="ml-1 text-xs rounded bg-[hsl(var(--muted))] px-1">optional</span>}
                      {i.stage === 'RETURN' && <span className="ml-1 text-xs rounded bg-purple-100 dark:bg-purple-900/40 px-1">return only</span>}
                      {i.instructions && <p className="text-xs text-[hsl(var(--muted-foreground))]">{i.instructions}</p>}
                    </td>
                    <td className="py-2 pr-2" data-testid={`issued-${i.label}`}>
                      {i.stage !== 'BOTH' ? <span className="text-xs text-[hsl(var(--muted-foreground))]">n/a</span>
                        : !i.handover && i.exception?.kind === 'MISSING' ? <span className="text-xs text-amber-700">Not issued — approved exception</span>
                        : rec(i.handover)}
                      {i.exception?.kind === 'SUBSTITUTED' && <p className="text-xs text-amber-700">Substituted: {i.exception.substituteNote}</p>}
                    </td>
                    <td className="py-2 pr-2" data-testid={`returned-${i.label}`}>
                      {rec(i.return)}
                      {s.inspection.stageOpen && <p className="text-xs text-[hsl(var(--muted-foreground))]">{i.expectedReturn === 0 ? 'Nothing to return (never issued)' : `Expected back: ${i.expectedReturn}`}</p>}
                    </td>
                    {stage && (
                      <td className="py-2">
                        {editable ? (
                          <div className={`flex ${compact ? 'flex-col' : 'flex-wrap'} gap-1 items-start`}>
                            <input aria-label={`${i.label} quantity`} type="number" min={0} value={d.quantity} onChange={(e) => setDraft(i, { quantity: e.target.value })}
                              className="w-16 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1" />
                            {i.requiresCondition && (
                              <select aria-label={`${i.label} condition`} value={d.condition} onChange={(e) => setDraft(i, { condition: e.target.value })}
                                className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1">
                                <option value="">Condition…</option>
                                {CONDITIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                              </select>
                            )}
                            <input aria-label={`${i.label} note`} placeholder="Note" value={d.note} onChange={(e) => setDraft(i, { note: e.target.value })}
                              className="w-32 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1" />
                            <Button size="sm" variant={current(i) ? 'outline' : 'primary'} onClick={() => saveItem(i)} disabled={!online || busy !== null}>
                              {busy === `rec:${i.id}` && <Loader2 className="w-3 h-3 animate-spin" />}{current(i) ? 'Correct' : 'Record'}
                            </Button>
                          </div>
                        ) : <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Exceptions (hand-over only) */}
      {s.handover.stageOpen && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Exceptions</h4>
            {!excForm && (
              <button className="text-xs underline" disabled={!online} onClick={() => setExcForm({ kind: s.items.length ? 'MISSING' : 'NO_SNAPSHOT', items: [], reason: '', substituteNote: '' })}>Request an exception</button>
            )}
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">A missing or substituted item needs an exception approved by another person. Whoever approves it cannot hand the item over.</p>
          {openExc.concat(s.exceptions.filter((e) => e.status === 'USED' || e.status === 'REJECTED')).map((e) => (
            <div key={e.id} className="rounded border border-[hsl(var(--border))] p-2 text-sm flex flex-wrap items-center justify-between gap-2" data-testid={`exception-${e.status}`}>
              <div>
                <span className="font-medium">{e.kind === 'NO_SNAPSHOT' ? 'No checklist' : e.kind === 'SUBSTITUTED' ? 'Substituted' : 'Missing'}</span>
                {e.snapshotItemIds.length > 0 && `: ${e.snapshotItemIds.map(labelOf).join(', ')}`} — <em>{e.reason}</em>
                {e.substituteNote && <> · instead: {e.substituteNote}</>}
                <div className="text-xs text-[hsl(var(--muted-foreground))]">
                  {e.status} · requested by {who(e.requestedById)}{e.decidedById ? ` · decided by ${who(e.decidedById)}` : ''}{e.usedById ? ` · used by ${who(e.usedById)}` : ''}
                </div>
              </div>
              {e.status === 'REQUESTED' && (
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => run(`ex:${e.id}`, () => adminApi.approveChecklistException(e.id), 'Exception approved')} disabled={!online || busy !== null}>
                    {busy === `ex:${e.id}` && <Loader2 className="w-3 h-3 animate-spin" />}Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => run(`exr:${e.id}`, () => adminApi.rejectChecklistException(e.id), 'Exception rejected')} disabled={!online || busy !== null}>
                    {busy === `exr:${e.id}` && <Loader2 className="w-3 h-3 animate-spin" />}Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
          {excForm && (
            <div className="rounded border border-[hsl(var(--border))] p-3 space-y-2 text-sm">
              <select aria-label="Exception kind" value={excForm.kind} onChange={(e) => setExcForm({ ...excForm, kind: e.target.value })} className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1">
                <option value="MISSING">Item missing</option>
                <option value="SUBSTITUTED">Item substituted</option>
                {s.items.length === 0 && <option value="NO_SNAPSHOT">No checklist for this product</option>}
              </select>
              {excForm.kind !== 'NO_SNAPSHOT' && (
                <div className="flex flex-wrap gap-3">
                  {s.items.filter((i) => i.stage === 'BOTH' && i.isMandatory).map((i) => (
                    <label key={i.id} className="flex items-center gap-1">
                      <input type="checkbox" checked={excForm.items.includes(i.id)}
                        onChange={(ev) => setExcForm({ ...excForm, items: ev.target.checked ? [...excForm.items, i.id] : excForm.items.filter((x) => x !== i.id) })} />
                      {i.label}
                    </label>
                  ))}
                </div>
              )}
              {excForm.kind === 'SUBSTITUTED' && (
                <input aria-label="What is handed over instead" placeholder="What is handed over instead" value={excForm.substituteNote} onChange={(e) => setExcForm({ ...excForm, substituteNote: e.target.value })}
                  className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1" />
              )}
              <textarea aria-label="Reason" placeholder="Reason (at least 10 characters)" value={excForm.reason} onChange={(e) => setExcForm({ ...excForm, reason: e.target.value })}
                className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1" rows={2} />
              <div className="flex gap-2">
                <Button size="sm" disabled={!online || busy !== null || excForm.reason.trim().length < 10}
                  onClick={() => run('exreq', () => adminApi.requestChecklistException(rentalId, {
                    kind: excForm.kind, reason: excForm.reason.trim(),
                    ...(excForm.kind !== 'NO_SNAPSHOT' ? { snapshotItemIds: excForm.items } : {}),
                    ...(excForm.kind === 'SUBSTITUTED' ? { substituteNote: excForm.substituteNote.trim() } : {}),
                  }).then(() => setExcForm(null)), 'Exception requested — another person must approve it')}>
                  {busy === 'exreq' && <Loader2 className="w-3 h-3 animate-spin" />}Send for approval
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setExcForm(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Discrepancies */}
      {s.discrepancies.filter((d) => d.status !== 'SUPERSEDED').length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Discrepancies</h4>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Facts only — nothing is charged automatically. A reviewer who did not inspect the return decides each one; keeping deposit money needs “Deduct from deposit”.</p>
          {s.discrepancies.filter((d) => d.status !== 'SUPERSEDED').map((d) => {
            const f = resolveForm[d.id] ?? { resolution: '', note: '' };
            return (
              <div key={d.id} className="rounded border border-[hsl(var(--border))] p-2 text-sm space-y-1" data-testid={`discrepancy-${d.status}`}>
                <div><span className="font-medium">{labelOf(d.snapshotItemId)}</span>: {d.kind.toLowerCase()} × {d.quantity}{d.note ? ` — ${d.note}` : ''}
                  <span className="ml-2 text-xs">{d.status === 'OPEN' ? 'OPEN' : `${RESOLUTIONS.find(([k]) => k === d.status)?.[1] ?? d.status} by ${who(d.resolvedById)}${d.resolutionNote ? ` — ${d.resolutionNote}` : ''}`}</span>
                </div>
                {d.status === 'OPEN' && s.inspection.stageOpen && (
                  <div className="flex flex-wrap gap-1">
                    <select aria-label="Resolution" value={f.resolution} onChange={(e) => setResolveForm({ ...resolveForm, [d.id]: { ...f, resolution: e.target.value } })}
                      className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1">
                      <option value="">Decision…</option>
                      {RESOLUTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <input aria-label="Decision note" placeholder="Note (required)" value={f.note} onChange={(e) => setResolveForm({ ...resolveForm, [d.id]: { ...f, note: e.target.value } })}
                      className="flex-1 min-w-[10rem] rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1" />
                    <Button size="sm" disabled={!online || busy !== null || !f.resolution || f.note.trim().length < 5}
                      onClick={() => run(`d:${d.id}`, () => adminApi.resolveDiscrepancy(d.id, { resolution: f.resolution, note: f.note.trim() }), 'Discrepancy decided')}>
                      {busy === `d:${d.id}` && <Loader2 className="w-3 h-3 animate-spin" />}Decide
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
