'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { User, Shield, Bell, Palette, Save, Eye, EyeOff, Monitor, Moon, Sun, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import adminApi from '@/lib/api';
import { validatePassword, PASSWORD_HINT, PASSWORD_MAX_LENGTH } from '@/lib/password-policy';

const TWO_FA_UNAVAILABLE_MSG = 'Two-factor authentication is not available yet.';

export default function AdminSettingsPage() {
  const { user, refreshUser } = useAuth();
  const { theme, setTheme: setAppTheme } = useTheme();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  const [passwords, setPasswords] = useState({
    current: '',
    newPassword: '',
    confirm: '',
  });
  const [showPasswords, setShowPasswords] = useState(false);

  const [twoFA, setTwoFA] = useState(false);
  const [twoFASaving, setTwoFASaving] = useState(false);
  // Server message once the API reports 2FA as not available.
  const [twoFAUnavailable, setTwoFAUnavailable] = useState<string | null>(null);
  // Inline "confirm with current password" step for disabling 2FA.
  const [twoFADisabling, setTwoFADisabling] = useState(false);
  const [twoFADisablePassword, setTwoFADisablePassword] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<string>('light');

  // Session timing — backed by SiteSetting keys auth_access_token_expires
  // and auth_refresh_token_expires. Empty = use platform defaults (15m / 7d).
  const [accessExpires, setAccessExpires] = useState<string>('');
  const [refreshExpires, setRefreshExpires] = useState<string>('');
  const [savingTiming, setSavingTiming] = useState(false);

  const [notifications, setNotifications] = useState({
    emailOrders: true,
    smsOrders: false,
    emailRentals: true,
    smsRentals: true,
    emailLowStock: true,
    smsLowStock: false,
  });

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName);
      setLastName(user.lastName);
      setEmail(user.email);
    }
  }, [user]);

  useEffect(() => {
    if (theme) setSelectedTheme(theme);
  }, [theme]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings: any[] = await adminApi.get('/cms/settings');
        const notifSetting = settings.find((s: any) => s.key === 'admin_notifications');
        if (notifSetting) {
          try { setNotifications(JSON.parse(notifSetting.value)); } catch {}
        }
        const access = settings.find((s: any) => s.key === 'auth_access_token_expires');
        if (access?.value) setAccessExpires(access.value);
        const refresh = settings.find((s: any) => s.key === 'auth_refresh_token_expires');
        if (refresh?.value) setRefreshExpires(refresh.value);
      } catch {}
      try {
        const profile: any = await adminApi.get('/auth/me');
        if (profile.is2FAEnabled !== undefined) setTwoFA(profile.is2FAEnabled);
      } catch {}
    };
    if (user) loadSettings();
  }, [user]);

  const showMsg = (msg: string, type: 'success' | 'error') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(''), 4000);
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await adminApi.updateProfile({ firstName, lastName });
      await refreshUser();
      showMsg('Profile updated successfully.', 'success');
    } catch (err: any) {
      showMsg(err?.message || 'Failed to update profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!passwords.current || !passwords.newPassword) {
      showMsg('Please fill in current and new password.', 'error');
      return;
    }
    if (passwords.newPassword !== passwords.confirm) {
      showMsg('New passwords do not match.', 'error');
      return;
    }
    const policyError = validatePassword(passwords.newPassword);
    if (policyError) {
      showMsg(policyError, 'error');
      return;
    }
    setSaving(true);
    try {
      // changePassword() persists the fresh token pair the API returns
      // (tokenVersion is bumped, so the old tokens stop working).
      await adminApi.changePassword(passwords.current, passwords.newPassword);
      setPasswords({ current: '', newPassword: '', confirm: '' });
      showMsg('Password changed successfully. Other sessions have been signed out.', 'success');
    } catch (err: any) {
      const msg = err?.status === 401
        ? (err?.message || 'Current password is incorrect.')
        : (err?.message || 'Failed to change password.');
      showMsg(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Enabling 2FA always returns 400 "not available yet" until a real second
  // factor ships, so the toggle is only actionable for turning it OFF (legacy
  // rows with is2FAEnabled=true), which requires the current password.
  const handleToggle2FA = (enabled: boolean) => {
    if (twoFASaving) return;
    if (enabled) {
      showMsg(TWO_FA_UNAVAILABLE_MSG, 'error');
      return;
    }
    setTwoFADisablePassword('');
    setTwoFADisabling(true);
  };

  const confirmDisable2FA = async () => {
    if (!twoFADisablePassword) {
      showMsg('Enter your current password to disable two-factor authentication.', 'error');
      return;
    }
    setTwoFASaving(true);
    try {
      await adminApi.toggle2FA(false, twoFADisablePassword);
      setTwoFA(false);
      setTwoFADisabling(false);
      setTwoFADisablePassword('');
      showMsg('Two-factor authentication disabled.', 'success');
    } catch (err: any) {
      const msg: string = err?.message || '';
      if (err?.status === 400 && /not available/i.test(msg)) setTwoFAUnavailable(msg);
      showMsg(msg || 'Failed to update 2FA setting.', 'error');
    } finally {
      setTwoFASaving(false);
    }
  };

  // Format like "15m", "2h", "8h", "7d"
  const isValidDuration = (v: string) => /^(\d+)\s*(s|m|h|d)$/i.test(v.trim());

  const handleSaveTiming = async () => {
    if (accessExpires && !isValidDuration(accessExpires)) {
      showMsg('Session timeout: use a value like "15m", "2h", "8h".', 'error');
      return;
    }
    if (refreshExpires && !isValidDuration(refreshExpires)) {
      showMsg('Stay-signed-in duration: use a value like "1d", "7d", "30d".', 'error');
      return;
    }
    setSavingTiming(true);
    try {
      // Empty string clears the override and falls back to platform defaults.
      // The API endpoint accepts the value verbatim; backend re-validates ranges.
      if (accessExpires.trim()) {
        await adminApi.patch('/cms/settings/auth_access_token_expires', { value: accessExpires.trim() });
      }
      if (refreshExpires.trim()) {
        await adminApi.patch('/cms/settings/auth_refresh_token_expires', { value: refreshExpires.trim() });
      }
      showMsg('Session timing saved. Changes apply on next login.', 'success');
    } catch (err: any) {
      showMsg(err?.message || 'Failed to save session timing.', 'error');
    } finally {
      setSavingTiming(false);
    }
  };

  const ACCESS_PRESETS = ['15m', '30m', '1h', '2h', '4h', '8h', '24h'];
  const REFRESH_PRESETS = ['1d', '7d', '14d', '30d', '90d'];

  const handleThemeChange = (value: string) => {
    setSelectedTheme(value);
    setAppTheme(value);
    showMsg('Theme updated.', 'success');
  };

  const handleSaveNotifications = async () => {
    setSaving(true);
    try {
      await adminApi.patch('/cms/settings/admin_notifications', {
        value: JSON.stringify(notifications),
      });
      showMsg('Notification preferences saved.', 'success');
    } catch {
      showMsg('Failed to save notification preferences.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const sessions = [
    { device: 'Chrome on Windows 11', ip: '196.41.xx.xx', lastActive: 'Now (current)', current: true },
    { device: 'Safari on iPhone', ip: '196.41.xx.xx', lastActive: '2 hours ago', current: false },
  ];

  const Toggle = ({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
    <label className={`relative inline-flex items-center ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <div className="w-11 h-6 bg-[hsl(var(--muted))] peer-focus:ring-2 peer-focus:ring-brand-gold/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-gold"></div>
    </label>
  );

  if (!user) return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-gold" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Admin Settings</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
          Manage your profile, security, and preferences
        </p>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm border ${
          messageType === 'success'
            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
            : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 border-red-200 dark:border-red-800'
        }`}>
          {message}
        </div>
      )}

      {/* Profile */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <User className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Profile</h2>
        </div>
        <div className="p-4 sm:p-5 md:p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Email</label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] cursor-not-allowed"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveProfile} disabled={saving}>
              <Save className="w-4 h-4" />
              Save Profile
            </Button>
          </div>

          <div className="pt-4 border-t border-[hsl(var(--border))]">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3">Change Password</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Current Password', key: 'current' as const },
                { label: 'New Password', key: 'newPassword' as const },
                { label: 'Confirm New Password', key: 'confirm' as const },
              ].map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">{field.label}</label>
                  <div className="relative">
                    <input
                      type={showPasswords ? 'text' : 'password'}
                      value={passwords[field.key]}
                      onChange={(e) => setPasswords({ ...passwords, [field.key]: e.target.value })}
                      className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 pr-10 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
                      placeholder="********"
                      maxLength={PASSWORD_MAX_LENGTH}
                    />
                    {field.key === 'current' && (
                      <button
                        type="button"
                        onClick={() => setShowPasswords(!showPasswords)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                      >
                        {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">{PASSWORD_HINT} Changing it signs out your other sessions.</p>
            <div className="flex justify-end mt-4">
              <Button onClick={handleChangePassword} disabled={saving}>
                <Shield className="w-4 h-4" />
                Change Password
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Security */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Shield className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Security</h2>
        </div>
        <div className="p-4 sm:p-5 md:p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">Two-Factor Authentication</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                {twoFA
                  ? 'Enabled on this account. You can turn it off (requires your current password).'
                  : (twoFAUnavailable || `${TWO_FA_UNAVAILABLE_MSG} It will appear here once supported.`)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {twoFASaving && <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />}
              {/* Only actionable when ON (to disable) — enabling isn't offered by the API yet. */}
              <Toggle checked={twoFA} onChange={handleToggle2FA} disabled={!twoFA || twoFASaving || twoFADisabling} />
            </div>
          </div>
          {twoFADisabling && (
            <div className="flex flex-col sm:flex-row sm:items-end gap-2 rounded-lg border border-[hsl(var(--border))] p-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">Current password</label>
                <input
                  type="password"
                  autoFocus
                  value={twoFADisablePassword}
                  onChange={(e) => setTwoFADisablePassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmDisable2FA(); }}
                  maxLength={PASSWORD_MAX_LENGTH}
                  className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setTwoFADisabling(false); setTwoFADisablePassword(''); }} disabled={twoFASaving}>
                  Cancel
                </Button>
                <Button onClick={confirmDisable2FA} disabled={twoFASaving}>
                  {twoFASaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Disable 2FA
                </Button>
              </div>
            </div>
          )}

          {/* Session Timing — adjustable JWT expiration */}
          <div className="pt-4 border-t border-[hsl(var(--border))] space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Session Timing</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                How long admin sessions stay valid. Changes apply on the next login — your current session keeps its existing timing.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Access token / Session timeout */}
              <div>
                <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1.5">
                  Session Timeout
                </label>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2">
                  Time before the access token expires (silently refreshes in the background).
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {ACCESS_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setAccessExpires(p)}
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                        accessExpires === p
                          ? 'bg-brand-gold text-black border-brand-gold font-semibold'
                          : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-brand-gold hover:text-brand-gold'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={accessExpires}
                  onChange={(e) => setAccessExpires(e.target.value)}
                  placeholder="Custom (e.g. 15m, 2h, 8h) — leave empty for default"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-brand-gold/30"
                  aria-label="Session timeout custom duration"
                />
              </div>

              {/* Refresh token / Stay-signed-in */}
              <div>
                <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1.5">
                  Stay-Signed-In Duration
                </label>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2">
                  Time before the user must fully log in again with email + password.
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {REFRESH_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setRefreshExpires(p)}
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                        refreshExpires === p
                          ? 'bg-brand-gold text-black border-brand-gold font-semibold'
                          : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-brand-gold hover:text-brand-gold'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={refreshExpires}
                  onChange={(e) => setRefreshExpires(e.target.value)}
                  placeholder="Custom (e.g. 1d, 7d, 30d) — leave empty for default"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-brand-gold/30"
                  aria-label="Stay-signed-in custom duration"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              <span>Limits:</span>
              <span>Session ≤ 24h</span>
              <span>•</span>
              <span>Stay-signed-in ≤ 90d</span>
              <span>•</span>
              <span>Allowed units: s, m, h, d</span>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveTiming} disabled={savingTiming}>
                {savingTiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Timing
              </Button>
            </div>
          </div>

          <div className="pt-4 border-t border-[hsl(var(--border))]">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3">Active Sessions</h3>
            <div className="space-y-3">
              {sessions.map((session, i) => (
                <div key={i} className="flex items-center justify-between bg-[hsl(var(--muted))] rounded-lg px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                      {session.device}
                      {session.current && <span className="ml-2 text-xs text-brand-gold font-semibold">(Current)</span>}
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">IP: {session.ip} &middot; {session.lastActive}</p>
                  </div>
                  {!session.current && (
                    <Button variant="danger" size="sm">Revoke</Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Theme */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Palette className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Appearance</h2>
        </div>
        <div className="p-4 sm:p-5 md:p-6">
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Choose the admin panel theme</p>
          <div className="grid grid-cols-3 gap-3 max-w-md">
            {[
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'luxury', label: 'Luxury', icon: Monitor },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => handleThemeChange(value)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  selectedTheme === value
                    ? 'border-brand-gold bg-brand-gold/5 text-brand-gold'
                    : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--foreground))]'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Bell className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Notifications</h2>
        </div>
        <div className="p-4 sm:p-5 md:p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[hsl(var(--muted-foreground))]">
                  <th className="pb-3 font-medium">Alert Type</th>
                  <th className="pb-3 font-medium text-center">Email</th>
                  <th className="pb-3 font-medium text-center">SMS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {[
                  { label: 'Order Alerts', emailKey: 'emailOrders' as const, smsKey: 'smsOrders' as const, desc: 'New orders, cancellations, refunds' },
                  { label: 'Rental Reminders', emailKey: 'emailRentals' as const, smsKey: 'smsRentals' as const, desc: 'Pickup, return, and overdue reminders' },
                  { label: 'Low Stock Alerts', emailKey: 'emailLowStock' as const, smsKey: 'smsLowStock' as const, desc: 'Products below minimum stock level' },
                ].map((item) => (
                  <tr key={item.emailKey}>
                    <td className="py-4">
                      <p className="font-medium text-[hsl(var(--foreground))]">{item.label}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{item.desc}</p>
                    </td>
                    <td className="py-4 text-center">
                      <div className="flex justify-center">
                        <Toggle
                          checked={notifications[item.emailKey]}
                          onChange={(v) => setNotifications({ ...notifications, [item.emailKey]: v })}
                        />
                      </div>
                    </td>
                    <td className="py-4 text-center">
                      <div className="flex justify-center">
                        <Toggle
                          checked={notifications[item.smsKey]}
                          onChange={(v) => setNotifications({ ...notifications, [item.smsKey]: v })}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={handleSaveNotifications} disabled={saving}>
              <Save className="w-4 h-4" />
              Save Notifications
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
