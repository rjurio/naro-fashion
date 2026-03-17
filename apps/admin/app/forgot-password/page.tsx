'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import adminApi from '@/lib/api';
import { useSiteSettings } from '@/contexts/SiteSettingsContext';

export default function ForgotPasswordPage() {
  const { settings } = useSiteSettings();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await adminApi.forgotPassword(email);
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
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
            Admin Dashboard — Reset your password to regain access.
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

          {sent ? (
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-[hsl(var(--foreground))] mb-3">Check your email</h2>
              <p className="text-[hsl(var(--muted-foreground))] mb-8">
                If an account exists for <strong>{email}</strong>, we&apos;ve sent a password reset link.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-brand-gold hover:text-brand-gold-dark transition-colors font-medium"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to login
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
                  Forgot password?
                </h2>
                <p className="mt-2 text-[hsl(var(--muted-foreground))]">
                  Enter your email address and we&apos;ll send you a reset link.
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-[hsl(var(--foreground))] mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[hsl(var(--muted-foreground))]" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="admin@example.com"
                      className="w-full pl-11 pr-4 py-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold transition-colors"
                    />
                  </div>
                </div>

                <Button type="submit" variant="primary" size="lg" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending...
                    </span>
                  ) : (
                    'Send Reset Link'
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
