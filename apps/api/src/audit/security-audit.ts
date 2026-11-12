import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';

/**
 * Security audit for administrator accounts (P0d, Nov 2026). No migration:
 * events go to the existing AdminActivityLog table.
 *
 * AdminActivityLog.adminUserId is a required FK to AdminUser, so each row is
 * attached to the acting admin when there is one, otherwise to the AFFECTED
 * admin; `details.actor` always says who really acted (admin / platform /
 * system / anonymous). Events with no AdminUser on either side (e.g. a
 * platform admin's own lockout) go to the application log instead.
 *
 * Never throws: an audit failure must not break sign-in or admin work.
 * Never stores secrets: password, token, secret, code and hash keys are
 * dropped from `details` before writing.
 */
export type SecurityResult = 'SUCCESS' | 'DENIED' | 'FAILED' | 'BLOCKED';

export interface SecurityActor {
  type: 'admin' | 'platform' | 'system' | 'anonymous';
  id?: string | null;
  role?: string | null;
}

export interface SecurityEvent {
  action: string;
  result: SecurityResult;
  tenantId?: string | null;
  actor: SecurityActor;
  /** The AdminUser affected, when there is one. */
  targetAdminId?: string | null;
  /** Non-AdminUser target (e.g. a PlatformAdmin or a route), for the log line. */
  targetType?: string;
  targetId?: string | null;
  ipAddress?: string | null;
  reason?: string;
  details?: Record<string, unknown>;
}

interface AuditWriter {
  adminActivityLog: { create: (args: any) => Promise<unknown> };
}

const logger = new Logger('SecurityAudit');
const SECRET_KEY = /pass(word)?|token|secret|code|hash|otp|recovery/i;

export function scrubSecrets(details: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details ?? {})) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Short, stable pseudonym for an account in log lines (never the email). */
export function accountRef(kind: string, id: string): string {
  return createHash('sha256').update(`${kind}:${id}`).digest('hex').slice(0, 10);
}

export async function recordSecurityEvent(db: AuditWriter, e: SecurityEvent): Promise<void> {
  const adminActor = e.actor.type === 'admin' && e.actor.id ? e.actor.id : null;
  const adminUserId = adminActor ?? e.targetAdminId ?? null;
  const details = {
    result: e.result,
    actor: { type: e.actor.type, id: e.actor.id ?? null, role: e.actor.role ?? null },
    target: e.targetAdminId
      ? { type: 'AdminUser', id: e.targetAdminId }
      : { type: e.targetType ?? null, id: e.targetId ?? null },
    ...(e.reason ? { reason: e.reason } : {}),
    ...scrubSecrets(e.details),
  };
  if (e.result !== 'SUCCESS') {
    logger.log(`[SECURITY_AUDIT] ${e.action} ${e.result} actor=${e.actor.type}${e.actor.id ? `:${e.actor.id}` : ''} target=${e.targetAdminId ?? e.targetId ?? '-'} ip=${e.ipAddress ?? '-'}${e.reason ? ` reason="${e.reason}"` : ''}`);
  }
  if (!adminUserId) {
    if (e.result === 'SUCCESS') {
      logger.log(`[SECURITY_AUDIT] ${e.action} ${e.result} actor=${e.actor.type}${e.actor.id ? `:${e.actor.id}` : ''} target=${e.targetType ?? '-'}:${e.targetId ?? '-'} ip=${e.ipAddress ?? '-'}`);
    }
    return;
  }
  try {
    await db.adminActivityLog.create({
      data: {
        tenantId: e.tenantId ?? null,
        adminUserId,
        action: e.action,
        entity: e.targetAdminId ? 'AdminUser' : e.targetType ?? 'AdminUser',
        entityId: e.targetAdminId ?? e.targetId ?? null,
        details,
        ipAddress: e.ipAddress ?? null,
      },
    });
  } catch (err: any) {
    logger.warn(`Failed to write security audit ${e.action}: ${err?.message}`);
  }
}

/**
 * Throttled operator warnings for account lockouts. One WARN per account per
 * 30 min; when an account is locked 3+ times within 24 h the line says
 * REPEATED_ADMIN_LOCKOUTS so a distributed attack stands out in
 * `pm2 logs naro-api`. In memory (one API process); a restart only resets
 * the throttle, never suppresses the audit rows.
 */
export const LOCKOUT_WARN_INTERVAL_MS = 30 * 60 * 1000;
export const LOCKOUT_REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const LOCKOUT_REPEAT_THRESHOLD = 3;

export class LockoutAlerts {
  private readonly events = new Map<string, number[]>();
  private readonly lastWarn = new Map<string, number>();

  constructor(private readonly warn: (line: string) => void = (l) => logger.warn(l)) {}

  /** Records a lock event; returns the line it logged, or null when throttled. */
  onLock(kind: string, id: string, info: { distinctIps?: number; tenantId?: string | null; step?: string }, now = Date.now()): string | null {
    const key = `${kind}:${id}`;
    const list = (this.events.get(key) ?? []).filter((t) => now - t < LOCKOUT_REPEAT_WINDOW_MS);
    list.push(now);
    this.events.set(key, list);
    this.prune(now);
    const last = this.lastWarn.get(key);
    if (last !== undefined && now - last < LOCKOUT_WARN_INTERVAL_MS) return null;
    this.lastWarn.set(key, now);
    const repeated = list.length >= LOCKOUT_REPEAT_THRESHOLD;
    const line =
      `[SECURITY] ${repeated ? 'REPEATED_ADMIN_LOCKOUTS' : 'ADMIN_ACCOUNT_LOCKED'} account=${accountRef(kind, id)} kind=${kind}` +
      ` step=${info.step ?? 'password'} tenant=${info.tenantId ?? '-'} distinctIps=${info.distinctIps ?? '?'} locks24h=${list.length}`;
    this.warn(line);
    return line;
  }

  private prune(now: number) {
    if (this.events.size < 5000) return;
    for (const [k, l] of this.events) {
      if (!l.some((t) => now - t < LOCKOUT_REPEAT_WINDOW_MS)) {
        this.events.delete(k);
        this.lastWarn.delete(k);
      }
    }
  }
}

export const lockoutAlerts = new LockoutAlerts();
