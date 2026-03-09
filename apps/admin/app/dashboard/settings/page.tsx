'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { User, Shield, Bell, Palette, Save, Eye, EyeOff, Monitor, Moon, Sun } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import adminApi from '@/lib/api';

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
  const [selectedTheme, setSelectedTheme] = useState<string>('light');

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
      await adminApi.patch('/auth/me', { firstName, lastName });
      await refreshUser();
      showMsg('Profile updated successfully.', 'success');
    } catch {
      showMsg('Failed to update profile.', 'error');
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
    if (passwords.newPassword.length < 6) {
      showMsg('New password must be at least 6 characters.', 'error');
      return;
    }
    setSaving(true);
    try {
      await adminApi.post('/auth/change-password', {
        currentPassword: passwords.current,
        newPassword: passwords.newPassword,
      });
      setPasswords({ current: '', newPassword: '', confirm: '' });
      showMsg('Password changed successfully.', 'success');
    } catch (err: any) {
      const msg = err?.message?.includes('401') ? 'Current password is incorrect.' : 'Failed to change password.';
      showMsg(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle2FA = async (enabled: boolean) => {
    setTwoFA(enabled);
    try {
      await adminApi.patch('/auth/2fa', { enabled });
      showMsg('Two-factor authentication ' + (enabled ? 'enabled' : 'disabled') + '.', 'success');
    } catch {
      setTwoFA(!enabled);
      showMsg('Failed to update 2FA setting.', 'error');
    }
  };

  const handleThemeChange = (value: string) => {
    setSelectedTheme(value);
    setAppTheme(value);
    showMsg('Theme updated.', 'success');
  };

  const handleSaveNotifications = async () => {
    setSaving(true);
    try {
      await adminApi.post('/cms/settings', {
        key: 'admin_notifications',
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

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <div className="w-11 h-6 bg-[hsl(var(--muted))] peer-focus:ring-2 peer-focus:ring-brand-gold/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-gold"></div>
    </label>
  );

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
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <User className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Profile</h2>
        </div>
        <div className="p-6 space-y-4">
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Shield className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Security</h2>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">Two-Factor Authentication</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Add an extra layer of security to your account</p>
            </div>
            <Toggle checked={twoFA} onChange={handleToggle2FA} />
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
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Palette className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Appearance</h2>
        </div>
        <div className="p-6">
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
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Bell className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Notifications</h2>
        </div>
        <div className="p-6">
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
