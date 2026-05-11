'use client';

// AI Role Assignments — Phase 3 access management surface.
//
// Lets an authorised admin assign or remove the two AI system roles
// (AI_AGENT_OPERATOR / AI_AGENT_APPROVER) on existing AdminUser
// accounts. Pure UI over the existing backend endpoints:
//   POST   /admin-users/:id/roles      { roleId }
//   DELETE /admin-users/:id/roles/:roleId
//
// No new backend behaviour. No new permissions. No schema change. No
// modification to the approval workflow or token handling. The
// four-eyes runtime check still bites even when both roles are
// assigned to the same admin (asserted by the backend's spec U18 +
// equivalents).
//
// Security model:
//   - Backend AdminUsersService.assignRole/removeRole already rejects
//     self-modification ("Cannot change your own roles") at the
//     service layer. We mirror the block in the UI by disabling the
//     toggle for the current user, with a tooltip explaining why.
//   - The endpoints are protected by JwtAuthGuard + AdminGuard only.
//     No tenant gates this page beyond the standard admin login —
//     non-SUPER_ADMINs may still see the page but the backend 403s
//     them if they attempt mutations; we surface that as a toast.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';

// ─── Constants ───────────────────────────────────────────────────

const AI_OPERATOR_NAME = 'AI_AGENT_OPERATOR';
const AI_APPROVER_NAME = 'AI_AGENT_APPROVER';

interface AdminRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string; // primary role string — SUPER_ADMIN / MANAGER / STAFF
  isActive: boolean;
  roles: Array<{ role: { id: string; name: string } }>;
}

interface RoleRow {
  id: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  isActive: boolean;
}

// ─── Page ────────────────────────────────────────────────────────

