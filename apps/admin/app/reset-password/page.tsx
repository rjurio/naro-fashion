'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Lock, ArrowLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import Button from '@/components/ui/Button';
import adminApi from '@/lib/api';
import { useSiteSettings } from '@/contexts/SiteSettingsContext';

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const { settings } = useSiteSettings();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!token) {
      setError('Invalid or missing reset token.');
      return;
    }

    setIsLoading(true);
    try {
      await adminApi.resetPassword(token, password);
      setSuccess(true);
    } catch {
      setError('Invalid or expired reset token. Please request a new one.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-brand-black relative overflow-hidden items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-gold/20 via-transparent to-brand-gold/20" />
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-brand-gold/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-brand-gold/10 rounded-full blur-3xl" />
        <div className="relative z-10 text-center px-12">
          <div className="mb-8">
            <Image src={settings.logoUrl} alt={settings.businessName} width={320} height={160} className="mx-auto rounded-lg" priority unoptimized />
          </div>
          <p className="text-white/70 text-lg max-w-md">
            Admin Dashboard — Set your new password.
          </p>
        </div>
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-[hsl(var(--background))]">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-10">
            <Image src={settings.iconUrl} alt={settings.businessName} width={80} height={80} className="mx-auto rounded-full" unoptimized />
            <h1 className="text-2xl font-bold text-brand-gold mt-3">{settings.businessName.toUpperCase()}</h1>
          </div>

          {success ? (
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-[hsl(var(--foreground))] mb-3">Password Reset!</h2>
              <p className="text-[hsl(var(--muted-foreground))] mb-8">
                Your password has been reset successfully. You can now log in with your new password.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-brand-gold hover:text-brand-gold-dark transition-colors font-medium"
              >
                <ArrowLeft className="w-4 h-4" />
                Go to Login
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors mb-6"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to login
                </Link>
                <h2 className="text-2xl font-bold text-[hsl(var(--foreground))]">
                  Reset Password
                </h2>
                <p className="mt-2 text-[hsl(var(--muted-foreground))]">
                  Enter your new password below.
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              {!token && (
                <div className="mb-6 p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400 text-sm">
                  No reset token found. Please use the link from your password reset email, or{' '}
                  <Link href="/forgot-password" className="underline font-medium">request a new one</Link>.
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-[hsl(var(--foreground))] mb-2">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[hsl(var(--muted-foreground))]" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder="Enter new password"
                      className="w-full pl-11 pr-12 py-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-[hsl(var(--foreground))] mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[hsl(var(--muted-foreground))]" />
                    <input
                      id="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder="Confirm new password"
                      className="w-full pl-11 pr-4 py-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold transition-colors"
                    />
                  </div>
                </div>

                <Button type="submit" variant="primary" size="lg" className="w-full" disabled={isLoading || !token}>
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Resetting...
                    </span>
                  ) : (
                    'Reset Password'
                  )}
                </Button>
              </form>
            </>
          )}

          <p className="mt-8 text-center text-xs text-[hsl(var(--muted-foreground))]">
            {settings.businessName} Admin Panel v1.0
          </p>
        </div>
      </div>
    </div>
  );
}
