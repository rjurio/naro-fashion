"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Mail, ArrowLeft, CheckCircle } from "lucide-react";
import Button from "@/components/ui/Button";
import { useTranslation } from "@/lib/i18n";

export default function ForgotPasswordPage() {
  const { t } = useTranslation("auth");
  const { t: tc } = useTranslation("common");
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setSent(true);
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Panel - Brand */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A] items-center justify-center p-12">
        <div className="absolute inset-0 bg-gradient-to-r from-[#D4AF37]/10 to-[#D4AF37]/10" />
        <div className="absolute top-20 right-10 w-64 h-64 rounded-full bg-[#D4AF37]/10 blur-3xl" />
        <div className="absolute bottom-20 left-10 w-80 h-80 rounded-full bg-[#D4AF37]/10 blur-3xl" />

        <div className="relative z-10 max-w-md">
          <Link href="/" className="inline-block mb-8">
            <Image src="/logo.jpg" alt="Naro Fashion" width={280} height={140} className="rounded-lg" />
          </Link>
          <h2 className="text-3xl font-heading font-bold text-white leading-tight">
            {t("resetTitle")}
          </h2>
          <p className="mt-4 text-gray-300 text-lg">
            {t("resetDesc")}
          </p>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden text-center mb-8">
            <Link href="/">
              <Image src="/icon.jpg" alt="Naro Fashion" width={64} height={64} className="mx-auto rounded-full" />
              <span className="block mt-2 text-2xl font-heading font-bold text-gold-500">NARO FASHION</span>
            </Link>
          </div>

          {sent ? (
            <div className="text-center space-y-4">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-emerald-600" />
              </div>
              <h1 className="text-2xl font-heading font-bold text-foreground">
                {t("checkEmail")}
              </h1>
              <p className="text-muted-foreground">
                {t("resetLinkSent")} <span className="font-medium text-foreground">{email}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {t("noEmailReceived")}
              </p>
              <div className="pt-4 space-y-3">
                <Button onClick={() => setSent(false)} variant="outline" className="w-full">
                  {t("tryAgain")}
                </Button>
                <Link href="/auth/login">
                  <Button variant="ghost" className="w-full gap-1.5">
                    <ArrowLeft className="h-4 w-4" />
                    {t("backToLogin")}
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="text-center lg:text-left mb-8">
                <h1 className="text-2xl font-heading font-bold text-foreground">
                  {t("forgotPasswordTitle")}
                </h1>
                <p className="mt-2 text-muted-foreground">
                  {t("forgotPasswordDesc")}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                    {t("email")}
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t("emailPlaceholder")}
                      required
                      className="w-full rounded-lg border border-border bg-background pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors"
                    />
                  </div>
                </div>

                <Button type="submit" size="lg" loading={isLoading} className="w-full">
                  {t("sendResetLink")}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <Link href="/auth/login" className="inline-flex items-center gap-1.5 text-sm text-gold-500 hover:text-gold-600 font-medium">
                  <ArrowLeft className="h-4 w-4" />
                  {t("backToLogin")}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
