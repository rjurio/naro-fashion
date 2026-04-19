"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, User, Phone, AlertCircle, Check, X } from "lucide-react";
import Button from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { useTranslation } from "@/lib/i18n";

function getPasswordStrength(password: string, labels: { weak: string; medium: string; strong: string }): { score: number; label: string } {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return { score: 1, label: labels.weak };
  if (score <= 3) return { score: 2, label: labels.medium };
  return { score: 3, label: labels.strong };
}

export default function RegisterPage() {
  const { t } = useTranslation("auth");
  const { settings } = useSiteSettings();
  const { register, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace("/account");
    }
  }, [authLoading, isAuthenticated, router]);

  const passwordStrength = useMemo(
    () => getPasswordStrength(formData.password, {
      weak: t("passwordWeak"),
      medium: t("passwordMedium"),
      strong: t("passwordStrong"),
    }),
    [formData.password, t],
  );

  const passwordsMatch =
    formData.confirmPassword.length > 0 &&
    formData.password === formData.confirmPassword;
  const passwordsMismatch =
    formData.confirmPassword.length > 0 &&
    formData.password !== formData.confirmPassword;

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: "" }));
    setError("");
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (formData.password.length < 8) {
      errors.password = t("passwordTooShort");
    }
    if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = t("passwordMismatch");
    }
    if (!agreeTerms) {
      errors.terms = t("termsRequired");
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validate()) return;

    setIsLoading(true);
    try {
      await register({
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone || undefined,
      });
      router.push("/account");
    } catch (err: any) {
      const message = err?.data?.message || err?.message || t("registerError");
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const strengthColors = ["", "bg-red-500", "bg-yellow-500", "bg-emerald-500"];
  const strengthWidths = ["", "w-1/3", "w-2/3", "w-full"];

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
            {t("joinCommunity")}
          </h2>
          <p className="mt-4 text-gray-300 text-lg">
            {t("joinCommunityDesc")}
          </p>

          <div className="mt-12 grid grid-cols-2 gap-4">
            {[
              { value: "10K+", label: t("happyCustomers") },
              { value: "500+", label: t("productsLabel") },
              { value: "50+", label: t("designerGowns") },
              { value: "24/7", label: t("support247") },
            ].map((stat) => (
              <div key={stat.label} className="p-4 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10">
                <div className="text-2xl font-bold text-[#D4AF37]">{stat.value}</div>
                <div className="text-sm text-gray-400">{stat.label}</div>
              </div>
            ))}
          </div>
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

          <div className="text-center lg:text-left mb-8">
            <h1 className="text-2xl font-heading font-bold text-foreground">
              {t("createYourAccount")}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {t("haveAccount")}{" "}
              <Link href="/auth/login" className="text-gold-500 hover:text-gold-600 font-medium">
                {t("signIn")}
              </Link>
            </p>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name Fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-foreground mb-1.5">
                  {t("firstName")}
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    id="firstName"
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => updateField("firstName", e.target.value)}
                    placeholder="Amina"
                    required
                    disabled={isLoading}
                    className="w-full rounded-lg border border-border bg-background pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors disabled:opacity-50"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-foreground mb-1.5">
                  {t("lastName")}
                </label>
                <input
                  id="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => updateField("lastName", e.target.value)}
                  placeholder="Kigoma"
                  required
                  disabled={isLoading}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                {t("email")}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  placeholder={t("emailPlaceholder")}
                  required
                  disabled={isLoading}
                  className="w-full rounded-lg border border-border bg-background pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-foreground mb-1.5">
                {t("phoneNumber")}
                <span className="text-muted-foreground font-normal ml-1">{t("optional")}</span>
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  placeholder="+255 7XX XXX XXX"
                  disabled={isLoading}
                  className="w-full rounded-lg border border-border bg-background pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                {t("password")}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => updateField("password", e.target.value)}
                  placeholder={t("createPasswordPlaceholder")}
                  required
                  minLength={8}
                  disabled={isLoading}
                  className={`w-full rounded-lg border bg-background pl-10 pr-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors disabled:opacity-50 ${
                    fieldErrors.password ? "border-red-500" : "border-border"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {/* Password Strength Indicator */}
              {formData.password.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${strengthColors[passwordStrength.score]} ${strengthWidths[passwordStrength.score]}`}
                      />
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        passwordStrength.score === 1
                          ? "text-red-500"
                          : passwordStrength.score === 2
                            ? "text-yellow-500"
                            : "text-emerald-500"
                      }`}
                    >
                      {passwordStrength.label}
                    </span>
                  </div>
                </div>
              )}
              {fieldErrors.password && (
                <p className="mt-1 text-xs text-red-500">{fieldErrors.password}</p>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
                {t("confirmPassword")}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={formData.confirmPassword}
                  onChange={(e) => updateField("confirmPassword", e.target.value)}
                  placeholder={t("confirmPasswordPlaceholder")}
                  required
                  disabled={isLoading}
                  className={`w-full rounded-lg border bg-background pl-10 pr-16 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors disabled:opacity-50 ${
                    fieldErrors.confirmPassword
                      ? "border-red-500"
                      : passwordsMatch
                        ? "border-emerald-500"
                        : "border-border"
                  }`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {passwordsMatch && (
                    <Check className="h-4 w-4 text-emerald-500" />
                  )}
                  {passwordsMismatch && (
                    <X className="h-4 w-4 text-red-500" />
                  )}
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {fieldErrors.confirmPassword && (
                <p className="mt-1 text-xs text-red-500">{fieldErrors.confirmPassword}</p>
              )}
            </div>

            {/* Terms */}
            <div>
              <div className="flex items-start gap-2">
                <input
                  id="terms"
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => {
                    setAgreeTerms(e.target.checked);
                    setFieldErrors((prev) => ({ ...prev, terms: "" }));
                  }}
                  className="h-4 w-4 rounded border-border text-gold-500 focus:ring-gold-500 mt-0.5"
                />
                <label htmlFor="terms" className="text-sm text-muted-foreground">
                  {t("agreeTerms")}{" "}
                  <Link href="/pages/terms" className="text-gold-500 hover:text-gold-600">
                    {t("termsOfService")}
                  </Link>{" "}
                  {t("and")}{" "}
                  <Link href="/pages/privacy" className="text-gold-500 hover:text-gold-600">
                    {t("privacyPolicy")}
                  </Link>
                </label>
              </div>
              {fieldErrors.terms && (
                <p className="mt-1 text-xs text-red-500">{fieldErrors.terms}</p>
              )}
            </div>

            {/* Submit */}
            <Button
              type="submit"
              size="lg"
              loading={isLoading}
              disabled={!agreeTerms}
              className="w-full"
            >
              {t("createAccount")}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-4 text-sm text-muted-foreground">
                {t("orSignUpWith")}
              </span>
            </div>
          </div>

          {/* Social Login - Coming Soon */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled
              className="relative flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-muted-foreground cursor-not-allowed opacity-60 transition-colors"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Google
              <span className="absolute -top-2 -right-2 rounded-full bg-gold-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {t("comingSoon")}
              </span>
            </button>
            <button
              type="button"
              disabled
              className="relative flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-muted-foreground cursor-not-allowed opacity-60 transition-colors"
            >
              <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
              Facebook
              <span className="absolute -top-2 -right-2 rounded-full bg-gold-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {t("comingSoon")}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
