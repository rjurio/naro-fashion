"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, Shield, CheckCircle, Clock, AlertCircle, Camera, X, Loader2, FileText } from "lucide-react";
import Button from "@/components/ui/Button";
import { useTranslation } from "@/lib/i18n";
import {
  idVerificationApi,
  uploadApi,
  ApiError,
  ID_DOCUMENT_MAX_BYTES,
  ID_DOCUMENT_MIMES,
} from "@/lib/api";

type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

/** Local preview of a picked file (object URL for images; PDFs get an icon). */
type PickedFile = { file: File; previewUrl: string | null };

export default function IDVerificationPage() {
  const { t } = useTranslation("idVerification");
  const { t: tc } = useTranslation("common");
  const [status, setStatus] = useState<VerificationStatus>("unverified");
  const [rejectionReason, setRejectionReason] = useState("");
  const [front, setFront] = useState<PickedFile | null>(null);
  const [back, setBack] = useState<PickedFile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetch current verification status on mount
  useEffect(() => {
    idVerificationApi.getStatus()
      .then((data) => {
        const apiStatus = (data?.status || "").toUpperCase();
        if (apiStatus === "APPROVED") setStatus("verified");
        else if (apiStatus === "PENDING") setStatus("pending");
        else if (apiStatus === "REJECTED") {
          setStatus("rejected");
          setRejectionReason(data?.rejectionReason || "");
        } else setStatus("unverified");
      })
      .catch(() => setStatus("unverified"))
      .finally(() => setLoading(false));
  }, []);

  // Release object URLs when previews change / on unmount.
  useEffect(() => () => { if (front?.previewUrl) URL.revokeObjectURL(front.previewUrl); }, [front]);
  useEffect(() => () => { if (back?.previewUrl) URL.revokeObjectURL(back.previewUrl); }, [back]);

  const handleFileSelect = (side: "front" | "back") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    // Same limits as the API (jpg/png/webp/pdf, 8MB) — no crop/recompress,
    // the original is kept as evidence.
    if (!ID_DOCUMENT_MIMES.includes(file.type)) {
      setError(t("invalidFileType"));
      return;
    }
    if (file.size > ID_DOCUMENT_MAX_BYTES) {
      setError(t("fileTooLarge"));
      return;
    }
    setError("");

    const picked: PickedFile = {
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    };
    if (side === "front") setFront(picked);
    else setBack(picked);
  };

  const handleSubmit = async () => {
    if (!front || !back) return;
    setIsUploading(true);
    setError("");

    try {
      // Upload each side to the private id-document store. The API returns
      // `private://id-documents/...` refs — the only values /id-verification/submit accepts.
      const [frontResult, backResult] = await Promise.all([
        uploadApi.uploadIdDocument(front.file, "front"),
        uploadApi.uploadIdDocument(back.file, "back"),
      ]);

      await idVerificationApi.submit({
        frontImageUrl: frontResult.url,
        backImageUrl: backResult.url,
      });

      setStatus("pending");
      setFront(null);
      setBack(null);
    } catch (err) {
      const apiMsg = err instanceof ApiError ? err.message : "";
      setError(apiMsg && !/failed with status/i.test(apiMsg) ? apiMsg : t("submitFailed"));
    } finally {
      setIsUploading(false);
    }
  };

  const renderPicker = (side: "front" | "back") => {
    const picked = side === "front" ? front : back;
    const clear = () => (side === "front" ? setFront(null) : setBack(null));
    if (picked) {
      return (
        <div className="relative rounded-lg overflow-hidden border border-border">
          {picked.previewUrl ? (
            <img
              src={picked.previewUrl}
              alt={side === "front" ? t("frontPreviewAlt") : t("backPreviewAlt")}
              className="w-full h-48 object-cover"
            />
          ) : (
            <div className="w-full h-48 flex flex-col items-center justify-center gap-2 bg-muted">
              <FileText className="h-10 w-10 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{t("pdfSelected")}</span>
              <span className="text-xs text-muted-foreground truncate max-w-[90%]">{picked.file.name}</span>
            </div>
          )}
          <button
            type="button"
            onClick={clear}
            aria-label={t("removeFile")}
            className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      );
    }
    return (
      <label className="flex flex-col items-center justify-center h-48 rounded-lg border-2 border-dashed border-border hover:border-gold-500 cursor-pointer transition-colors">
        <Camera className="h-8 w-8 text-muted-foreground mb-2" />
        <span className="text-sm text-muted-foreground">{t("clickToUpload")}</span>
        <span className="text-xs text-muted-foreground mt-1">{t("fileFormats")}</span>
        <input
          type="file"
          accept={ID_DOCUMENT_MIMES.join(",")}
          onChange={handleFileSelect(side)}
          className="hidden"
        />
      </label>
    );
  };

  const statusConfig = {
    unverified: { icon: Shield, color: "text-muted-foreground", bg: "bg-muted", label: t("notVerified") },
    pending: { icon: Clock, color: "text-amber-600", bg: "bg-amber-50", label: t("pendingReview") },
    verified: { icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50", label: t("verified") },
    rejected: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50", label: t("rejected") },
  };

  const currentStatus = statusConfig[status];
  const StatusIcon = currentStatus.icon;

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
      </div>
    );
  }

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
              {status === "rejected" && (rejectionReason || t("rejectedDesc"))}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
        )}

        {/* Info Card */}
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5 md:p-6 mb-6">
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
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5 md:p-6 space-y-6">
            <h2 className="text-lg font-bold text-foreground">{t("uploadID")}</h2>

            {/* Front of ID */}
            <div>
              <p className="block text-sm font-medium text-foreground mb-2">{t("frontSide")}</p>
              {renderPicker("front")}
            </div>

            {/* Back of ID */}
            <div>
              <p className="block text-sm font-medium text-foreground mb-2">{t("backSide")}</p>
              {renderPicker("back")}
            </div>

            <Button
              onClick={handleSubmit}
              loading={isUploading}
              disabled={!front || !back || isUploading}
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
