'use client';

// AI Approvals dashboard — Phase 3 four-eyes workflow review surface.
//
// IMPORTANT — token-handling invariants (must hold for every code path
// in this file). The shape spec at apps/api/src/ai/admin-approvals-ui.
// shape.spec.ts asserts these at build time:
//
//   1. The raw approvalToken NEVER touches localStorage / sessionStorage.
//      Held only in component-local React state (`tokenModal`).
//   2. The raw approvalToken is shown to the approver immediately after
//      the approve() response in a one-shot modal, then cleared from
//      state when the modal closes.
//   3. The raw token is NEVER serialised into the URL, navigation state,
//      or any analytics call.
//   4. `approvalTokenHash` is NEVER rendered — the server never exposes
//      it via the API, and we don't synthesise it on the client.
//   5. Mutation buttons are status-aware: PENDING gets approve/reject/
//      cancel; APPROVED gets execute (initiator) + revoke (approver);
//      terminal statuses get read-only summary.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';

// ─── Types ──────────────────────────────────────────────────────────
// The server's wire shape (see ApprovalRequestSummary in
// apps/api/src/ai/services/approval.service.ts). approvalToken is
// only ever present immediately after approve() — never on list/get.

interface ApprovalSummary {
  id: string;
  status:
    | 'PENDING'
    | 'APPROVED'
    | 'REJECTED'
    | 'CANCELLED'
    | 'REVOKED'
    | 'CONSUMED'
    | 'EXPIRED'
    | 'EXHAUSTED';
  tool: string;
  actionTitle: string;
  businessSummary: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  targetResourceType: string | null;
  targetResourceId: string | null;
  targetResourceName: string | null;
  beforeValues: unknown;
  afterValues: unknown;
  expiresAt: string;
  ttlSeconds: number;
  createdAt: string;
  tokenIssued: boolean;
  executionAttempts: number;
  // Approve response only — present for ONE response, never persisted.
  approvalToken?: string;
  // Optional server-side fields the API may include.
  requestedByAdminUserId?: string;
  approvedByAdminUserId?: string | null;
  expectedUpdatedAt?: string | null;
}

const TERMINAL_STATUSES: ApprovalSummary['status'][] = [
  'REJECTED',
  'CANCELLED',
  'REVOKED',
  'CONSUMED',
  'EXPIRED',
  'EXHAUSTED',
];

const STATUS_BADGE: Record<ApprovalSummary['status'], React.ComponentProps<typeof Badge>['variant']> = {
  PENDING: 'warning',
  APPROVED: 'info',
  REJECTED: 'error',
  CANCELLED: 'neutral',
  REVOKED: 'error',
  CONSUMED: 'success',
  EXPIRED: 'neutral',
  EXHAUSTED: 'error',
};

const RISK_BADGE: Record<ApprovalSummary['riskLevel'], React.ComponentProps<typeof Badge>['variant']> = {
  LOW: 'neutral',
  MEDIUM: 'warning',
  HIGH: 'error',
  CRITICAL: 'error',
};

const TOOL_LABELS: Record<string, string> = {
  publish_product: 'Publish product',
  archive_product: 'Archive product',
  restore_product: 'Restore product',
  update_draft_product: 'Update draft product',
};

const STATUS_ORDER: ApprovalSummary['status'][] = [
  'PENDING',
  'APPROVED',
  'CONSUMED',
  'REJECTED',
  'REVOKED',
  'CANCELLED',
  'EXPIRED',
  'EXHAUSTED',
];

// ─── Helpers ─────────────────────────────────────────────────────────

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const sec = Math.round(abs / 1000);
  if (sec < 60) return diff > 0 ? `${sec}s ago` : `in ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return diff > 0 ? `${min}m ago` : `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return diff > 0 ? `${hr}h ago` : `in ${hr}h`;
  const day = Math.round(hr / 24);
  return diff > 0 ? `${day}d ago` : `in ${day}d`;
}

