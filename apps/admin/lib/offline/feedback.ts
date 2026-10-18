/**
 * Shared wording for offline-aware pages (admin offline mode, Phase 4).
 */

/** Toast after a write was queued on this device instead of reaching the server. */
export const SAVED_OFFLINE_MESSAGE = 'Saved on this device — will sync when online';

/** Tooltip / hint on actions that can't run offline. */
export const NEEDS_INTERNET = 'Needs internet';

/** Title attribute for an action that is disabled because the API can't be reached. */
export function needsInternetTitle(online: boolean, normalTitle?: string): string | undefined {
  return online ? normalTitle : `${NEEDS_INTERNET}${normalTitle ? ` — ${normalTitle}` : ''}`;
}

/** Shown on rows that only exist on this device yet (delete/toggle wait until they sync). */
export const LOCAL_ONLY_HINT = 'Not on the server yet — available after it syncs';
