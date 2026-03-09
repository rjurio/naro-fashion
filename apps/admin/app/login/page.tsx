'use client';

import { useState } from 'react';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import Button from '@/components/ui/Button';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Simulated login — replace with real API call
      await new Promise((resolve) => setTimeout(resolve, 1500));

      if (email === 'admin@narofashion.co.tz' && password === 'admin123') {
        window.location.href = '/dashboard';
      } else {
        setError('Invalid email or password');
      }
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
        {/* Decorative gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-gold/20 via-transparent to-brand-gold/20" />
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-brand-gold/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-brand-gold/10 rounded-full blur-3xl" />

        <div className="relative z-10 text-center px-12">
          {/* Logo */}
          <div className="mb-8">
            <h1 className="text-5xl font-bold">
              <span className="text-brand-gold">NARO</span>
              <span className="text-brand-gold ml-3">FASHION</span>
            </h1>
            <div className="mt-2 h-0.5 w-24 mx-auto bg-gradient-to-r from-brand-gold to-brand-gold" />
          </div>
          <p className="text-white/70 text-lg max-w-md">
            Admin Dashboard — Manage your products, orders, rentals, and customers all in one place.
          </p>
        </div>
      </div>

      {/* Right login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-[hsl(var(--background))]">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-10">
            <h1 className="text-3xl font-bold">
              <span className="text-brand-gold">NARO</span>
              <span className="text-brand-gold ml-2">FASHION</span>
            </h1>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-[hsl(var(--foreground))]">
              Welcome back
            </h2>
            <p className="mt-2 text-[hsl(var(--muted-foreground))]">
              Sign in to your admin account
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-[hsl(var(--foreground))] mb-2"
              >
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
                  placeholder="admin@narofashion.co.tz"
                  className="w-full pl-11 pr-4 py-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[hsl(var(--foreground))] mb-2"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[hsl(var(--muted-foreground))]" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Enter your password"
                  className="w-full pl-11 pr-12 py-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-[hsl(var(--border))] text-brand-gold focus:ring-brand-gold"
                />
                <span className="text-sm text-[hsl(var(--muted-foreground))]">Remember me</span>
              </label>
              <a
                href="#"
                className="text-sm text-brand-gold hover:text-brand-gold-dark transition-colors"
              >
                Forgot password?
              </a>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-[hsl(var(--muted-foreground))]">
            Naro Fashion Admin Panel v1.0
          </p>
        </div>
      </div>
    </div>
  );
}
