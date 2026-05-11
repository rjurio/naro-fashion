import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';

/**
 * Global identity-attribution invariant — 2026-05-11.
 *
 * `req.user.sub` is a footgun. JwtStrategy.validate() returns the
 * resolved AdminUser / User / PlatformAdmin row from Prisma — which
 * carries `id`. The raw JWT payload's `sub` field is NEVER preserved
 * onto req.user. Any controller or service that reads `req.user.sub`
 * (or `req.user?.sub`) gets `undefined`, silently breaking:
 *   - self-modification guards (`if (targetId === performedById)`)
 *   - audit attribution (AdminActivityLog.adminUserId becomes null)
 *   - forensic columns (createdBy, performedBy, closedBy, assignedBy …)
 *
 * This test walks every .ts file under apps/api/src and asserts that
 * `req.user.sub` / `req.user?.sub` / `.user.sub` patterns do NOT appear
 * in runtime code. Comments and spec files are excluded — they
 * legitimately discuss the bug story.
 *
 * Allowed: `payload.sub`. The JWT payload itself (the object you get
 * from jwtService.verify / decode) has `sub` — and reading it there is
 * correct. The forbidden pattern is reading `.sub` off a user-shape
 * object that came through JwtStrategy.validate().
 */

const SRC_ROOT = join(__dirname, '..', '..', 'src');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (s.isFile() && full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// Spec files legitimately discuss the bug (the admin-users shape spec
// and the regression specs in this PR scan for the forbidden pattern,
// so they MUST contain literal `req.user.sub` in regex form).
function isSpecFile(path: string): boolean {
  return path.endsWith('.spec.ts');
}

// This invariant file references the pattern itself — exclude.
function isSelf(path: string): boolean {
  return path.endsWith(`${sep}req-user-sub.invariant.spec.ts`);
}

describe('Global invariant — req.user.sub must not appear in runtime API code', () => {
  let allFiles: string[];

  beforeAll(() => {
    allFiles = listTsFiles(SRC_ROOT);
  });

  it('finds files to scan (sanity)', () => {
    expect(allFiles.length).toBeGreaterThan(50);
  });

  it('does NOT contain `req.user.sub` or `req.user?.sub` in any non-spec .ts file', () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      if (isSpecFile(file) || isSelf(file)) continue;
      const stripped = stripComments(readFileSync(file, 'utf8'));
      if (/req\.user\??\.sub\b/.test(stripped)) {
        offenders.push(file);
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `req.user.sub must not appear in runtime code. ` +
          `Use @CurrentUser('id') or req.user?.id instead.\n` +
          `Offending files:\n  - ${offenders.join('\n  - ')}`,
      );
    }
  });

  it('does NOT contain `user.sub` accesses off user-shape objects in non-spec .ts files', () => {
    // Catches patterns like `user.id ?? user.sub` (the AI guard dead-code
    // fallback we just removed) without flagging legitimate `payload.sub`
    // reads inside JwtStrategy / AuthService.
    const offenders: Array<{ file: string; line: string }> = [];
    for (const file of allFiles) {
      if (isSpecFile(file) || isSelf(file)) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      const lines = src.split(/\r?\n/);
      lines.forEach((line) => {
        // Match `.sub` preceded by `user` (with optional `?`), but NOT
        // preceded by `payload` (the JWT-payload object is allow-listed).
        if (/\buser\??\.sub\b/.test(line) && !/payload\??\.sub\b/.test(line)) {
          offenders.push({ file, line: line.trim() });
        }
      });
    }
    if (offenders.length > 0) {
      throw new Error(
        `user.sub access detected on user-shape objects. ` +
          `JwtStrategy.validate() returns id, not sub. ` +
          `Use user.id (or @CurrentUser('id')) instead.\n` +
          offenders.map((o) => `  ${o.file}:\n    ${o.line}`).join('\n'),
      );
    }
  });

  it('payload.sub access is permitted (allow-list for JWT payload objects)', () => {
    // Document the legitimate sites. These are JWT payload reads, not
    // req.user reads, and are the canonical pattern. If this set ever
    // expands (e.g. new auth flow), update the count.
    const payloadSubFiles: string[] = [];
    for (const file of allFiles) {
      if (isSpecFile(file) || isSelf(file)) continue;
      const stripped = stripComments(readFileSync(file, 'utf8'));
      if (/\bpayload\??\.sub\b/.test(stripped)) {
        payloadSubFiles.push(file);
      }
    }
    // We expect these two auth files to legitimately read payload.sub.
    // If the list grows unexpectedly, this test draws attention to the
    // new site so the author can justify it.
    const expected = ['auth.service.ts', 'jwt.strategy.ts'];
    const basenames = payloadSubFiles.map((f) => f.split(/[\\/]/).pop());
    const unexpected = basenames.filter((b) => !expected.includes(b!));
    expect(unexpected).toEqual([]);
  });
});
