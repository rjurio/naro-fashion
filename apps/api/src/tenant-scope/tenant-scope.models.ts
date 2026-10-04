import { Prisma } from '@prisma/client';

/**
 * Set of Prisma model names (PascalCase, as passed to query extensions as
 * `model`) that carry a `tenantId` column — i.e. the row-level tenant-scoped
 * models. Derived from the generated client's DMMF at runtime so it can never
 * drift from `schema.prisma`: add `tenantId` to a model, regenerate, and the
 * guard covers it automatically.
 *
 * Models WITHOUT tenantId (Tenant, PlatformAdmin, SubscriptionPlan,
 * Permission, RolePermission, OrderItem, CartItem, ...) are never checked —
 * they are either global or scoped through a parent relation.
 */
let cached: ReadonlySet<string> | null = null;

export function tenantScopedModels(): ReadonlySet<string> {
  if (cached) return cached;
  const models: ReadonlyArray<{ name: string; fields: ReadonlyArray<{ name: string }> }> =
    (Prisma as any)?.dmmf?.datamodel?.models ?? [];
  cached = new Set(
    models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name),
  );
  return cached;
}

export function isTenantScopedModel(model: string | undefined): boolean {
  return !!model && tenantScopedModels().has(model);
}
