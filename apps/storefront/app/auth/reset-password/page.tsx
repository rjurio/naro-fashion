"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle, AlertTriangle, ArrowLeft } from "lucide-react";
import Button from "@/components/ui/Button";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { useTranslation } from "@/lib/i18n";
import { authApi } from "@/lib/api";

function ResetPasswordForm() {
  const { t } = useTranslation("auth");
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(t("passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }
    if (!token) {
      setError(t("noResetToken"));
      return;
    }

    setIsLoading(true);
    try {
      await authApi.resetPassword({ token, newPassword });
      setSuccess(true);
    } catch (err: any) {
      const message = err?.data?.message || err?.message || t("invalidResetToken");
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  // Success state
  if (success) {
    return (
      <div className="text-center space-y-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center">
          <CheckCircle className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="text-2xl font-heading font-bold text-foreground">
          {t("passwordResetSuccess")}
        </h1>
        <p className="text-muted-foreground">
          {t("passwordResetSuccessDesc")}
        </p>
        <div className="pt-4">
          <Link href="/auth/login">
            <Button className="w-full">{t("goToLogin")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Missing token warning
  if (!token) {
    return (
      <div className="text-center space-y-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center">
          <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-2xl font-heading font-bold text-foreground">
          {t("noResetToken")}
        </h1>
        <p className="text-muted-foreground">
          {t("noResetTokenDesc")}
        </p>
        <div className="pt-4 space-y-3">
          <Link href="/auth/forgot-password">
            <Button className="w-full">{t("requestNewLink")}</Button>
          </Link>
          <Link href="/auth/login">
            <Button variant="ghost" className="w-full gap-1.5">
              <ArrowLeft className="h-4 w-4" />
              {t("backToLogin")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="text-center lg:text-left mb-8">
        <h1 className="text-2xl font-heading font-bold text-foreground">
          {t("resetPasswordTitle")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t("resetPasswordDesc")}
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* New Password */}
        <div>
          <label htmlFor="newPassword" className="block text-sm font-medium text-foreground mb-1.5">
            {t("newPassword")}
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              id="newPassword"
              type={showPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("createPasswordPlaceholder")}
              required
              minLength={8}
              disabled={isLoading}
              className="w-full rounded-lg border border-border bg-background pl-10 pr-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
            {t("confirmNewPassword")}
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("confirmPasswordPlaceholder")}
              required
              disabled={isLoading}
              className={`w-full rounded-lg border bg-background pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors disabled:opacity-50 ${
                confirmPassword.length > 0 && newPassword === confirmPassword
                  ? "border-emerald-500"
                  : confirmPassword.length > 0 && newPassword !== confirmPassword
                    ? "border-red-500"
                    : "border-border"
              }`}
            />
          </div>
        </div>

        <Button type="submit" size="lg" loading={isLoading} className="w-full">
          {t("resetPassword")}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Link href="/auth/login" className="inline-flex items-center gap-1.5 text-sm text-gold-500 hover:text-gold-600 font-medium">
          <ArrowLeft className="h-4 w-4" />
          {t("backToLogin")}
        </Link>
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
  const { settings } = useSiteSettings();

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Panel - Brand */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A] items-center justify-center p-12">
        <div className="absolute inset-0 bg-gradient-to-r from-[#D4AF37]/10 to-[#D4AF37]/10" />
        <div className="absolute top-20 right-10 w-64 h-64 rounded-full bg-[#D4AF37]/10 blur-3xl" />
        <div className="absolute bottom-20 left-10 w-80 h-80 rounded-full bg-[#D4AF37]/10 blur-3xl" />

        <div className="relative z-10 max-w-md">
          <Link href="/" className="inline-block mb-8">
            <Image src={settings.logoUrl} alt={settings.businessName} width={280} height={140} className="rounded-lg" unoptimized />
          </Link>
          <h2 className="text-3xl font-heading font-bold text-white leading-tight">
            Create a new password
          </h2>
          <p className="mt-4 text-gray-300 text-lg">
            Choose a strong password to keep your account secure.
          </p>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden text-center mb-8">
            <Link href="/">
              <Image src={settings.iconUrl} alt={settings.businessName} width={64} height={64} className="mx-auto rounded-full" unoptimized />
              <span className="block mt-2 text-2xl font-heading font-bold text-gold-500">{settings.businessName.toUpperCase()}</span>
            </Link>
          </div>

          <Suspense fallback={<div className="text-center text-muted-foreground">Loading...</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
