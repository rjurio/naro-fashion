"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { api } from "@/lib/api";

export default function UnsubscribePage() {
  const { settings } = useSiteSettings();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Invalid unsubscribe link.");
      return;
    }

    api.get<{ message: string }>(`/newsletter/unsubscribe/${token}`)
      .then((res) => {
        setStatus("success");
        setMessage(res.message || "You have been unsubscribed.");
      })
      .catch(() => {
        setStatus("error");
        setMessage("Failed to unsubscribe. The link may be invalid or expired.");
      });
  }, [token]);

  return (
    <>
      <Header />
      <main className="min-h-[60vh] flex items-center justify-center px-4 py-20">
        <div className="max-w-md w-full text-center">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-gold-500" />
              <p className="text-muted-foreground">Processing your request...</p>
            </div>
          )}
          {status === "success" && (
            <div className="flex flex-col items-center gap-4">
              <CheckCircle className="h-16 w-16 text-emerald-500" />
              <h1 className="text-2xl font-bold text-foreground">Unsubscribed</h1>
              <p className="text-muted-foreground">{message}</p>
              <p className="text-sm text-muted-foreground mt-2">
                You will no longer receive newsletters from {settings.businessName}.
              </p>
            </div>
          )}
          {status === "error" && (
            <div className="flex flex-col items-center gap-4">
              <XCircle className="h-16 w-16 text-red-500" />
              <h1 className="text-2xl font-bold text-foreground">Oops!</h1>
              <p className="text-muted-foreground">{message}</p>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
