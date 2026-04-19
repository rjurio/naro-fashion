"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  MapPin, Plus, Pencil, Trash2, CheckCircle2,
  ChevronRight, Loader2, Home, Briefcase, Star,
} from "lucide-react";
import { addressesApi } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { useTranslation } from "@/lib/i18n";

interface Address {
  id: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  label?: string;
  isDefault: boolean;
}

const LABEL_ICONS: Record<string, React.ElementType> = {
  Home: Home,
  Work: Briefcase,
  Office: Briefcase,
};

const emptyForm = { street: "", city: "", state: "", zipCode: "", country: "Tanzania", label: "Home", isDefault: false };

export default function AddressesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Address | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const data = await addressesApi.getAll();
      setAddresses(data ?? []);
    } catch {
      setAddresses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setShowForm(true);
  };

  const openEdit = (addr: Address) => {
    setEditing(addr);
    setForm({
      street: addr.street,
      city: addr.city,
      state: addr.state,
      zipCode: addr.zipCode,
      country: addr.country,
      label: addr.label || "Home",
      isDefault: addr.isDefault,
    });
    setError("");
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.street.trim() || !form.city.trim() || !form.state.trim() || !form.country.trim()) {
      setError(t("account.addressFillFields"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await addressesApi.update(editing.id, form);
      } else {
        await addressesApi.create(form);
      }
      setShowForm(false);
      await load();
    } catch {
      setError(t("account.failedSaveAddress"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("account.confirmDeleteAddress"))) return;
    setDeleting(id);
    try {
      await addressesApi.delete(id);
      setAddresses((prev) => prev.filter((a) => a.id !== id));
    } catch {
      toast.error(t("account.failedDeleteAddress"));
    } finally {
      setDeleting(null);
    }
  };

  const handleSetDefault = async (addr: Address) => {
    try {
      await addressesApi.update(addr.id, { isDefault: true });
      await load();
    } catch {
      toast.error(t("account.failedSetDefault"));
    }
  };

  const inputClass =
    "w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20 transition-all placeholder:text-muted-foreground/60";

  return (
    <div className="bg-background min-h-screen">
      {/* Breadcrumb */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">{t("common.home")}</Link>
            <ChevronRight className="h-3 w-3" />
            <Link href="/account" className="hover:text-gold-500 transition-colors">{t("account.account")}</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{t("account.addresses")}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">{t("account.myAddressesTitle")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("account.manageDeliveryAddresses")}</p>
          </div>
          {!showForm && (
            <button
              type="button"
              onClick={openNew}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gold-500 text-[#1A1A1A] text-sm font-semibold hover:bg-gold-600 transition-colors"
            >
              <Plus className="h-4 w-4" />
              {t("account.addAddress")}
            </button>
          )}
        </div>

        {/* Add / Edit Form */}
        {showForm && (
          <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 md:p-6 mb-6">
            <h2 className="text-base font-semibold text-foreground mb-5">
              {editing ? t("account.editAddress") : t("account.newAddress")}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              {/* Label */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">{t("account.labelField")}</label>
                <div className="flex gap-2">
                  {[
                    { key: "Home", label: t("account.labelHome") },
                    { key: "Work", label: t("account.labelWork") },
                    { key: "Other", label: t("account.labelOther") },
                  ].map((l) => (
                    <button
                      key={l.key}
                      type="button"
                      onClick={() => setForm({ ...form, label: l.key })}
                      className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-colors ${
                        form.label === l.key
                          ? "border-gold-500 bg-gold-500/10 text-gold-600"
                          : "border-border bg-background text-muted-foreground hover:border-gold-500/50"
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Street */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">{t("account.streetArea")}</label>
                <input
                  type="text"
                  required
                  value={form.street}
                  onChange={(e) => setForm({ ...form, street: e.target.value })}
                  placeholder="e.g. Kariakoo, Msimbazi Street"
                  className={inputClass}
                />
              </div>

              {/* City + State */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">{t("account.cityRequired")}</label>
                  <input
                    type="text"
                    required
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    placeholder="e.g. Dar es Salaam"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">{t("account.regionRequired")}</label>
                  <input
                    type="text"
                    required
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    placeholder="e.g. Dar es Salaam"
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Zip + Country */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">{t("account.zipPostal")}</label>
                  <input
                    type="text"
                    value={form.zipCode}
                    onChange={(e) => setForm({ ...form, zipCode: e.target.value })}
                    placeholder="e.g. 11101"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">{t("account.countryRequired")}</label>
                  <input
                    type="text"
                    required
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Default checkbox */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                  className="h-4 w-4 rounded border-border accent-gold-500"
                />
                <span className="text-sm text-foreground">{t("account.setAsDefault")}</span>
              </label>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-5 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gold-500 text-[#1A1A1A] text-sm font-semibold hover:bg-gold-600 disabled:opacity-50 transition-colors"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? t("account.saving") : editing ? t("account.saveChanges") : t("account.addAddress")}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Address List */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
          </div>
        ) : addresses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
            <div className="w-14 h-14 rounded-full bg-gold-500/10 flex items-center justify-center mx-auto mb-4">
              <MapPin className="h-7 w-7 text-gold-500" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">{t("account.noAddressesSaved")}</h3>
            <p className="text-sm text-muted-foreground mb-4">{t("account.addAddressSpeedCheckout")}</p>
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gold-500 text-[#1A1A1A] text-sm font-semibold hover:bg-gold-600 transition-colors"
            >
              <Plus className="h-4 w-4" />
              {t("account.addFirstAddress")}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {addresses.map((addr) => {
              const LabelIcon = LABEL_ICONS[addr.label || ""] || MapPin;
              return (
                <div
                  key={addr.id}
                  className={`relative rounded-2xl border bg-card p-5 transition-all ${
                    addr.isDefault ? "border-gold-500 ring-1 ring-gold-500/30" : "border-border"
                  }`}
                >
                  {/* Default badge */}
                  {addr.isDefault && (
                    <span className="absolute top-3 right-3 flex items-center gap-1 text-xs text-gold-600 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t("account.defaultBadge")}
                    </span>
                  )}

                  {/* Label */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 rounded-lg bg-gold-500/10">
                      <LabelIcon className="h-4 w-4 text-gold-500" />
                    </div>
                    <span className="text-sm font-semibold text-foreground">{addr.label || t("account.addressFallback")}</span>
                  </div>

                  {/* Address text */}
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {addr.street}<br />
                    {addr.city}, {addr.state}<br />
                    {addr.zipCode ? `${addr.zipCode}, ` : ""}{addr.country}
                  </p>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
                    <button
                      type="button"
                      onClick={() => openEdit(addr)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t("account.edit")}
                    </button>
                    {!addr.isDefault && (
                      <>
                        <span className="text-border">·</span>
                        <button
                          type="button"
                          onClick={() => handleSetDefault(addr)}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-gold-500 transition-colors"
                        >
                          <Star className="h-3.5 w-3.5" />
                          {t("account.setDefault")}
                        </button>
                      </>
                    )}
                    <span className="text-border">·</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(addr.id)}
                      disabled={deleting === addr.id}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                    >
                      {deleting === addr.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      {t("account.delete")}
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Add new card */}
            {!showForm && (
              <button
                type="button"
                onClick={openNew}
                className="rounded-2xl border border-dashed border-border bg-card p-5 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-gold-500 hover:text-gold-500 transition-colors min-h-[160px]"
              >
                <Plus className="h-6 w-6" />
                <span className="text-sm font-medium">{t("account.addNewAddress")}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
