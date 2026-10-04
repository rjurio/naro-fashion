import { isAbsolute, join, relative, resolve, sep } from 'path';

/**
 * Private (never publicly served) storage for evidence files such as
 * customer National ID scans.
 *
 * Root: env PRIVATE_UPLOAD_DIR, default `<cwd>/private-uploads` (cwd is
 * apps/api in prod, so `apps/api/private-uploads/`). The root MUST be outside
 * the ServeStaticModule root (`<cwd>/uploads`) — `resolvePrivateRoot` refuses
 * a configuration that would nest it inside and falls back to the default.
 *
 * Layout: <root>/id-documents/<tenantId>/<32-hex>.<ext>
 * Opaque reference stored in the DB: private://id-documents/<tenantId>/<file>
 */
export const PRIVATE_REF_PREFIX = 'private://id-documents/';
export const ID_DOC_FILE_RE = /^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/;
export const TENANT_SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function publicUploadsRoot(cwd: string = process.cwd()): string {
  return resolve(join(cwd, 'uploads'));
}

export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function resolvePrivateRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const fallback = resolve(join(cwd, 'private-uploads'));
  const configured = env.PRIVATE_UPLOAD_DIR ? resolve(cwd, env.PRIVATE_UPLOAD_DIR) : fallback;
  if (isInside(publicUploadsRoot(cwd), configured)) {
    // Would be web-served by ServeStaticModule — never allow that.
    return fallback;
  }
  return configured;
}

export function buildIdDocRef(tenantId: string, fileName: string): string {
  return `${PRIVATE_REF_PREFIX}${tenantId}/${fileName}`;
}

/**
 * Parse an ID-document key into {tenantId, fileName}. Accepts either the
 * full reference (`private://id-documents/<tenant>/<file>`), the
 * `id-documents/<tenant>/<file>` form, or `<tenant>/<file>`. Returns null for
 * anything malformed — including any `..`, extra separators, or characters
 * outside the strict whitelists, which makes path traversal impossible.
 */
export function parseIdDocKey(raw: string | undefined | null): { tenantId: string; fileName: string } | null {
  if (!raw || typeof raw !== 'string' || raw.length > 200) return null;
  let key = raw.trim();
  if (key.startsWith(PRIVATE_REF_PREFIX)) key = key.slice(PRIVATE_REF_PREFIX.length);
  else if (key.startsWith('id-documents/')) key = key.slice('id-documents/'.length);
  const parts = key.split('/');
  if (parts.length !== 2) return null;
  const [tenantId, fileName] = parts;
  if (!TENANT_SEGMENT_RE.test(tenantId) || !ID_DOC_FILE_RE.test(fileName)) return null;
  return { tenantId, fileName };
}

/** Absolute path for a parsed key, asserting it stays inside the root. */
export function idDocAbsolutePath(root: string, tenantId: string, fileName: string): string | null {
  const base = resolve(join(root, 'id-documents'));
  const full = resolve(join(base, tenantId, fileName));
  if (!isInside(base, full) || full === base || !full.startsWith(base + sep)) return null;
  return full;
}
