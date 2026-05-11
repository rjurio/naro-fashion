import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * AI controller shape invariants.
 *
 * Phase 1 forbade ALL writes. Phase 2 introduced a small whitelist of
 * @Post handlers (create_product_draft, add_order_note,
 * create_size_guide_entry, create_size). Phase 3.1A adds approval-
 * workflow @Post handlers — initiate (`publish/request-approval` on
 * products) and the approvals-management surface (`/approve`, `/reject`,
 * `/revoke`, `/cancel`, `/execute`).
 *
 * Direct mutation verbs (@Patch / @Put / @Delete) remain forbidden across
 * the entire AI surface until Phase 4 / later. The presence of an
 * `:id/publish` @Post WITHOUT the `/request-approval` suffix would also
 * indicate a leaked direct-write route — the allowlist below enforces
 * the exact path.
 */

// Allowlist: file → array of exact @Post(...) decorator strings allowed in
// that file. Quotes are normalised to single quotes before comparison.
const ALLOWED_POSTS: Record<string, string[]> = {
  'products.ai.controller.ts': [
    `@Post('draft')`,
    `@Post(':id/publish/request-approval')`,
  ],
  'orders.ai.controller.ts': [`@Post(':id/notes')`],
  'size-guide.ai.controller.ts': [`@Post()`],
  'product-sizes.ai.controller.ts': [`@Post()`],
  'approvals.ai.controller.ts': [
    `@Post(':id/approve')`,
    `@Post(':id/reject')`,
    `@Post(':id/revoke')`,
    `@Post(':id/cancel')`,
    `@Post(':id/execute')`,
  ],
};

const FORBIDDEN_DECORATORS = ['@Patch(', '@Put(', '@Delete('];

describe('AI controllers — Phase 2 shape invariants', () => {
  const controllersDir = __dirname;

  const controllerFiles = readdirSync(controllersDir).filter(
    (f) => f.endsWith('.ai.controller.ts') && !f.endsWith('.spec.ts'),
  );

  it('has at least one AI controller', () => {
    expect(controllerFiles.length).toBeGreaterThan(0);
  });

  it.each(controllerFiles)(
    'controller %s has no @Patch / @Put / @Delete (those land in Phase 3)',
    (file) => {
      const stripped = stripComments(
        readFileSync(join(controllersDir, file), 'utf8'),
      );
      for (const decorator of FORBIDDEN_DECORATORS) {
        expect(stripped).not.toContain(decorator);
      }
    },
  );

  it.each(controllerFiles)(
    'controller %s only declares @Post handlers on the Phase 2 allowlist',
    (file) => {
      const stripped = stripComments(
        readFileSync(join(controllersDir, file), 'utf8'),
      );
      const matches = stripped.match(/@Post\([^)]*\)/g) ?? [];
      const allowed = (ALLOWED_POSTS[file] ?? []).map(normalise);
      for (const found of matches) {
        const norm = normalise(found);
        if (!allowed.includes(norm)) {
          throw new Error(
            `Unexpected @Post in ${file}: ${found}. ` +
              `Update ALLOWED_POSTS in ai-controllers.shape.spec.ts or remove the route. ` +
              `Phase 3 (approval workflow) is the right place for new write tools.`,
          );
        }
      }
    },
  );

  it.each(controllerFiles)(
    'controller %s carries the AI guard stack (JwtAuthGuard, AdminGuard, AiPermissionGuard)',
    (file) => {
      const src = readFileSync(join(controllersDir, file), 'utf8');
      // Either via @AiSecured() decorator or the explicit guard list
      // (used by inventory + reports because they also need ModuleGuard).
      const usesAiSecured = src.includes('@AiSecured()');
      const usesExplicitStack =
        src.includes('JwtAuthGuard') &&
        src.includes('AdminGuard') &&
        src.includes('AiPermissionGuard');
      expect(usesAiSecured || usesExplicitStack).toBe(true);
    },
  );
});

function stripComments(src: string): string {
  // Block + line comments — so a doc-comment containing "@Post(" doesn't
  // trigger a false positive in the allowlist check.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function normalise(decoratorStr: string): string {
  return decoratorStr.replace(/"/g, "'");
}
