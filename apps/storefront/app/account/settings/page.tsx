"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { ArrowLeft, Sun, Moon, Monitor, Globe, Loader2, Download } from "lucide-react";
import Button from "@/components/ui/Button";
import { authApi, tokenStore, usersApi, ApiError } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import { isValidPassword } from "@/lib/password";

export default function SettingsPage() {
  const { t, locale, setLocale } = useTranslation();
  const [profile, setProfile] = useState({ name: "", email: "", phone: "" });
  const [passwords, setPasswords] = useState({ current: "", newPass: "", confirm: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [error, setError] = useState("");
  const { theme, setTheme } = useTheme();

  // Data export. (There is deliberately no self-service account deletion —
  // only a store admin can suspend a customer account.)
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const handleExportData = async () => {
    setExporting(true);
    setExportError("");
    try {
      const data = await usersApi.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      // Surface the API's reason (e.g. 403 for a staff account) instead of a
      // generic message so failures are diagnosable.
      const apiMsg = err instanceof ApiError ? err.message : "";
      const isGeneric = !apiMsg || /^Request failed with status/.test(apiMsg);
      setExportError(isGeneric ? t("account.dataExportFailed") : apiMsg);
      console.error("Data export failed", err);
    } finally {
      setExporting(false);
    }
  };

  // Fetch profile on mount
  useEffect(() => {
    authApi.getProfile()
      .then((user) => {
        setProfile({
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
          email: user.email || "",
          phone: user.phone || "",
        });
      })
      .catch(() => setError(t("account.failedLoadProfile")))
      .finally(() => setLoading(false));
  }, [t]);

  const handleProfileChange = (field: string, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const nameParts = profile.name.trim().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";
      await authApi.updateProfile({ firstName, lastName, phone: profile.phone });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError(t("account.failedSaveProfile"));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordMsg(null);
    if (passwords.newPass !== passwords.confirm) {
      setPasswordMsg({ type: "error", text: t("account.passwordsDoNotMatch") });
      return;
    }
    if (!isValidPassword(passwords.newPass)) {
      setPasswordMsg({ type: "error", text: t("account.passwordMin6") });
      return;
    }
    setChangingPassword(true);
    try {
      const res = await authApi.changePassword({
        currentPassword: passwords.current,
        newPassword: passwords.newPass,
      });
      // The API bumps the token version (revoking every other session) and
      // returns fresh tokens for THIS session — store them or the next
      // request is rejected.
      if (res?.accessToken) tokenStore.set(res.accessToken, res.refreshToken ?? null);
      setPasswordMsg({ type: "success", text: t("account.passwordUpdatedSuccess") });
      setPasswords({ current: "", newPass: "", confirm: "" });
    } catch {
      setPasswordMsg({ type: "error", text: t("account.failedChangePassword") });
    } finally {
      setChangingPassword(false);
    }
  };

  const themes = [
    { id: "light" as const, label: t("account.themeLight"), icon: Sun },
    { id: "dark" as const, label: t("account.themeDark"), icon: Moon },
    { id: "standard" as const, label: t("account.themeStandard"), icon: Monitor },
  ];

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">{t("common.home")}</Link>
            <span>/</span>
            <Link href="/account" className="hover:text-gold-500 transition-colors">{t("account.account")}</Link>
            <span>/</span>
            <span className="text-foreground font-medium">{t("account.settings")}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">{t("account.settings")}</h1>
          <Link href="/account">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> {t("account.account")}
            </Button>
          </Link>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
        )}

        <div className="space-y-8">
          {/* Profile Info */}
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5 md:p-6">
            <h2 className="text-lg font-bold text-foreground mb-4">{t("account.profileInformation")}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t("account.fullName")}</label>
                <input
                  type="text"
                  value={profile.name}
                  onChange={(e) => handleProfileChange("name", e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t("common.email")}</label>
                <input
                  type="email"
                  value={profile.email}
                  disabled
                  className="w-full rounded-lg border border-border bg-muted px-4 py-2.5 text-sm text-muted-foreground cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground mt-1">{t("account.emailCannotBeChanged")}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t("account.phoneNumber")}</label>
                <input
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => handleProfileChange("phone", e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> {t("account.saving")}</> : saved ? t("account.savedExclaim") : t("account.saveChanges")}
              </Button>
            </div>
          </section>

          {/* Change Password */}
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5 md:p-6">
            <h2 className="text-lg font-bold text-foreground mb-4">{t("account.changePassword")}</h2>
            {passwordMsg && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${passwordMsg.type === "success" ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
                {passwordMsg.text}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t("account.currentPassword")}</label>
                <input
                  type="password"
                  value={passwords.current}
                  onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t("auth.newPassword")}</label>
                <input
                  type="password"
                  value={passwords.newPass}
                  onChange={(e) => setPasswords((p) => ({ ...p, newPass: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t("auth.confirmNewPassword")}</label>
                <input
                  type="password"
                  value={passwords.confirm}
                  onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <Button
                variant="outline"
                onClick={handleChangePassword}
                disabled={changingPassword || !passwords.current || !passwords.newPass || !passwords.confirm}
              >
                {changingPassword ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> {t("account.updating")}</> : t("account.updatePassword")}
              </Button>
            </div>
          </section>

          {/* Theme */}
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5 md:p-6">
            <h2 className="text-lg font-bold text-foreground mb-4">{t("account.themePreference")}</h2>
            <div className="grid grid-cols-3 gap-3">
              {themes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${
                    theme === t.id
                      ? "border-gold-500 bg-gold-500/5"
                      : "border-border hover:border-gold-500/50"
                  }`}
                >
                  <t.icon className={`h-6 w-6 ${theme === t.id ? "text-gold-500" : "text-muted-foreground"}`} />
                  <span className="text-sm font-medium text-foreground">{t.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Language */}
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5 md:p-6">
            <h2 className="text-lg font-bold text-foreground mb-4">{t("common.language")}</h2>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setLocale("en")}
                className={`flex items-center justify-center gap-2 p-4 rounded-xl border-2 transition-colors ${
                  locale === "en" ? "border-gold-500 bg-gold-500/5" : "border-border hover:border-gold-500/50"
                }`}
              >
                <Globe className={`h-5 w-5 ${locale === "en" ? "text-gold-500" : "text-muted-foreground"}`} />
                <span className="text-sm font-medium text-foreground">{t("account.english")}</span>
              </button>
              <button
                onClick={() => setLocale("sw")}
                className={`flex items-center justify-center gap-2 p-4 rounded-xl border-2 transition-colors ${
                  locale === "sw" ? "border-gold-500 bg-gold-500/5" : "border-border hover:border-gold-500/50"
                }`}
              >
                <Globe className={`h-5 w-5 ${locale === "sw" ? "text-gold-500" : "text-muted-foreground"}`} />
                <span className="text-sm font-medium text-foreground">{t("account.kiswahili")}</span>
              </button>
            </div>
          </section>

          {/* Your data — export */}
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5 md:p-6">
            <h2 className="text-lg font-bold text-foreground mb-2">{t("account.yourData")}</h2>
            <p className="text-sm text-muted-foreground mb-4">{t("account.yourDataDesc")}</p>
            {exportError && <p className="text-sm text-red-600 mb-3">{exportError}</p>}
            <Button variant="outline" onClick={handleExportData} disabled={exporting}>
              {exporting ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> {t("account.downloadingData")}</>
              ) : (
                <><Download className="h-4 w-4 mr-2" /> {t("account.downloadMyData")}</>
              )}
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}
