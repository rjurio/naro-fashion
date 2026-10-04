'use client';

import { useState, useEffect } from 'react';
import { Shield } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import adminApi from '@/lib/api';
import TwoFactorSettings from '@/components/auth/TwoFactorSettings';

/**
 * Platform admin account settings. Currently the Security section (TOTP 2FA +
 * recovery codes) — TwoFactorSettings handles platform principals itself.
 */
export default function PlatformSettingsPage() {
  const { user } = useAuth();
  const [twoFA, setTwoFA] = useState(false);
  const [twoFARemaining, setTwoFARemaining] = useState<number | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const profile: any = await adminApi.get('/auth/me');
        if (profile.is2FAEnabled !== undefined) setTwoFA(profile.is2FAEnabled);
        if (typeof profile.twoFARecoveryCodesRemaining === 'number') {
          setTwoFARemaining(profile.twoFARecoveryCodesRemaining);
        }
      } catch {}
    })();
  }, [user]);

  const showMsg = (msg: string, type: 'success' | 'error') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(''), 4000);
  };

  if (!user) return null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Platform Settings</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Your platform administrator account</p>
      </div>

      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            messageType === 'success'
              ? 'bg-green-500/10 text-green-600 border border-green-500/30'
              : 'bg-red-500/10 text-red-600 border border-red-500/30'
          }`}
        >
          {message}
        </div>
      )}

      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Shield className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Security</h2>
        </div>
        <div className="p-4 sm:p-5 md:p-6">
          <TwoFactorSettings
            enabled={twoFA}
            recoveryCodesRemaining={twoFARemaining}
            accountEmail={user.email}
            onEnabledChange={setTwoFA}
            onMessage={showMsg}
          />
        </div>
      </div>
    </div>
  );
}