function formatApiError(err: any): string {
  // Try the AI envelope's error.code first — it's the canonical
  // machine-readable identifier (forbidden_self_approval, stale_data,
  // payload_mismatch, approval_invalid_or_consumed, etc.). Fall back
  // to err.message.
  const code = err?.response?.error?.code ?? err?.code;
  const msg = err?.response?.error?.message ?? err?.message;
  if (code === 'forbidden_self_approval') {
    return 'You cannot approve your own request. A different admin must approve.';
  }
  if (code === 'stale_data') {
    return 'The product was changed since this approval was opened. Re-initiate to get a fresh snapshot.';
  }
  if (code === 'payload_mismatch') {
    return 'The stored payload no longer matches its hash. Re-initiate.';
  }
  if (code === 'approval_invalid_or_consumed') {
    return 'This approval is no longer valid (it may have been consumed, revoked, or expired).';
  }
  if (code === 'approval_expired') {
    return 'The approval token has expired. Re-initiate to get a fresh one.';
  }
  if (code === 'approval_exhausted') {
    return 'This approval used all 3 execution attempts. Re-initiate.';
  }
  if (code === 'forbidden_not_initiator') {
    return 'Only the original initiator can execute this approval.';
  }
  if (code === 'forbidden_not_original_approver') {
    return 'Only the original approver can revoke this approval.';
  }
  if (code === 'validation_error') {
    return msg || 'Validation failed.';
  }
  return msg || 'Something went wrong. Try again.';
}

