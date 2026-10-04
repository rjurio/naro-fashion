import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request AsyncLocalStorage carrying the Express request object.
 *
 * Installed as the very first Express middleware in `main.ts`
 * (`requestContextMiddleware`). It lets SINGLETON services (EmailService,
 * NotificationsService, ...) discover the current request's tenant without
 * injecting the request-scoped `TenantContext` — injecting a request-scoped
 * provider would bubble request scope up into every consumer, including the
 * cron-driven SchedulerService, and silently break `@Cron` registration.
 *
 * We store the request object (not a tenantId snapshot) because the tenant is
 * resolved LATER in the pipeline (TenantInterceptor sets `req.tenantId`, the
 * JWT strategy sets `req.user`). Reading lazily always sees the final value.
 *
 * Outside a request (crons, scripts, unit tests) `getStore()` is undefined
 * and `currentRequestTenantId()` returns null — callers must then pass an
 * explicit tenantId or fall back to the default tenant.
 */
export const requestContextStorage = new AsyncLocalStorage<{ req: any }>();

export function requestContextMiddleware(req: any, _res: any, next: () => void) {
  requestContextStorage.run({ req }, next);
}

/** Tenant of the in-flight HTTP request, or null outside a request. */
export function currentRequestTenantId(): string | null {
  const req = requestContextStorage.getStore()?.req;
  if (!req) return null;
  const id = req.tenantId || req.user?.tenantId || null;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * True when the in-flight HTTP request is authenticated as a platform admin
 * (no tenant scope by design). False outside a request.
 * Used by the tenant-scope Prisma guard (`src/tenant-scope/`).
 */
export function currentRequestIsPlatformAdmin(): boolean {
  return !!requestContextStorage.getStore()?.req?.user?.isPlatformAdmin;
}
