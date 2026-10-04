/**
 * Resolve the deployment's "default" tenant — the one that owns legacy
 * deploy-time env configuration (INSTAGRAM_ACCESS_TOKEN,
 * INSTAGRAM_BUSINESS_ACCOUNT_ID, ...) and whose branding is used for
 * system emails when no tenant can be determined.
 *
 * Resolution order:
 *   1. Tenant whose slug equals env `DEFAULT_TENANT_SLUG`
 *   2. Tenant whose slug equals env `NEXT_PUBLIC_TENANT_SLUG`
 *   3. The only tenant, when exactly one tenant exists (current single-tenant
 *      prod) — never "the first of many", which is what made env secrets
 *      and branding leak across tenants.
 *
 * Returns null when no default can be determined. Cached for 5 minutes.
 */
interface TenantLookupClient {
  tenant: {
    findUnique(args: any): Promise<{ id: string } | null>;
    findMany(args: any): Promise<Array<{ id: string }>>;
  };
}

let cache: { id: string | null; expires: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function resolveDefaultTenantId(
  prisma: TenantLookupClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (cache && cache.expires > Date.now()) return cache.id;

  let id: string | null = null;
  try {
    for (const slug of [env.DEFAULT_TENANT_SLUG, env.NEXT_PUBLIC_TENANT_SLUG]) {
      if (!slug) continue;
      const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
      if (t) {
        id = t.id;
        break;
      }
    }
    if (!id) {
      const tenants = await prisma.tenant.findMany({ select: { id: true }, take: 2 });
      if (tenants.length === 1) id = tenants[0].id;
    }
  } catch {
    id = null;
  }

  cache = { id, expires: Date.now() + TTL_MS };
  return id;
}

/** Test hook. */
export function __resetDefaultTenantCache() {
  cache = null;
}
