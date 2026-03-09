"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Sun, Moon, Monitor, Globe, AlertTriangle } from "lucide-react";
import Button from "@/components/ui/Button";

export default function SettingsPage() {
  const [profile, setProfile] = useState({
    name: "Amina Hassan",
    email: "amina.hassan@email.com",
    phone: "+255 712 345 678",
  });
  const [passwords, setPasswords] = useState({ current: "", newPass: "", confirm: "" });
  const [theme, setTheme] = useState<"light" | "dark" | "standard">("standard");
  const [language, setLanguage] = useState<"en" | "sw">("en");
  const [saved, setSaved] = useState(false);

  const handleProfileChange = (field: string, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const themes = [
    { id: "light" as const, label: "Light", icon: Sun },
    { id: "dark" as const, label: "Dark", icon: Moon },
    { id: "standard" as const, label: "Standard", icon: Monitor },
  ];

  return (
    <div className="bg-background min-h-screen">
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">Home</Link>
            <span>/</span>
            <Link href="/account" className="hover:text-gold-500 transition-colors">Account</Link>
            <span>/</span>
            <span className="text-foreground font-medium">Settings</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">Settings</h1>
          <Link href="/account">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> Account
            </Button>
          </Link>
        </div>

        <div className="space-y-8">
          {/* Profile Info */}
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold text-foreground mb-4">Profile Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={profile.name}
                  onChange={(e) => handleProfileChange("name", e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                <input
                  type="email"
                  value={profile.email}
                  onChange={(e) => handleProfileChange("email", e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Phone Number</label>
                <input
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => handleProfileChange("phone", e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <Button onClick={handleSave}>
                {saved ? "Saved!" : "Save Changes"}
              </Button>
            </div>
          </section>

          {/* Change Password */}
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold text-foreground mb-4">Change Password</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Current Password</label>
                <input
                  type="password"
                  value={passwords.current}
                  onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">New Password</label>
                <input
                  type="password"
                  value={passwords.newPass}
                  onChange={(e) => setPasswords((p) => ({ ...p, newPass: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Confirm New Password</label>
                <input
                  type="password"
                  value={passwords.confirm}
                  onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <Button variant="outline">Update Password</Button>
            </div>
          </section>

          {/* Theme */}
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold text-foreground mb-4">Theme Preference</h2>
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
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold text-foreground mb-4">Language</h2>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setLanguage("en")}
                className={`flex items-center justify-center gap-2 p-4 rounded-xl border-2 transition-colors ${
                  language === "en" ? "border-gold-500 bg-gold-500/5" : "border-border hover:border-gold-500/50"
                }`}
              >
                <Globe className={`h-5 w-5 ${language === "en" ? "text-gold-500" : "text-muted-foreground"}`} />
                <span className="text-sm font-medium text-foreground">English</span>
              </button>
              <button
                onClick={() => setLanguage("sw")}
                className={`flex items-center justify-center gap-2 p-4 rounded-xl border-2 transition-colors ${
                  language === "sw" ? "border-gold-500 bg-gold-500/5" : "border-border hover:border-gold-500/50"
                }`}
              >
                <Globe className={`h-5 w-5 ${language === "sw" ? "text-gold-500" : "text-muted-foreground"}`} />
                <span className="text-sm font-medium text-foreground">Kiswahili</span>
              </button>
            </div>
          </section>

          {/* Danger Zone */}
          <section className="rounded-xl border-2 border-red-200 bg-red-50/50 p-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <h2 className="text-lg font-bold text-red-700">Danger Zone</h2>
            </div>
            <p className="text-sm text-red-600 mb-4">
              Once you delete your account, there is no going back. All your data, orders, and rental history will be permanently removed.
            </p>
            <button className="px-4 py-2 rounded-lg border-2 border-red-500 text-red-500 text-sm font-medium hover:bg-red-500 hover:text-white transition-colors">
              Delete My Account
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
