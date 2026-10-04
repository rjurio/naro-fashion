/**
 * Swagger (`/api/docs`) is exposed in dev, and in production only when
 * explicitly opted in with ENABLE_SWAGGER=true — the full route map is
 * reconnaissance material for an attacker.
 */
export function isSwaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return env.ENABLE_SWAGGER === 'true';
}
