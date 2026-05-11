import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * SizeGuidesController shape invariants — 2026-05-11.
 *
 * Sister to the products/orders/rentals PR-1 fix from 2026-05-02: every
 * admin-only route on the size-guides controller MUST be wrapped in
 * `@UseGuards(JwtAuthGuard, AdminGuard)` so customer JWTs cannot reach
 * mutation endpoints (create / update / delete / restore / toggle-active /
 * set-default) or the admin listing endpoints (admin, deleted, :id).
 *
 * The three public routes (`findAllPublic`, `findDefault`, `findBySlug`)
 * MUST keep `@Public()` — anonymous storefront callers depend on them and
 * the route-level `findBySlug` WHERE-clause hotfix already excludes drafts
 * and soft-deleted guides. See size-guides.service.spec.ts.
 *
 * This is a source-text invariant (cheap, no Nest boot) — same pattern as
 * `ai-controllers.shape.spec.ts`. If a future PR drops `AdminGuard` from
 * any admin route or accidentally marks an admin handler `@Public()`, this
 * test fails before it can ship.
 */

const SRC = readFileSync(
  join(__dirname, 'size-guides.controller.ts'),
  'utf8',
);

const PUBLIC_HANDLERS = ['findAllPublic', 'findDefault', 'findBySlug'];

const ADMIN_HANDLERS = [
  'findAll',
  'findDeleted',
  'findById',
  'create',
  'update',
  'setDefault',
  'toggleActive',
  'restore',
  'delete',
];

/**
 * Slice the controller source around a method so the decorator assertions
 * are local to that handler — a misplaced decorator elsewhere in the file
 * cannot satisfy the check.
 */
function decoratorsFor(method: string): string {
  const re = new RegExp(
    `((?:@[A-Za-z]+\\([^)]*\\)\\s*)+)\\s+${method}\\s*\\(`,
    'm',
  );
  const m = SRC.match(re);
  if (!m) {
    throw new Error(`Could not locate handler ${method} in controller source`);
  }
  return m[1];
}

describe('SizeGuidesController — public vs admin route guard invariants', () => {
  it('imports AdminGuard from the auth/guards module', () => {
    expect(SRC).toMatch(
      /import\s*\{\s*AdminGuard\s*\}\s*from\s*['"]\.\.\/auth\/guards\/admin\.guard['"]/,
    );
  });

  describe('public routes — MUST stay @Public()', () => {
    it.each(PUBLIC_HANDLERS)('%s carries @Public()', (handler) => {
      const decos = decoratorsFor(handler);
      expect(decos).toContain('@Public()');
      // Defense: must NOT also gate on JwtAuthGuard (would 401 anonymous
      // storefront callers because @Public() only skips JwtAuthGuard, not
      // arbitrary other guards).
      expect(decos).not.toContain('@UseGuards(');
    });
  });

  describe('admin routes — MUST stack JwtAuthGuard + AdminGuard', () => {
    it.each(ADMIN_HANDLERS)(
      '%s carries @UseGuards(JwtAuthGuard, AdminGuard) in that order',
      (handler) => {
        const decos = decoratorsFor(handler);
        // JwtAuthGuard must come first so request.user is populated by the
        // time AdminGuard runs. AdminGuard reads `request.user.isAdmin`.
        expect(decos).toMatch(/@UseGuards\(\s*JwtAuthGuard\s*,\s*AdminGuard\s*\)/);
        // Defense: an admin route must never be marked @Public().
        expect(decos).not.toContain('@Public()');
      },
    );

    it('no admin handler uses JwtAuthGuard alone (the pre-fix shape)', () => {
      for (const handler of ADMIN_HANDLERS) {
        const decos = decoratorsFor(handler);
        // The exact `@UseGuards(JwtAuthGuard)` literal — with no second
        // arg — was the audit-finding shape. If a future "tidy-up" PR
        // accidentally drops AdminGuard, this assertion catches it.
        expect(decos).not.toMatch(/@UseGuards\(\s*JwtAuthGuard\s*\)/);
      }
    });
  });

  describe('public/admin partition is exhaustive', () => {
    it('every @Get/@Post/@Patch/@Delete handler is in exactly one bucket', () => {
      const handlerRe =
        /(?:@(?:Get|Post|Patch|Delete)\([^)]*\))[\s\S]{0,400}?\s+([a-zA-Z0-9_]+)\s*\(/g;
      const found: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = handlerRe.exec(SRC))) {
        found.push(m[1]);
      }
      const expected = [...PUBLIC_HANDLERS, ...ADMIN_HANDLERS].sort();
      expect(found.sort()).toEqual(expected);
    });
  });
});
