import * as path from 'path';
import { ForbiddenException, InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentRequestIsPlatformAdmin, currentRequestTenantId } from '../tenant/request-context';
import { isTenantScopedModel } from './tenant-scope.models';
import { collectTenantIds, dataHasTenant, isByIdWhere, whereHasTenant } from './tenant-scope.inspect';
import { findAllowEntry, hasCallSiteFreeEntry } from './tenant-scope.allowlist';

/**
 * Runtime tenant-scope safety net for Prisma (see apps/api/CLAUDE.md).
 *
 * Installed on PrismaService via a Prisma Client query extension
 * (`$extends({ query: { $allModels: { $allOperations } } })`). For every
 * query on a model that has a `tenantId` column, executed inside a tenant
 * HTTP request (ALS request context with a tenant, caller not a platform
 * admin), it verifies the where/data carries a tenant filter.
 *
 * Env `TENANT_SCOPE_ENFORCEMENT` = off | warn (default) | strict.
 * Env `TENANT_SCOPE_STRICT_BY_ID=true` makes strict mode also throw for
 * single-row-by-id queries (default: those only warn).
 */

export type TenantScopeMode = 'off' | 'warn' | 'strict';

export const TENANT_SCOPE_LOG_CONTEXT = 'TENANT_SCOPE';
const logger = new Logger(TENANT_SCOPE_LOG_CONTEXT);

const WHERE_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);
/** Ops whose `data` may (re)assign tenantId — checked for mismatch only. */
const UPDATE_DATA_OPS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

const MAX_MISMATCH_LOGS_PER_KEY = 50;

export function tenantScopeMode(): TenantScopeMode {
  const raw = (process.env.TENANT_SCOPE_ENFORCEMENT || '').trim().toLowerCase();
  if (raw === 'off' || raw === 'strict') return raw;
  return 'warn';
}

function strictById(): boolean {
  return (process.env.TENANT_SCOPE_STRICT_BY_ID || '').trim().toLowerCase() === 'true';
}

// ---------------------------------------------------------------------------
// Stats (in-memory, per process) — exposed for tests and ad-hoc inspection.
// ---------------------------------------------------------------------------

interface MutableStats {
  checked: number;
  violations: number;
  mismatches: number;
  allowlisted: number;
  byKey: Map<string, number>;
}

const stats: MutableStats = { checked: 0, violations: 0, mismatches: 0, allowlisted: 0, byKey: new Map() };
const mismatchLogCount = new Map<string, number>();

export interface TenantScopeStats {
  checked: number;
  violations: number;
  mismatches: number;
  allowlisted: number;
  distinct: number;
  /** `Model.operation @ call-site` → occurrences (missing-scope + mismatch). */
  byKey: Record<string, number>;
}

export function getTenantScopeStats(): TenantScopeStats {
  return {
    checked: stats.checked,
    violations: stats.violations,
    mismatches: stats.mismatches,
    allowlisted: stats.allowlisted,
    distinct: stats.byKey.size,
    byKey: Object.fromEntries(stats.byKey),
  };
}

export function resetTenantScopeStats(): void {
  stats.checked = 0;
  stats.violations = 0;
  stats.mismatches = 0;
  stats.allowlisted = 0;
  stats.byKey.clear();
  mismatchLogCount.clear();
}

// ---------------------------------------------------------------------------
// Call-site capture (only on violation — never on the hot path).
// ---------------------------------------------------------------------------

/** apps/api root (works from both src/tenant-scope and dist/tenant-scope). */
const API_ROOT = path.resolve(__dirname, '..', '..');
const API_ROOT_NORM = API_ROOT.replace(/\\/g, '/').toLowerCase();

function isOwnInternalFrame(file: string): boolean {
  return /\/(tenant-scope|prisma)\/[^/]+$/.test(file) && !/\.spec\.[tj]s$/.test(file);
}

/**
 * First stack frame inside apps/api/{src,dist} that is not the guard or
 * PrismaService itself, as `src/orders/orders.service.ts:123`. Falls back to
 * `unknown`. Prisma's lazy PrismaPromise runs the extension when the caller
 * awaits it, so the caller usually shows as an `at async` frame.
 */
