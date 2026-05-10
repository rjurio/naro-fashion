import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 1 invariant: every AI controller is read-only. There must be NO
 * @Post / @Patch / @Put / @Delete decorators in any AI controller file.
 *
 * This test fails fast if a future change accidentally introduces a
 * write endpoint without going through the approval workflow that's
 * scheduled for Phase 3.
 */
describe('AI controllers Phase 1 read-only invariant', () => {
  const controllersDir = __dirname;

  const controllerFiles = readdirSync(controllersDir).filter(
    (f) => f.endsWith('.ai.controller.ts') && !f.endsWith('.spec.ts'),
  );

  it('has at least one AI controller', () => {
    expect(controllerFiles.length).toBeGreaterThan(0);
  });

  it.each(controllerFiles)(
    'controller %s only declares @Get handlers',
    (file) => {
      const src = readFileSync(join(controllersDir, file), 'utf8');
      // Strip block comments so doc text like "// will be wired in Phase 3"
      // doesn't cause a false positive.
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
      const forbidden = ['@Post(', '@Patch(', '@Put(', '@Delete('];
      for (const decorator of forbidden) {
        expect(stripped).not.toContain(decorator);
      }
    },
  );

  it.each(controllerFiles)(
    'controller %s imports a guard stack (JwtAuthGuard, AdminGuard, AiPermissionGuard)',
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
