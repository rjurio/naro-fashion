import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Admin-Guard Coverage Invariant
 * ==============================
 *
 * For every HTTP route declared by a `*.controller.ts` file under
 * `apps/api/src/`, the resolved guard set MUST satisfy one of:
 *
 *   (a) The route is marked `@Public()` — anonymous traffic by design.
 *   (b) The combined class-level + method-level `@UseGuards(...)` chain
 *       contains at least one of: `AdminGuard`, `PlatformAdminGuard`,
 *       or the route is class-protected by `@AiSecured()` (which
 *       resolves to JwtAuthGuard → AdminGuard → AiPermissionGuard).
 *   (c) The route is listed in `CUSTOMER_ROUTE_ALLOWLIST` below — these
 *       are the legitimately customer-mutable / customer-readable
 *       endpoints (cart, wishlist, addresses, own orders, etc.).
 *
 * Anything else FAILS the build. This catches the bug class found in
 * the May / June 2026 security reviews: admin routes guarded only by
 * `JwtAuthGuard`, which any logged-in customer can satisfy.
 *
 * When adding a new customer-mutable endpoint, add an entry here with
 * a one-line explanation of why it's safe (typically: the service
 * scopes by `userId` via `@CurrentUser('id')` and `ownerScope(user)`).
 *
 * When adding a new admin endpoint, do NOT touch this allowlist — add
 * `@UseGuards(AdminGuard)` (or class-level `@UseGuards(JwtAuthGuard, AdminGuard)`)
 * to the controller. The spec is the safety net, not the workaround.
 */

const SRC_ROOT = join(__dirname, '..');

/**
 * Routes that are intentionally available to authenticated customers
 * (and admins). Key: `<filename>#<methodName>`. Value: one-line reason.
 *
 * Auth/token endpoints, password reset, profile, addresses, cart,
 * wishlist, own-orders, own-rentals, own-payments, own-events,
 * referral self-service, review self-service, ID verification submit,
 * promo-code validate, etc.
 */
const CUSTOMER_ROUTE_ALLOWLIST: Record<string, string> = {
  // --- auth.controller.ts ---
  'auth.controller.ts#logout': 'JWT-authed customer/admin logs out',
  'auth.controller.ts#me': 'returns own profile via CurrentUser',
  'auth.controller.ts#updateMe': 'updates own profile via CurrentUser',
  'auth.controller.ts#changePassword': 'changes own password via CurrentUser',
  'auth.controller.ts#toggle2FA': 'toggles own 2FA via CurrentUser',

  // --- users.controller.ts (customer-facing profile + addresses) ---
  'users.controller.ts#getProfile': 'own profile via CurrentUser',
  'users.controller.ts#updateProfile': 'own profile via CurrentUser',
  'users.controller.ts#getAddresses': 'own addresses via CurrentUser',
  'users.controller.ts#createAddress': 'own address via CurrentUser',
  'users.controller.ts#updateAddress': 'service enforces userId ownership',
  'users.controller.ts#deleteAddress': 'service enforces userId ownership',

  // --- cart.controller.ts (everything is customer-scoped via CurrentUser) ---
  'cart.controller.ts#getCart': 'own cart via CurrentUser',
  'cart.controller.ts#addItem': 'own cart via CurrentUser',
  'cart.controller.ts#updateItem': 'service enforces userId ownership',
  'cart.controller.ts#removeItem': 'service enforces userId ownership',
  'cart.controller.ts#clearCart': 'own cart via CurrentUser',
  'cart.controller.ts#getCartCount': 'own cart count via CurrentUser',
  'cart.controller.ts#mergeGuestCart': 'merges guest cart into own cart',

  // --- wishlist.controller.ts (everything customer-scoped) ---
  'wishlist.controller.ts#getWishlist': 'own wishlist via CurrentUser',
  'wishlist.controller.ts#addItem': 'own wishlist via CurrentUser',
  'wishlist.controller.ts#removeItem': 'own wishlist via CurrentUser',
  'wishlist.controller.ts#isInWishlist': 'own wishlist check via CurrentUser',
  'wishlist.controller.ts#getWishlistCount': 'own wishlist count via CurrentUser',

  // --- orders.controller.ts (customer-mutable list/create/findOne; admin variants split out) ---
  'orders.controller.ts#create': 'customer creates own order',
  'orders.controller.ts#findAll': 'returns customer\'s own orders (scoped by userId)',
  'orders.controller.ts#findOne': 'ownerScope(user) enforced in service',
  'orders.controller.ts#updateStatus': 'customer can only set CANCELLED — enforced in service',

  // --- payments.controller.ts (customer-initiated payments; ownerScope in service) ---
  'payments.controller.ts#initiatePayment': 'ownerScope(user) enforced in service',
  'payments.controller.ts#getPaymentStatus': 'ownerScope(user) enforced in service',
  'payments.controller.ts#findByOrder': 'ownerScope(user) enforced in service',
  'payments.controller.ts#getPaymentSummary': 'ownerScope(user) enforced in service',
  'payments.controller.ts#findByRental': 'ownerScope(user) enforced in service',

  // --- rentals.controller.ts (customer creates rental; admin variants split out) ---
  'rentals.controller.ts#create': 'customer creates own rental',
  'rentals.controller.ts#findAll': 'returns customer\'s own rentals (scoped by userId)',
  'rentals.controller.ts#findOne': 'ownerScope(user) enforced in service',
  'rentals.controller.ts#getAvailability': 'product-availability lookup, no PII',

  // --- reviews.controller.ts (customers own their reviews) ---
  'reviews.controller.ts#create': 'customer creates review under own userId',
  'reviews.controller.ts#update': 'service enforces userId ownership (ForbiddenException)',
  'reviews.controller.ts#delete': 'service enforces userId ownership (ForbiddenException)',

  // --- events.controller.ts (customer-submitted wedding gallery, own-event view) ---
  'events.controller.ts#findMyEvent': 'own event via CurrentUser',
  'events.controller.ts#createByCustomer': 'customer creates event under own userId',

  // --- id-verification.controller.ts (customer submits own document) ---
  'id-verification.controller.ts#submit': 'customer submits own ID via CurrentUser',
  'id-verification.controller.ts#getStatus': 'own verification status via CurrentUser',

  // --- referrals.controller.ts (referral self-service) ---
  'referrals.controller.ts#getMyCode': 'own referral code via CurrentUser',
  'referrals.controller.ts#generateCode': 'own referral code via CurrentUser',
  'referrals.controller.ts#applyCode': 'customer applies code under own userId',

  // --- upload.controller.ts (rental ID-doc upload by logged-in customer) ---
  'upload.controller.ts#uploadIdDocument': 'rental ID verification flow — customer-scoped storage',
};