export default function AiRoleAssignmentsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-cell loading: key = `${adminId}:${roleId}:${verb}` so two
  // concurrent toggles don't share a spinner.
  const [actionKey, setActionKey] = useState<string | null>(null);

  // ─── Fetch ────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [adminsRes, rolesRes] = await Promise.all([
        adminApi.getAdminUsers() as Promise<AdminRow[]>,
        adminApi.getRoles() as Promise<RoleRow[]>,
      ]);
      setAdmins(Array.isArray(adminsRes) ? adminsRes : []);
      setRoles(Array.isArray(rolesRes) ? rolesRes : []);
    } catch (err: any) {
      toast.error(
        err?.message ||
          'Could not load admin users / roles. You may not have permission to manage roles.',
      );
      setAdmins([]);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ─── Role lookups ─────────────────────────────────────────────
  const operatorRole = useMemo(
    () => roles.find((r) => r.name === AI_OPERATOR_NAME) ?? null,
    [roles],
  );
  const approverRole = useMemo(
    () => roles.find((r) => r.name === AI_APPROVER_NAME) ?? null,
    [roles],
  );

  const hasRole = (admin: AdminRow, roleName: string): boolean =>
    admin.roles?.some((r) => r.role?.name === roleName) ?? false;

  // ─── Counts (header stats) ────────────────────────────────────
  const stats = useMemo(() => {
    const operators = admins.filter((a) => hasRole(a, AI_OPERATOR_NAME));
    const approvers = admins.filter((a) => hasRole(a, AI_APPROVER_NAME));
    const both = admins.filter(
      (a) => hasRole(a, AI_OPERATOR_NAME) && hasRole(a, AI_APPROVER_NAME),
    );
    return { operators: operators.length, approvers: approvers.length, both: both.length };
  }, [admins]);

  // ─── Mutation ────────────────────────────────────────────────
  const toggleRole = async (
    admin: AdminRow,
    role: RoleRow,
    nextAssigned: boolean,
  ) => {
    if (admin.id === user?.id) {
      toast.warning(
        'You cannot change your own role assignments. Ask another admin to do it.',
      );
      return;
    }

    const verb = nextAssigned ? 'assign' : 'remove';
    const isApprover = role.name === AI_APPROVER_NAME;

    // Extra friction for assigning the approver role — that's the
    // permission that opens up risky-action approval.
    const confirmMessage = nextAssigned
      ? (isApprover
          ? `Grant ${admin.firstName} ${admin.lastName} the AI_AGENT_APPROVER role? This user will be able to APPROVE risky AI actions (publish/archive/restore/update_draft) opened by other operators. The four-eyes rule still prevents self-approval.`
          : `Grant ${admin.firstName} ${admin.lastName} the AI_AGENT_OPERATOR role? This user will be able to initiate AI approval requests for risky writes. They cannot approve their own requests.`)
      : `Remove the ${role.name} role from ${admin.firstName} ${admin.lastName}?`;

    const ok = await confirm({
      title: nextAssigned ? `Assign ${role.name}?` : `Remove ${role.name}?`,
      message: confirmMessage,
      confirmLabel: nextAssigned ? 'Assign' : 'Remove',
      variant: isApprover && nextAssigned ? 'danger' : 'default',
    });
    if (!ok) return;

    const key = `${admin.id}:${role.id}:${verb}`;
    setActionKey(key);
    try {
      if (nextAssigned) {
        await adminApi.assignAdminUserRole(admin.id, role.id);
        toast.success(
          `Granted ${role.name} to ${admin.firstName} ${admin.lastName}.`,
        );
      } else {
        await adminApi.removeAdminUserRole(admin.id, role.id);
        toast.success(
          `Removed ${role.name} from ${admin.firstName} ${admin.lastName}.`,
        );
      }
      await reload();
    } catch (err: any) {
      // The backend throws ForbiddenException ("Cannot change your own
      // roles") at the service layer; other 403s from AdminGuard or
      // tenant context surface as 'Forbidden'.
      toast.error(
        err?.message?.includes('Cannot change your own')
          ? 'You cannot change your own role assignments.'
          : err?.message?.includes('Forbidden') ||
              err?.message?.includes('403')
            ? "You don't have permission to manage role assignments."
            : err?.message || 'Failed to update role assignment.',
      );
    } finally {
      setActionKey(null);
    }
  };

  // ─── Render ───────────────────────────────────────────────────

  // Role definitions missing (server didn't seed them somehow) — show
  // a clear error rather than a half-broken page.
  const rolesMissing = !loading && (!operatorRole || !approverRole);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Role Assignments"
        subtitle="Assign the AI_AGENT_OPERATOR and AI_AGENT_APPROVER system roles to admin accounts. The two roles enforce four-eyes separation on risky AI actions."
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'AI Agent' },
          { label: 'Role Assignments' },
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

      {/* Role explainer cards */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-[hsl(var(--border))] rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-brand-gold/15 text-brand-gold flex-shrink-0">
              <UserCog className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">AI_AGENT_OPERATOR</h3>
                <Badge variant="gold">{stats.operators} assigned</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                The day-to-day AI agent user. Can search the AI surface,
                create draft products, edit drafts, and OPEN approval
                requests for publish / archive / restore / update_draft.
                Cannot approve risky actions — even their own requests.
              </p>
              <div className="text-xs text-muted-foreground mt-2">
                Permissions: <code>ai-agent:use</code>,{' '}
                <code>ai-agent:read</code>, <code>ai-agent:write-drafts</code>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card border border-[hsl(var(--border))] rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex-shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">AI_AGENT_APPROVER</h3>
                <Badge variant="error">{stats.approvers} assigned</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                The reviewer for risky AI actions. Can approve, reject,
                or revoke approval requests opened by operators. Cannot
                initiate draft writes. The same admin cannot approve
                their own request — the four-eyes runtime check fires
                regardless of role configuration.
              </p>
              <div className="text-xs text-muted-foreground mt-2">
                Permissions: <code>ai-agent:use</code>,{' '}
                <code>ai-agent:read</code>, <code>ai-agent:approve</code>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Both-roles warning */}
      {stats.both > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 dark:text-amber-200">
            <strong>
              {stats.both} admin{stats.both === 1 ? ' has' : 's have'} both
              AI roles assigned.
            </strong>{' '}
            The four-eyes runtime check still prevents self-approval, but
            the role-level policy separation is weaker. Prefer dedicated
            operator and approver accounts where possible.
          </div>
        </div>
      )}

      {/* Roles missing (shouldn't happen in production — they're seeded
          on every boot — but communicate clearly if it does). */}
      {rolesMissing && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-900 dark:text-red-200">
            <strong>AI system roles not found.</strong>{' '}
            <code>AI_AGENT_OPERATOR</code> / <code>AI_AGENT_APPROVER</code>{' '}
            should be seeded on every API boot. Restart the API or check
            the seeder log.
          </div>
        </div>
      )}

      {/* Admin user table */}
      {loading ? (
        <SkeletonTable rows={5} cols={5} />
      ) : admins.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No admin users found"
          description="No admin accounts to assign AI roles to. Add an admin first via User Management → Admin Users."
        />
      ) : (
        <div className="overflow-x-auto bg-card border border-[hsl(var(--border))] rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Admin user</th>
                <th className="text-left px-4 py-2 font-medium">Primary role</th>
                <th className="text-center px-4 py-2 font-medium">
                  AI_AGENT_OPERATOR
                </th>
                <th className="text-center px-4 py-2 font-medium">
                  AI_AGENT_APPROVER
                </th>
                <th className="text-left px-4 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => {
                const isSelf = admin.id === user?.id;
                const hasOp = hasRole(admin, AI_OPERATOR_NAME);
                const hasAp = hasRole(admin, AI_APPROVER_NAME);
                const both = hasOp && hasAp;
                return (
                  <tr
                    key={admin.id}
                    className="border-t border-[hsl(var(--border))]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">
                        {admin.firstName} {admin.lastName}
                        {isSelf && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {admin.email}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          admin.role === 'SUPER_ADMIN' ? 'gold' : 'neutral'
                        }
                      >
                        {admin.role}
                      </Badge>
                      {!admin.isActive && (
                        <Badge variant="neutral" className="ml-1">
                          inactive
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {operatorRole && (
                        <RoleToggle
                          admin={admin}
                          role={operatorRole}
                          assigned={hasOp}
                          loading={
                            actionKey?.startsWith(
                              `${admin.id}:${operatorRole.id}:`,
                            ) ?? false
                          }
                          disabled={isSelf || !admin.isActive}
                          onToggle={(next) =>
                            toggleRole(admin, operatorRole, next)
                          }
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {approverRole && (
                        <RoleToggle
                          admin={admin}
                          role={approverRole}
                          assigned={hasAp}
                          loading={
                            actionKey?.startsWith(
                              `${admin.id}:${approverRole.id}:`,
                            ) ?? false
                          }
                          disabled={isSelf || !admin.isActive}
                          onToggle={(next) =>
                            toggleRole(admin, approverRole, next)
                          }
                          variant="approver"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {isSelf && (
                        <span className="block">
                          Self-modification blocked
                        </span>
                      )}
                      {both && (
                        <span className="block text-amber-700 dark:text-amber-400">
                          ⚠ Both AI roles assigned — see banner above
                        </span>
                      )}
                      {!admin.isActive && (
                        <span className="block">Account inactive</span>
                      )}
                      {admin.role === 'SUPER_ADMIN' &&
                        !hasOp &&
                        !hasAp && (
                          <span className="block">
                            <Sparkles className="inline h-3 w-3 mr-0.5" />
                            Has implicit AI perms via SUPER_ADMIN
                            backfill (Phase 3.2 removes this)
                          </span>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer hint */}
      <div className="text-xs text-muted-foreground">
        Role assignments take effect on the user's next API request. The
        backend's four-eyes runtime check still prevents an admin from
        approving their own AI requests, regardless of role configuration.
      </div>
    </div>
  );
}

// ─── Toggle component ───────────────────────────────────────────────

interface RoleToggleProps {
  admin: AdminRow;
  role: RoleRow;
  assigned: boolean;
  loading: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  variant?: 'operator' | 'approver';
}

function RoleToggle({
  assigned,
  loading,
  disabled,
  onToggle,
  variant = 'operator',
}: RoleToggleProps) {
  if (loading) {
    return (
      <div className="inline-flex items-center justify-center w-9 h-9">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <button
      onClick={() => onToggle(!assigned)}
      disabled={disabled}
      title={disabled ? 'Cannot change' : assigned ? 'Click to remove' : 'Click to assign'}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        assigned
          ? variant === 'approver'
            ? 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50'
            : 'bg-brand-gold/15 border-brand-gold/40 text-brand-gold hover:bg-brand-gold/25'
          : 'bg-card border-[hsl(var(--border))] text-muted-foreground hover:bg-muted'
      }`}
    >
      {assigned ? (
        <UserCheck className="h-4 w-4" />
      ) : (
        <UserCog className="h-4 w-4" />
      )}
    </button>
  );
}
