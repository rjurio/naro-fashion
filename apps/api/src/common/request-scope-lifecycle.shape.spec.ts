import * as fs from 'fs';
import * as path from 'path';

/**
 * Nest never calls lifecycle hooks (onModuleInit, onApplicationBootstrap, …)
 * or registers @Cron/@Interval/@Timeout handlers on REQUEST-scoped providers.
 * Injecting the request-scoped TenantContext (or REQUEST) makes a provider
 * request-scoped implicitly — so a seeding hook or cron on such a service
 * silently never runs. This bit us three times (system roles, expense
 * categories, product sizes were never seeded in production).
 *
 * Rule: a file that injects TenantContext / REQUEST must not declare lifecycle
 * hooks or scheduled handlers. Put those in a singleton (PrismaService-only)
 * seeder or cron class instead.
 */
const SRC = path.join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const INJECTS_REQUEST_SCOPE = /constructor\s*\([^)]*\b(TenantContext|@Inject\(\s*REQUEST\s*\))/s;
const HAS_LIFECYCLE =
  /\b(async\s+)?(onModuleInit|onApplicationBootstrap|onModuleDestroy|beforeApplicationShutdown|onApplicationShutdown)\s*\(|@(Cron|Interval|Timeout)\s*\(/;

describe('request-scoped providers have no lifecycle hooks or scheduled handlers', () => {
  it('no file both injects TenantContext/REQUEST and declares a hook/cron', () => {
    const offenders = walk(SRC)
      .filter((f) => {
        const src = stripComments(fs.readFileSync(f, 'utf8'));
        return INJECTS_REQUEST_SCOPE.test(src) && HAS_LIFECYCLE.test(src);
      })
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