/** Guard names that satisfy the admin-protection invariant. */
const ADMIN_GUARDS = new Set([
  'AdminGuard',
  'PlatformAdminGuard',
]);

/** The composed decorator that bundles JwtAuthGuard + AdminGuard + AiPermissionGuard. */
const COMPOSED_ADMIN_DECORATOR = '@AiSecured()';

const ROUTE_DECORATORS = ['Get', 'Post', 'Patch', 'Put', 'Delete'];

interface Route {
  file: string;
  methodName: string;
  httpVerb: string;
  classGuards: string[];
  methodGuards: string[];
  isPublic: boolean;
  classUsesAiSecured: boolean;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Extracts the class-level guard list and whether the class is decorated
 * with `@AiSecured()`. The class declaration looks like:
 *
 *   @UseGuards(A, B, C)
 *   @SomethingElse(...)
 *   @Controller('...')
 *   export class FooController { ... }
 *
 *   - or -
 *
 *   @AiSecured()
 *   @Controller('...')
 *   export class FooController { ... }
 */
function extractClassMeta(src: string): { guards: string[]; usesAiSecured: boolean } {
  // The class-decorator block is bounded by `export class ...Controller`.
  // Decorators can appear either BEFORE or AFTER `@Controller(...)` — both
  // patterns are common in this codebase. Look at the entire region from
  // the file start through `export class` and pick up every @UseGuards +
  // @AiSecured found in that prefix.
  const classDeclMatch = src.match(/export\s+(?:abstract\s+)?class\s+\w+Controller/);
  if (!classDeclMatch || classDeclMatch.index === undefined) {
    return { guards: [], usesAiSecured: false };
  }
  const head = src.slice(0, classDeclMatch.index);

  const usesAiSecured = /@AiSecured\s*\(\s*\)/.test(head);

  // Find every @UseGuards in the decorator block. Most classes have at most
  // one, but the parser shouldn't break if there are multiple.
  const guards: string[] = [];
  const useGuardsRegex = /@UseGuards\s*\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = useGuardsRegex.exec(head)) !== null) {
    for (const g of match[1].split(',').map((s) => s.trim())) {
      if (g) guards.push(g);
    }
  }
  return { guards, usesAiSecured };
}

/**
 * Parses every HTTP route handler from a controller file.
 *
 * Approach: walk lines top-to-bottom; accumulate decorators on a buffer;
 * when we hit a function-signature line that looks like a method, flush
 * the buffer into a Route record if any of the accumulated decorators was
 * a route decorator (@Get/@Post/@Patch/@Put/@Delete).
 */
