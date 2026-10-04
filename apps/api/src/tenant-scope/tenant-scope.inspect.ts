/**
 * Pure, allocation-light inspectors for Prisma `where` / `data` arguments.
 * No Prisma, no Nest, no ALS — trivially unit-testable.
 */

const MAX_DEPTH = 8;

/** Relation/negation operators whose nested filter does NOT restrict the row set to a tenant. */
const NON_SCOPING_KEYS = new Set(['NOT', 'none', 'every', 'isNot']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * True when the where-clause restricts rows to a tenant:
 *  - `tenantId` key with any defined value (string, `{ equals }`, `{ in }`,
 *    or `null` for explicit system rows) at any level;
 *  - inside `AND` (array or object) when ANY element is scoped;
 *  - inside `OR` only when EVERY branch is scoped
 *    (`OR: [{ tenantId }, { name }]` leaks the second branch across tenants;
 *    `OR: [{ tenantId: X }, { tenantId: null }]` — system rows — is fine);
 *  - through a relation filter (`rentalOrder: { tenantId }`,
 *    `order: { is: { tenantId } }`, `items: { some: { tenantId } }`) and
 *    compound unique keys (`tenantId_slug: { tenantId, slug }`).
 * `NOT`, `none`, `every`, `isNot` never count — they don't bound the row set.
 * `tenantId: undefined` does NOT count: Prisma silently drops undefined keys,
 * which is exactly the `tenantId: this.tenantContext.id` (null/undefined) bug.
 */
export function whereHasTenant(where: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || !isPlainObject(where)) return false;
  if (where.tenantId !== undefined) return true;
  for (const key in where) {
    const value = where[key];
    if (value === undefined || value === null || NON_SCOPING_KEYS.has(key)) continue;
    if (key === 'OR') {
      if (Array.isArray(value)) {
        if (value.length > 0 && value.every((b) => whereHasTenant(b, depth + 1))) return true;
      } else if (whereHasTenant(value, depth + 1)) {
        return true;
      }
      continue;
    }
    if (key === 'AND') {
      if (Array.isArray(value) ? value.some((b) => whereHasTenant(b, depth + 1)) : whereHasTenant(value, depth + 1)) {
        return true;
      }
      continue;
    }
    if (isPlainObject(value) && whereHasTenant(value, depth + 1)) return true;
  }
  return false;
}

function pushTenantValue(v: unknown, out: string[]): void {
  if (typeof v === 'string') out.push(v);
  else if (isPlainObject(v)) {
    if (typeof v.equals === 'string') out.push(v.equals);
    if (Array.isArray(v.in)) for (const x of v.in) if (typeof x === 'string') out.push(x);
    if (typeof v.set === 'string') out.push(v.set);
  }
}

/**
 * Collects every concrete tenant id literal found in a where/data tree
 * (`tenantId: 'x'`, `{ equals }`, `{ in: [...] }`, `{ set }`,
 * `tenant: { connect: { id } }`). Used for cross-tenant mismatch detection.
 */
export function collectTenantIds(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > MAX_DEPTH) return out;
  if (Array.isArray(node)) {
    for (const n of node) collectTenantIds(n, out, depth + 1);
    return out;
  }
  if (!isPlainObject(node)) return out;
  for (const key in node) {
    const value = node[key];
    if (value === undefined || value === null) continue;
    if (key === 'tenantId') {
      pushTenantValue(value, out);
    } else if (key === 'tenant' && isPlainObject(value)) {
      const connect = value.connect;
      if (isPlainObject(connect) && typeof connect.id === 'string') out.push(connect.id);
    } else if (key !== 'NOT' && (isPlainObject(value) || Array.isArray(value))) {
      collectTenantIds(value, out, depth + 1);
    }
  }
  return out;
}

/** True when a create payload sets the tenant (`tenantId` or `tenant: { connect }`). */
export function dataHasTenant(data: unknown): boolean {
  if (Array.isArray(data)) return data.length > 0 && data.every((d) => dataHasTenant(d));
  if (!isPlainObject(data)) return false;
  if (data.tenantId !== undefined && data.tenantId !== null) return true;
  const tenant = data.tenant;
  return isPlainObject(tenant) && (isPlainObject(tenant.connect) || isPlainObject(tenant.connectOrCreate));
}

/**
 * True when the where-clause pins a single row by primary key at top level
 * (`{ id }`, `{ id, deletedAt: null }`, `{ id: { equals } }`). Loading by id
 * after a tenant-scoped read is a known-legit pattern, so these only warn
 * (strict mode throws for them only with TENANT_SCOPE_STRICT_BY_ID=true).
 */
export function isByIdWhere(where: unknown): boolean {
  if (!isPlainObject(where)) return false;
  const id = where.id;
  return typeof id === 'string' || (isPlainObject(id) && typeof id.equals === 'string');
}