export function captureCallSite(): string {
  const prevLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 60;
  const stack = new Error().stack || '';
  Error.stackTraceLimit = prevLimit;
  for (const line of stack.split('\n')) {
    const m = /\(?((?:[A-Za-z]:)?[^():]+\.[tj]s):(\d+)(?::\d+)?\)?\s*$/.exec(line.trim());
    if (!m) continue;
    const file = m[1].replace(/\\/g, '/');
    const lower = file.toLowerCase();
    const idx = lower.indexOf(API_ROOT_NORM);
    if (idx === -1 || lower.includes('/node_modules/')) continue;
    const rel = file.slice(idx + API_ROOT_NORM.length).replace(/^\//, '');
    if (!/^(src|dist)\//.test(rel) || isOwnInternalFrame(rel)) continue;
    return `${rel}:${m[2]}`;
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// The check.
// ---------------------------------------------------------------------------

export interface TenantScopeQuery {
  model?: string;
  operation: string;
  args: any;
}

function bump(key: string): number {
  const n = (stats.byKey.get(key) ?? 0) + 1;
  stats.byKey.set(key, n);
  return n;
}

/**
 * Throws (strict) or logs (warn) when a tenant-scoped query inside a tenant
 * request lacks a tenant filter, or targets a different tenant.
 * No-op outside a tenant request, for platform admins, for models without
 * tenantId, and when mode is `off`. Cheap on the happy path: one ALS lookup,
 * one Set lookup, one shallow-ish object walk — no stack capture.
 */
export function checkTenantScope(q: TenantScopeQuery): void {
  const { model, operation, args } = q;
  if (!model || !isTenantScopedModel(model)) return;
  const isWhereOp = WHERE_OPS.has(operation);
  const isCreateOp = CREATE_OPS.has(operation);
  if (!isWhereOp && !isCreateOp) return;

  const mode = tenantScopeMode();
  if (mode === 'off') return;
  const requestTenantId = currentRequestTenantId();
  if (!requestTenantId || currentRequestIsPlatformAdmin()) return;

  stats.checked++;

  // 1. Cross-tenant mismatch — an explicit tenantId that isn't ours.
  const ids: string[] = [];
  if (isWhereOp) collectTenantIds(args?.where, ids);
  if (isCreateOp || UPDATE_DATA_OPS.has(operation)) collectTenantIds(args?.data, ids);
  if (operation === 'upsert') {
    collectTenantIds(args?.create, ids);
    collectTenantIds(args?.update, ids);
  }
  const foreign = ids.find((id) => id !== requestTenantId);
  if (foreign !== undefined) {
    const callSite = captureCallSite();
    if (findAllowEntry(model, operation, callSite, { crossTenant: true })) {
      stats.allowlisted++;
      return;
    }
    const key = `${model}.${operation} @ ${callSite}`;
    stats.mismatches++;
    bump(key);
    const logged = (mismatchLogCount.get(key) ?? 0) + 1;
    mismatchLogCount.set(key, logged);
    const msg = `[TENANT_SCOPE] cross-tenant ${model}.${operation} at ${callSite}: query tenant ${foreign} != request tenant ${requestTenantId}`;
    if (logged <= MAX_MISMATCH_LOGS_PER_KEY) logger.error(msg);
    if (mode === 'strict') throw new ForbiddenException('Cross-tenant data access refused');
    return;
  }

  // 2. Missing scope.
  let what: string;
  let byId = false;
  if (isCreateOp) {
    if (dataHasTenant(args?.data)) return;
    what = 'data without tenantId';
  } else if (!whereHasTenant(args?.where)) {
    byId = isByIdWhere(args?.where);
    what = byId ? 'where by id only (no tenantId)' : 'where without tenantId';
  } else if (operation === 'upsert' && !dataHasTenant(args?.create)) {
    what = 'upsert create without tenantId';
  } else {
    return;
  }

  if (hasCallSiteFreeEntry(model, operation)) {
    stats.allowlisted++;
    return;
  }
  const callSite = captureCallSite();
  if (findAllowEntry(model, operation, callSite)) {
    stats.allowlisted++;
    return;
  }

  const key = `${model}.${operation} @ ${callSite}`;
  stats.violations++;
  const seen = bump(key);
  const msg = `[TENANT_SCOPE] unscoped ${model}.${operation} (${what}) at ${callSite} [request tenant ${requestTenantId}]`;

  if (mode === 'strict' && (!byId || strictById())) {
    logger.error(msg);
    throw new InternalServerErrorException(
      `Tenant scope violation: ${model}.${operation} executed without a tenantId filter (${callSite})`,
    );
  }
  if (seen === 1) logger.warn(msg);
}

// ---------------------------------------------------------------------------
// Prisma integration.
// ---------------------------------------------------------------------------

/** The query extension (exported so tests can assert it is installed). */
export const tenantScopeExtension = Prisma.defineExtension({
  name: 'tenant-scope-guard',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        checkTenantScope({ model, operation, args });
        return query(args);
      },
    },
  },
});