function parseRoutes(file: string, src: string): Route[] {
  const stripped = stripComments(src);
  const lines = stripped.split('\n');
  const { guards: classGuards, usesAiSecured: classUsesAiSecured } = extractClassMeta(stripped);

  const routes: Route[] = [];
  let pendingDecorators: string[] = [];
  let inClassBody = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inClassBody) {
      // Wait until we're inside the controller class body to start counting
      // method-level decorators.
      if (/export\s+class\s+\w+Controller/.test(line)) inClassBody = true;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith('@')) {
      // It's a decorator line — buffer the whole decorator (may span multiple
      // lines if it has a multi-line argument list; for our parser purposes we
      // capture the first line, which is enough to identify the decorator name
      // and its top-level args).
      pendingDecorators.push(trimmed);
      continue;
    }

    // A non-decorator, non-blank line in the class body — this may be a
    // method signature. Look for `name(` followed by either `: SomeType {`
    // or just `{` on the same or near line.
    const methodMatch = trimmed.match(/^(?:async\s+)?(\w+)\s*\(/);
    if (methodMatch && pendingDecorators.length > 0) {
      // Found a method. Did any of its decorators declare a route?
      const routeDecorator = pendingDecorators.find((d) =>
        ROUTE_DECORATORS.some((v) => new RegExp(`^@${v}\\b`).test(d)),
      );
      if (routeDecorator) {
        const httpVerb = ROUTE_DECORATORS.find((v) =>
          new RegExp(`^@${v}\\b`).test(routeDecorator),
        )!;
        const isPublic = pendingDecorators.some((d) => /^@Public\s*\(/.test(d));
        const useGuardsLines = pendingDecorators.filter((d) => /^@UseGuards\s*\(/.test(d));
        const methodGuards: string[] = [];
        for (const ug of useGuardsLines) {
          const inner = ug.match(/@UseGuards\s*\(([^)]+)\)/);
          if (!inner) continue;
          for (const g of inner[1].split(',').map((s) => s.trim())) {
            if (g) methodGuards.push(g);
          }
        }
        routes.push({
          file,
          methodName: methodMatch[1],
          httpVerb,
          classGuards,
          methodGuards,
          isPublic,
          classUsesAiSecured,
        });
      }
      pendingDecorators = [];
      continue;
    }

    // Reset the buffer on lines like `constructor(`, `private readonly ...`,
    // blank lines etc., to avoid dragging stale decorators forward.
    if (trimmed.length === 0) continue;
    if (
      /^constructor\s*\(/.test(trimmed) ||
      /^private\s/.test(trimmed) ||
      /^public\s/.test(trimmed) ||
      /^readonly\s/.test(trimmed)
    ) {
      pendingDecorators = [];
    }
  }

  return routes;
}

function isAdminGuarded(route: Route): boolean {
  if (route.classUsesAiSecured) return true;
  if (route.classGuards.some((g) => ADMIN_GUARDS.has(g))) return true;
  if (route.methodGuards.some((g) => ADMIN_GUARDS.has(g))) return true;
  return false;
}

function walkControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkControllerFiles(full));
    } else if (entry.endsWith('.controller.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('Controller admin-guard coverage invariant', () => {
  const controllerFiles = walkControllerFiles(SRC_ROOT);

  it('discovers controller files', () => {
    expect(controllerFiles.length).toBeGreaterThan(20);
  });

  const violations: string[] = [];
  const allRoutes: Route[] = [];

  for (const filePath of controllerFiles) {
    const file = filePath.split(/[\\/]/).pop()!;
    const src = readFileSync(filePath, 'utf8');
    const routes = parseRoutes(file, src);
    for (const r of routes) {
      allRoutes.push(r);
      if (r.isPublic) continue;
      if (isAdminGuarded(r)) continue;
      const key = `${r.file}#${r.methodName}`;
      if (CUSTOMER_ROUTE_ALLOWLIST[key]) continue;
      violations.push(
        `${r.file}#${r.methodName} (${r.httpVerb}) — neither @Public(), AdminGuard/PlatformAdminGuard/@AiSecured, nor in CUSTOMER_ROUTE_ALLOWLIST`,
      );
    }
  }

  it('parses a non-trivial number of routes', () => {
    // Sanity check that the walker is finding things — the API has 100+ HTTP
    // routes. If this drops to <50 the parser silently broke.
    expect(allRoutes.length).toBeGreaterThan(50);
  });

  it('every non-public route is admin-guarded or explicitly customer-scoped', () => {
    if (violations.length === 0) return;
    throw new Error(
      `Admin-guard coverage violations (${violations.length}):\n  - ` +
        violations.join('\n  - ') +
        '\n\nFix either by:\n' +
        '  1) Adding @UseGuards(AdminGuard) (or class-level JwtAuthGuard+AdminGuard)\n' +
        '     if this is an admin-only endpoint, OR\n' +
        '  2) Adding an entry to CUSTOMER_ROUTE_ALLOWLIST in this spec if the\n' +
        '     route is legitimately customer-mutable (service must enforce\n' +
        '     userId ownership via @CurrentUser + ownerScope/equivalent).',
    );
  });

  it('CUSTOMER_ROUTE_ALLOWLIST contains no stale entries (every key points at a real route)', () => {
    const known = new Set(allRoutes.map((r) => `${r.file}#${r.methodName}`));
    const stale = Object.keys(CUSTOMER_ROUTE_ALLOWLIST).filter((k) => !known.has(k));
    if (stale.length > 0) {
      throw new Error(
        `Stale CUSTOMER_ROUTE_ALLOWLIST entries — these don't match any route:\n  - ` +
          stale.join('\n  - ') +
          '\n\nRemove them from the allowlist or fix the typo.',
      );
    }
  });
});
