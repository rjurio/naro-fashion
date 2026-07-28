import { isSensitiveSettingKey } from './cms.service';

// Regression guard for the 2026-07-28 secret leak: GET /cms/settings is
// @Public() and used to dump the Instagram access token + facebook_app_secret
// to any anonymous caller. findAllSettings() now filters via
// isSensitiveSettingKey(); this locks the matcher's behaviour so a future
// edit can't silently re-expose a token.
describe('isSensitiveSettingKey', () => {
  it.each([
    'instagram_access_token',
    'facebook_app_secret',
    'clickpesa_api_key',
    'selcom_client_secret',
    'smtp_password',
    'some_apikey',
  ])('treats %s as sensitive (stripped from public settings)', (key) => {
    expect(isSensitiveSettingKey(key)).toBe(true);
  });

  it.each([
    'site_name',
    'contact_email',
    'instagram_sync_interval',
    'instagram_feed_layout',
    'parallax_enabled',
    'meta_keywords',
    // Durations that merely contain the word "token" are NOT secrets and the
    // admin settings page reads them to show the current session timeout.
    'auth_access_token_expires',
    'auth_refresh_token_expires',
  ])('treats %s as public-safe', (key) => {
    expect(isSensitiveSettingKey(key)).toBe(false);
  });
});