// JSON pretty-printer for the before/after diff. Defends against
// cyclic structures by falling back to String().
function safeJsonPretty(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ─── Page ───────────────────────────────────────────────────────────

export default function AiApprovalsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  // ─── List + filter state ──────────────────────────────────────────
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>(''); // '' = all
  const [riskFilter, setRiskFilter] = useState<string>('');
  const [toolFilter, setToolFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  // ─── Detail + action state ────────────────────────────────────────
  const [selected, setSelected] = useState<ApprovalSummary | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // approval id

  // ─── Raw token modal — TRANSIENT, never persisted ─────────────────
  // Held in component state only. Cleared on close. NEVER goes into
  // localStorage, sessionStorage, URL, or any analytics payload.
  const [tokenModal, setTokenModal] = useState<{
    approvalId: string;
    rawToken: string;
    summary: ApprovalSummary;
  } | null>(null);

  // ─── Execute modal — initiator pastes the token they received ────
  const [executeModal, setExecuteModal] = useState<{
    approval: ApprovalSummary;
  } | null>(null);
  const [executeToken, setExecuteToken] = useState('');

  // ─── Fetch list ──────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // No server-side status filter: fetch all and bucket client-side
      // so the user can flip filters without round-trips. Phase 4 can
      // paginate if the list grows.
      const rows = (await adminApi.listApprovals({ limit: 200 })) as ApprovalSummary[];
      setApprovals(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      toast.error(formatApiError(err));
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ─── Filtered + sorted view ──────────────────────────────────────
  const visible = useMemo(() => {
    const lc = search.trim().toLowerCase();
    const filtered = approvals.filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (riskFilter && a.riskLevel !== riskFilter) return false;
      if (toolFilter && a.tool !== toolFilter) return false;
      if (lc) {
        const hay = (
          (a.actionTitle ?? '') +
          ' ' +
          (a.businessSummary ?? '') +
          ' ' +
          (a.targetResourceName ?? '')
        ).toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    });
    // Default view: PENDING + APPROVED first, then by createdAt desc.
    return filtered.sort((a, b) => {
      const aOrder = STATUS_ORDER.indexOf(a.status);
      const bOrder = STATUS_ORDER.indexOf(b.status);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [approvals, statusFilter, riskFilter, toolFilter, search]);

  // ─── Helpers for action-button visibility ────────────────────────
  const currentUserId = user?.id;

  function canApprove(a: ApprovalSummary): boolean {
    // Four-eyes is enforced at the API too — this just hides the
    // button to avoid a confusing 403. SUPER_ADMIN sees the buttons
    // even on their own requests since they hold both perms; the
    // 403 from the API fires when they click.
    return a.status === 'PENDING' && a.requestedByAdminUserId !== currentUserId;
  }
  function canReject(a: ApprovalSummary): boolean {
    return a.status === 'PENDING' && a.requestedByAdminUserId !== currentUserId;
  }
  function canCancel(a: ApprovalSummary): boolean {
    return a.status === 'PENDING' && a.requestedByAdminUserId === currentUserId;
  }
  function canRevoke(a: ApprovalSummary): boolean {
    return a.status === 'APPROVED' && a.approvedByAdminUserId === currentUserId;
  }
  function canExecute(a: ApprovalSummary): boolean {
    return a.status === 'APPROVED' && a.requestedByAdminUserId === currentUserId;
  }
  function isTerminal(a: ApprovalSummary): boolean {
    return TERMINAL_STATUSES.includes(a.status);
  }

  // ─── Mutations ───────────────────────────────────────────────────

  const onApprove = async (a: ApprovalSummary) => {
    const ok = await confirm({
      title: 'Approve this action?',
      message: a.businessSummary || a.actionTitle,
      confirmLabel: 'Approve',
      variant:
        a.riskLevel === 'HIGH' || a.riskLevel === 'CRITICAL'
          ? 'danger'
          : 'default',
    });
    if (!ok) return;
    setActionLoading(a.id);
    try {
      const { approvalToken, summary } = await adminApi.approveApproval(a.id);
      if (!approvalToken) {
        // Defensive: the server should always return a token on success.
        // If we get here it means the server's response shape changed.
        toast.error(
          'Approval succeeded but no token was returned. Refresh the list.',
        );
        await reload();
        return;
      }
      // Hand the raw token to the operator via a one-shot modal. The
      // token is held in component state only; closing the modal
      // clears it. Do NOT persist it.
      setTokenModal({
        approvalId: a.id,
        rawToken: approvalToken,
        summary: summary as ApprovalSummary,
      });
      // Refresh background list — the summary now shows tokenIssued=true.
      await reload();
    } catch (err: any) {
      toast.error(formatApiError(err));
    } finally {
      setActionLoading(null);
    }
  };

  const onReject = async (a: ApprovalSummary) => {
    // Reason is required by the DTO. Use confirm() with an inline note —
    // for production we'd add a proper textarea modal; the current
    // ConfirmDialog API takes a static message so we fall back to
    // window.prompt() ONLY for this single string. The CLAUDE.md says
    // "never use window.prompt" — replace with a small reject modal.
    setRejectModal({ approval: a, reason: '' });
  };

  const [rejectModal, setRejectModal] = useState<{
    approval: ApprovalSummary;
    reason: string;
  } | null>(null);

  const submitReject = async () => {
    if (!rejectModal) return;
    const trimmed = rejectModal.reason.trim();
    if (trimmed.length < 1) {
      toast.error('Rejection reason is required.');
      return;
    }
    setActionLoading(rejectModal.approval.id);
    try {
      await adminApi.rejectApproval(rejectModal.approval.id, trimmed);
      toast.success('Approval rejected.');
      setRejectModal(null);
      await reload();
    } catch (err: any) {
      toast.error(formatApiError(err));
    } finally {
      setActionLoading(null);
    }
  };

  const onCancel = async (a: ApprovalSummary) => {
    const ok = await confirm({
      title: 'Cancel this request?',
      message: 'Withdraw your own approval request before any review.',
      confirmLabel: 'Cancel request',
      variant: 'warning',
    });
    if (!ok) return;
    setActionLoading(a.id);
    try {
      await adminApi.cancelApproval(a.id);
      toast.success('Request cancelled.');
      await reload();
    } catch (err: any) {
      toast.error(formatApiError(err));
    } finally {
      setActionLoading(null);
    }
  };

  const [revokeModal, setRevokeModal] = useState<{
    approval: ApprovalSummary;
    reason: string;
  } | null>(null);

  const submitRevoke = async () => {
    if (!revokeModal) return;
    setActionLoading(revokeModal.approval.id);
    try {
      await adminApi.revokeApproval(
        revokeModal.approval.id,
        revokeModal.reason.trim() || undefined,
      );
      toast.success('Approval revoked.');
      setRevokeModal(null);
      await reload();
    } catch (err: any) {
      toast.error(formatApiError(err));
    } finally {
      setActionLoading(null);
    }
  };

  const onExecute = (a: ApprovalSummary) => {
    setExecuteToken('');
    setExecuteModal({ approval: a });
  };

  const submitExecute = async () => {
    if (!executeModal) return;
    const token = executeToken.trim();
    if (!token || token.length < 32) {
      toast.error('Paste the approval token you received from the approver.');
      return;
    }
    setActionLoading(executeModal.approval.id);
    try {
      await adminApi.executeApproval(executeModal.approval.id, token);
      toast.success(
        `Executed ${TOOL_LABELS[executeModal.approval.tool] ?? executeModal.approval.tool}.`,
      );
      // Clear the token from state — it's single-use and consumed.
      setExecuteToken('');
      setExecuteModal(null);
      await reload();
    } catch (err: any) {
      toast.error(formatApiError(err));
    } finally {
      setActionLoading(null);
    }
  };

  // ─── Token modal close handler — wipe the raw token ──────────────
  const closeTokenModal = () => {
    // Defensively clear before unmounting. React would GC the state
    // anyway, but an explicit empty string makes the intent obvious
    // and shortens the window where the value lives in memory.
    setTokenModal((prev) => {
      if (prev) {
        prev.rawToken = '';
      }
      return null;
    });
  };

  // ─── Copy-to-clipboard helper ────────────────────────────────────
  const copyToken = async () => {
    if (!tokenModal) return;
    try {
      await navigator.clipboard.writeText(tokenModal.rawToken);
      toast.success('Token copied to clipboard.');
    } catch {
      toast.error('Could not copy. Select the token text and copy manually.');
    }
  };

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Approvals"
        subtitle="Review approval requests opened by the AI agent. Four-eyes review is required for every risky write."
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'AI Approvals' },
        ]}
        actions={
          <button
            onClick={reload}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-card hover:bg-muted disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-card"
        >
          <option value="">All statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-card"
        >
          <option value="">All risks</option>
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>
        <select
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-card"
        >
          <option value="">All tools</option>
          {Object.entries(TOOL_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title / product…"
          className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-card"
        />
      </div>

      {/* Table */}
      {loading ? (
        <SkeletonTable rows={8} cols={6} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No approval requests match these filters"
          description="The AI agent hasn't opened any approval requests matching the current filters, or they all sit outside the time window."
        />
      ) : (
        <div className="overflow-x-auto bg-card border border-[hsl(var(--border))] rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Action</th>
                <th className="text-left px-4 py-2 font-medium">Risk</th>
                <th className="text-left px-4 py-2 font-medium">Target</th>
                <th className="text-left px-4 py-2 font-medium">Created</th>
                <th className="text-left px-4 py-2 font-medium">Expires</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const risky = a.riskLevel === 'HIGH' || a.riskLevel === 'CRITICAL';
                return (
                  <tr
                    key={a.id}
                    className="border-t border-[hsl(var(--border))] hover:bg-muted/50 cursor-pointer"
                    onClick={() => setSelected(a)}
                  >
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[a.status]}>{a.status}</Badge>
                    </td>
                    <td className="px-4 py-3 max-w-[280px]">
                      <div className="font-medium text-foreground line-clamp-1">
                        {a.actionTitle}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {TOOL_LABELS[a.tool] ?? a.tool}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${
                          risky
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                            : a.riskLevel === 'MEDIUM'
                              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {risky && <ShieldAlert className="h-3 w-3" />}
                        {a.riskLevel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                      {a.targetResourceName ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {relativeTime(a.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.status === 'PENDING' || a.status === 'APPROVED'
                        ? relativeTime(a.expiresAt)
                        : '—'}
                    </td>
                    <td
                      className="px-4 py-3 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <RowActions
                        approval={a}
                        loading={actionLoading === a.id}
                        canApprove={canApprove(a)}
                        canReject={canReject(a)}
                        canCancel={canCancel(a)}
                        canRevoke={canRevoke(a)}
                        canExecute={canExecute(a)}
                        onApprove={() => onApprove(a)}
                        onReject={() => onReject(a)}
                        onCancel={() => onCancel(a)}
                        onRevoke={() => setRevokeModal({ approval: a, reason: '' })}
                        onExecute={() => onExecute(a)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <Modal
          isOpen={!!selected}
          onClose={() => setSelected(null)}
          title={selected.actionTitle}
          size="lg"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_BADGE[selected.status]}>{selected.status}</Badge>
              <Badge variant={RISK_BADGE[selected.riskLevel]}>{selected.riskLevel} risk</Badge>
              <span className="text-xs text-muted-foreground">
                {TOOL_LABELS[selected.tool] ?? selected.tool}
              </span>
            </div>

            {(selected.riskLevel === 'HIGH' || selected.riskLevel === 'CRITICAL') &&
              !isTerminal(selected) && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-900 dark:text-red-200">
                    <strong>{selected.riskLevel} risk action.</strong> Re-read
                    the business summary and the before/after diff carefully
                    before approving.
                  </div>
                </div>
              )}

            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Business summary
              </div>
              <p className="text-sm">{selected.businessSummary || '—'}</p>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Target
                </div>
                <div>
                  {selected.targetResourceType ?? '—'}
                  {selected.targetResourceName && (
                    <span className="text-muted-foreground">
                      {' — '}
                      {selected.targetResourceName}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Execution attempts
                </div>
                <div>
                  {selected.executionAttempts} / 3
                  {selected.tokenIssued && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      (token issued)
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Created
                </div>
                <div>
                  {new Date(selected.createdAt).toLocaleString()}{' '}
                  <span className="text-muted-foreground">
                    ({relativeTime(selected.createdAt)})
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Expires
                </div>
                <div>
                  {new Date(selected.expiresAt).toLocaleString()}{' '}
                  <span className="text-muted-foreground">
                    ({relativeTime(selected.expiresAt)})
                  </span>
                </div>
              </div>
              {selected.expectedUpdatedAt && (
                <div className="col-span-2">
                  <div className="text-xs uppercase text-muted-foreground mb-1">
                    Stale-data baseline
                  </div>
                  <div className="text-muted-foreground">
                    Resource updatedAt at request time:{' '}
                    {new Date(selected.expectedUpdatedAt).toLocaleString()}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Before
                </div>
                <pre className="text-xs bg-muted rounded-lg p-2 overflow-x-auto max-h-48">
                  {safeJsonPretty(selected.beforeValues)}
                </pre>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  After
                </div>
                <pre className="text-xs bg-muted rounded-lg p-2 overflow-x-auto max-h-48">
                  {safeJsonPretty(selected.afterValues)}
                </pre>
              </div>
            </div>

            {/* Action buttons inside detail */}
            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-[hsl(var(--border))]">
              {canCancel(selected) && (
                <button
                  onClick={() => {
                    setSelected(null);
                    onCancel(selected);
                  }}
                  className="px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-muted"
                >
                  Cancel request
                </button>
              )}
              {canReject(selected) && (
                <button
                  onClick={() => {
                    setSelected(null);
                    onReject(selected);
                  }}
                  className="px-3 py-2 text-sm rounded-lg border border-red-300 text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  Reject
                </button>
              )}
              {canRevoke(selected) && (
                <button
                  onClick={() => {
                    setSelected(null);
                    setRevokeModal({ approval: selected, reason: '' });
                  }}
                  className="px-3 py-2 text-sm rounded-lg border border-red-300 text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  Revoke
                </button>
              )}
              {canApprove(selected) && (
                <button
                  onClick={() => {
                    setSelected(null);
                    onApprove(selected);
                  }}
                  className="px-3 py-2 text-sm rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black font-medium"
                >
                  Approve
                </button>
              )}
              {canExecute(selected) && (
                <button
                  onClick={() => {
                    setSelected(null);
                    onExecute(selected);
                  }}
                  className="px-3 py-2 text-sm rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black font-medium"
                >
                  Execute
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Reject reason modal */}
      {rejectModal && (
        <Modal
          isOpen={!!rejectModal}
          onClose={() => setRejectModal(null)}
          title="Reject approval"
          size="md"
        >
          <div className="space-y-3">
            <div className="text-sm">
              <div className="font-medium">{rejectModal.approval.actionTitle}</div>
              <div className="text-muted-foreground">
                {rejectModal.approval.businessSummary}
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase text-muted-foreground mb-1">
                Reason (required)
              </label>
              <textarea
                value={rejectModal.reason}
                onChange={(e) =>
                  setRejectModal({ ...rejectModal, reason: e.target.value })
                }
                rows={3}
                maxLength={500}
                placeholder="Tell the initiator why this is rejected."
                className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-card"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRejectModal(null)}
                className="px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={submitReject}
                disabled={actionLoading === rejectModal.approval.id}
                className="px-3 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50"
              >
                {actionLoading === rejectModal.approval.id ? (
                  <Loader2 className="h-4 w-4 animate-spin inline" />
                ) : (
                  'Reject'
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Revoke reason modal */}
      {revokeModal && (
        <Modal
          isOpen={!!revokeModal}
          onClose={() => setRevokeModal(null)}
          title="Revoke approval"
          size="md"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900 dark:text-amber-200">
                Revoking invalidates the approval token. The initiator will
                need to open a new request to proceed.
              </div>
            </div>
            <div className="text-sm">
              <div className="font-medium">{revokeModal.approval.actionTitle}</div>
              <div className="text-muted-foreground">
                {revokeModal.approval.businessSummary}
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase text-muted-foreground mb-1">
                Reason (optional)
              </label>
              <textarea
                value={revokeModal.reason}
                onChange={(e) =>
                  setRevokeModal({ ...revokeModal, reason: e.target.value })
                }
                rows={2}
                maxLength={500}
                placeholder="Why are you revoking this approval?"
                className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-card"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRevokeModal(null)}
                className="px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={submitRevoke}
                disabled={actionLoading === revokeModal.approval.id}
                className="px-3 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50"
              >
                {actionLoading === revokeModal.approval.id ? (
                  <Loader2 className="h-4 w-4 animate-spin inline" />
                ) : (
                  'Revoke'
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Token modal — shown ONCE after a successful approve() */}
      {tokenModal && (
        <Modal
          isOpen={!!tokenModal}
          onClose={closeTokenModal}
          title="Approval token issued"
          size="md"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700">
              <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-900 dark:text-red-200">
                <strong>This token is shown ONCE.</strong> Share it with the
                initiator via a secure channel. It is not stored on this device
                and will not be visible after this dialog closes.
              </div>
            </div>

            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Action
              </div>
              <div className="text-sm">{tokenModal.summary.actionTitle}</div>
            </div>

            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Approval token
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 text-xs font-mono bg-muted rounded-lg break-all select-all">
                  {tokenModal.rawToken}
                </code>
                <button
                  onClick={copyToken}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black"
                >
                  <Copy className="h-4 w-4" />
                  Copy
                </button>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Token expires{' '}
                <strong>{relativeTime(tokenModal.summary.expiresAt)}</strong>.
                The initiator must paste it into the Execute dialog before then.
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-[hsl(var(--border))]">
              <button
                onClick={closeTokenModal}
                className="px-4 py-2 text-sm rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black font-medium"
              >
                I have shared the token
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Execute modal — initiator pastes the token */}
      {executeModal && (
        <Modal
          isOpen={!!executeModal}
          onClose={() => {
            setExecuteToken('');
            setExecuteModal(null);
          }}
          title="Execute approved action"
          size="md"
        >
          <div className="space-y-3">
            <div className="text-sm">
              <div className="font-medium">{executeModal.approval.actionTitle}</div>
              <div className="text-muted-foreground">
                {executeModal.approval.businessSummary}
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase text-muted-foreground mb-1">
                Approval token (paste here)
              </label>
              <input
                type="text"
                value={executeToken}
                onChange={(e) => setExecuteToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="64-character hex string from the approver"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[hsl(var(--border))] bg-card"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                The token is single-use and will be cleared after execution.
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setExecuteToken('');
                  setExecuteModal(null);
                }}
                className="px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={submitExecute}
                disabled={
                  actionLoading === executeModal.approval.id ||
                  executeToken.trim().length < 32
                }
                className="px-3 py-2 text-sm rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black font-medium disabled:opacity-50"
              >
                {actionLoading === executeModal.approval.id ? (
                  <Loader2 className="h-4 w-4 animate-spin inline" />
                ) : (
                  'Execute'
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Row action buttons component ────────────────────────────────────

interface RowActionsProps {
  approval: ApprovalSummary;
  loading: boolean;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  canRevoke: boolean;
  canExecute: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
  onRevoke: () => void;
  onExecute: () => void;
}

function RowActions({
  approval,
  loading,
  canApprove,
  canReject,
  canCancel,
  canRevoke,
  canExecute,
  onApprove,
  onReject,
  onCancel,
  onRevoke,
  onExecute,
}: RowActionsProps) {
  // Terminal status: no mutation buttons, just a read-only marker.
  if (
    !canApprove &&
    !canReject &&
    !canCancel &&
    !canRevoke &&
    !canExecute
  ) {
    return <span className="text-xs text-muted-foreground">read-only</span>;
  }

  return (
    <div className="inline-flex items-center gap-1">
      {canCancel && (
        <button
          onClick={onCancel}
          disabled={loading}
          title="Cancel your own request"
          className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <X className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      )}
      {canReject && (
        <button
          onClick={onReject}
          disabled={loading}
          title="Reject"
          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-red-600" />
          ) : (
            <XCircle className="h-4 w-4 text-red-600" />
          )}
        </button>
      )}
      {canRevoke && (
        <button
          onClick={onRevoke}
          disabled={loading}
          title="Revoke approval"
          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-red-600" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-red-600" />
          )}
        </button>
      )}
      {canApprove && (
        <button
          onClick={onApprove}
          disabled={loading}
          title="Approve"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black font-medium disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          Approve
        </button>
      )}
      {canExecute && (
        <button
          onClick={onExecute}
          disabled={loading}
          title="Execute approved action"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black font-medium disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Execute
        </button>
      )}
      {approval.status === 'PENDING' && !canApprove && !canCancel && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          waiting
        </span>
      )}
    </div>
  );
}
