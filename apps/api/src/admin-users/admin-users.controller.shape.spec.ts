import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Source-text invariants for AdminUsersController — 2026-05-11.
 *
 * The controller previously read `req.user.sub` to pass the performer id
 * down to the service. `JwtStrategy.validate()` returns the AdminUser/User
 * row (which carries `id`), NOT the raw JWT payload (which carries `sub`).
 * `req.user.sub` was always undefined, every self-modification guard in
 * AdminUsersService silently failed open, and every audit row written
 * by this controller wrote `assignedBy: null` / `createdBy: null`.
 *
 * These invariants pin the wiring so the bug cannot regress:
 *   1. `req.user.sub` MUST NOT appear anywhere in this file.
 *   2. `@CurrentUser` MUST be used to extract the performer id.
 *   3. All write handlers MUST pass `performedById` to the service —
 *      no anonymous `undefined` sneaks through.
 *   4. `@Request()` MUST NOT be re-introduced for the performer id
 *      (it was the carrier of the bug; @CurrentUser is the only correct
 *      pattern here).
 */

const CONTROLLER_PATH = join(__dirname, 'admin-users.controller.ts');

let src: string;

beforeAll(() => {
  src = readFileSync(CONTROLLER_PATH, 'utf8');
});

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('AdminUsersController — performedById wiring invariants', () => {
  it('does NOT reference req.user.sub anywhere (validate() returns id, not sub)', () => {
    const stripped = stripComments(src);
    expect(stripped).not.toMatch(/req\.user\??\.sub\b/);
  });

  it('does NOT use @Request() for the performer id (the carrier of the original bug)', () => {
    const stripped = stripComments(src);
    // The Request decorator import should be gone entirely; if a future PR
    // brings it back, this assertion forces the author to explain why.
    expect(stripped).not.toMatch(/@Request\(\)/);
  });

  it('imports and uses @CurrentUser to extract the performer id', () => {
    const stripped = stripComments(src);
    expect(stripped).toMatch(/from '\.\.\/auth\/decorators\/current-user\.decorator'/);
    expect(stripped).toMatch(/@CurrentUser\(/);
  });

  it('extracts the performer id specifically via @CurrentUser(\'id\') — not the whole user object', () => {
    // We pin the explicit key extraction so the controller never accidentally
    // passes the whole user object (which would re-introduce a different
    // class of footgun: services would have to know the user shape).
    const stripped = stripComments(src);
    expect(stripped).toMatch(/@CurrentUser\(['"]id['"]\)/);
  });

  it('all five write handlers pass a typed performedById to the service', () => {
    const stripped = stripComments(src);
    expect(stripped).toMatch(/this\.adminUsersService\.create\([^)]*performedById[^)]*\)/);
    expect(stripped).toMatch(/this\.adminUsersService\.remove\([^)]*performedById[^)]*\)/);
    expect(stripped).toMatch(/this\.adminUsersService\.toggle\([^)]*performedById[^)]*\)/);
    expect(stripped).toMatch(/this\.adminUsersService\.assignRole\([^)]*performedById[^)]*\)/);
    expect(stripped).toMatch(/this\.adminUsersService\.removeRole\([^)]*performedById[^)]*\)/);
  });

  it('every @CurrentUser(\'id\') parameter is typed string (no implicit any leaking through)', () => {
    const stripped = stripComments(src);
    // Find every CurrentUser('id') param and verify it carries `: string`.
    const matches = stripped.match(/@CurrentUser\(['"]id['"]\)\s+\w+\s*:\s*string/g) ?? [];
    // We expect exactly 5 — one per write handler (create, remove, toggle,
    // assignRole, removeRole).
    expect(matches.length).toBe(5);
  });
});
