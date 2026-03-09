"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, Shield, CheckCircle, Clock, AlertCircle, Camera, X } from "lucide-react";
import Button from "@/components/ui/Button";
import { useTranslation } from "@/lib/i18n";

type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

export default function IDVerificationPage() {
  const { t } = useTranslation("idVerification");
  const { t: tc } = useTranslation("common");
  const [status, setStatus] = useState<VerificationStatus>("unverified");
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = (side: "front" | "back") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (side === "front") setFrontImage(url);
    else setBackImage(url);
  };

  const handleSubmit = () => {
    if (!frontImage || !backImage) return;
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      setStatus("pending");
    }, 2000);
  };

  const statusConfig = {
    unverified: { icon: Shield, color: "text-muted-foreground", bg: "bg-muted", label: t("notVerified") },
    pending: { icon: Clock, color: "text-amber-600", bg: "bg-amber-50", label: t("pendingReview") },
    verified: { icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50", label: t("verified") },
    rejected: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50", label: t("rejected") },
  };

  const currentStatus = statusConfig[status];
  const StatusIcon = currentStatus.icon;

  return (
    <div className="bg-background min-h-screen">
      {/* Breadcrumb */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">{tc("home")}</Link>
            <span>/</span>
            <Link href="/account" className="hover:text-gold-500 transition-colors">{tc("account")}</Link>
            <span>/</span>
            <span className="text-foreground font-medium">{t("title")}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">{t("title")}</h1>
          <Link href="/account">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> {tc("account")}
            </Button>
          </Link>
        </div>

        {/* Status Banner */}
        <div className={`flex items-center gap-3 p-4 rounded-xl ${currentStatus.bg} mb-8`}>
          <StatusIcon className={`h-5 w-5 ${currentStatus.color}`} />
          <div>
            <p className={`font-medium ${currentStatus.color}`}>{currentStatus.label}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {status === "unverified" && t("uploadPrompt")}
              {status === "pending" && t("pendingDesc")}
              {status === "verified" && t("verifiedDesc")}
              {status === "rejected" && t("rejectedDesc")}
            </p>
          </div>
        </div>

        {/* Info Card */}
        <section className="rounded-xl border border-border bg-card p-6 mb-6">
          <h2 className="text-lg font-bold text-foreground mb-3">{t("whyNeeded")}</h2>
          <p className="text-sm text-muted-foreground mb-4">{t("whyNeededDesc")}</p>
          <ul className="space-y-2">
            {["requirement1", "requirement2", "requirement3", "requirement4"].map((key) => (
              <li key={key} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-gold-500 mt-0.5 flex-shrink-0" />
                {t(key)}
              </li>
            ))}
          </ul>
        </section>

        {/* Upload Section */}
        {(status === "unverified" || status === "rejected") && (
          <section className="rounded-xl border border-border bg-card p-6 space-y-6">
            <h2 className="text-lg font-bold text-foreground">{t("uploadID")}</h2>

            {/* Front of ID */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">{t("frontSide")}</label>
              {frontImage ? (
                <div className="relative rounded-lg overflow-hidden border border-border">
                  <img src={frontImage} alt="ID Front" className="w-full h-48 object-cover" />
                  <button
                    onClick={() => setFrontImage(null)}
                    className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white hover:bg-black/70"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center h-48 rounded-lg border-2 border-dashed border-border hover:border-gold-500 cursor-pointer transition-colors">
                  <Camera className="h-8 w-8 text-muted-foreground mb-2" />
                  <span className="text-sm text-muted-foreground">{t("clickToUpload")}</span>
                  <span className="text-xs text-muted-foreground mt-1">{t("fileFormats")}</span>
                  <input type="file" accept="image/*" onChange={handleFileSelect("front")} className="hidden" />
                </label>
              )}
            </div>

            {/* Back of ID */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">{t("backSide")}</label>
              {backImage ? (
                <div className="relative rounded-lg overflow-hidden border border-border">
                  <img src={backImage} alt="ID Back" className="w-full h-48 object-cover" />
                  <button
                    onClick={() => setBackImage(null)}
                    className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white hover:bg-black/70"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center h-48 rounded-lg border-2 border-dashed border-border hover:border-gold-500 cursor-pointer transition-colors">
                  <Camera className="h-8 w-8 text-muted-foreground mb-2" />
                  <span className="text-sm text-muted-foreground">{t("clickToUpload")}</span>
                  <span className="text-xs text-muted-foreground mt-1">{t("fileFormats")}</span>
                  <input type="file" accept="image/*" onChange={handleFileSelect("back")} className="hidden" />
                </label>
              )}
            </div>

            <Button
              onClick={handleSubmit}
              loading={isUploading}
              disabled={!frontImage || !backImage}
              className="w-full gap-2"
              size="lg"
            >
              <Upload className="h-4 w-4" />
              {t("submitForVerification")}
            </Button>
          </section>
        )}

        {/* Verified state */}
        {status === "verified" && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-6 text-center">
            <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-foreground mb-2">{t("allSet")}</h2>
            <p className="text-sm text-muted-foreground mb-4">{t("allSetDesc")}</p>
            <Link href="/rentals">
              <Button>{t("browseRentals")}</Button>
            </Link>
          </section>
        )}

        {/* Pending state */}
        {status === "pending" && (
          <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-6 text-center">
            <Clock className="h-12 w-12 text-amber-500 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-foreground mb-2">{t("underReview")}</h2>
            <p className="text-sm text-muted-foreground">{t("underReviewDesc")}</p>
          </section>
        )}
      </div>
    </div>
  );
}
