"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Mail, Phone, MapPin, Clock, ChevronRight } from "lucide-react";
import Button from "@/components/ui/Button";
import { useTranslation } from "@/lib/i18n";

const cmsPages: Record<string, { titleKey: string; sections: { headingKey: string; contentKey: string }[] }> = {
  about: {
    titleKey: "aboutTitle",
    sections: [
      { headingKey: "aboutWhoWeAre", contentKey: "aboutWhoWeAreContent" },
      { headingKey: "aboutMission", contentKey: "aboutMissionContent" },
      { headingKey: "aboutVision", contentKey: "aboutVisionContent" },
    ],
  },
  contact: {
    titleKey: "contactTitle",
    sections: [],
  },
  faq: {
    titleKey: "faqTitle",
    sections: [
      { headingKey: "faqShipping", contentKey: "faqShippingContent" },
      { headingKey: "faqReturns", contentKey: "faqReturnsContent" },
      { headingKey: "faqPayment", contentKey: "faqPaymentContent" },
      { headingKey: "faqRentals", contentKey: "faqRentalsContent" },
      { headingKey: "faqAccount", contentKey: "faqAccountContent" },
    ],
  },
  terms: {
    titleKey: "termsTitle",
    sections: [
      { headingKey: "termsGeneral", contentKey: "termsGeneralContent" },
      { headingKey: "termsOrders", contentKey: "termsOrdersContent" },
      { headingKey: "termsRentals", contentKey: "termsRentalsContent" },
      { headingKey: "termsPayments", contentKey: "termsPaymentsContent" },
    ],
  },
  privacy: {
    titleKey: "privacyTitle",
    sections: [
      { headingKey: "privacyCollection", contentKey: "privacyCollectionContent" },
      { headingKey: "privacyUsage", contentKey: "privacyUsageContent" },
      { headingKey: "privacySharing", contentKey: "privacySharingContent" },
      { headingKey: "privacySecurity", contentKey: "privacySecurityContent" },
    ],
  },
  "size-guide": {
    titleKey: "sizeGuideTitle",
    sections: [
      { headingKey: "sizeGuideHow", contentKey: "sizeGuideHowContent" },
      { headingKey: "sizeGuideWomen", contentKey: "sizeGuideWomenContent" },
      { headingKey: "sizeGuideMen", contentKey: "sizeGuideMenContent" },
    ],
  },
  "shipping-info": {
    titleKey: "shippingTitle",
    sections: [
      { headingKey: "shippingZones", contentKey: "shippingZonesContent" },
      { headingKey: "shippingTimes", contentKey: "shippingTimesContent" },
      { headingKey: "shippingTracking", contentKey: "shippingTrackingContent" },
    ],
  },
  "returns-exchanges": {
    titleKey: "returnsTitle",
    sections: [
      { headingKey: "returnsPolicy", contentKey: "returnsPolicyContent" },
      { headingKey: "returnsProcess", contentKey: "returnsProcessContent" },
      { headingKey: "returnsExclusions", contentKey: "returnsExclusionsContent" },
    ],
  },
};

export default function CMSPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { t } = useTranslation("pages");
  const { t: tc } = useTranslation("common");

  const pageConfig = cmsPages[slug];

  if (!pageConfig) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-heading font-bold text-foreground mb-4">404</h1>
          <p className="text-muted-foreground mb-6">{t("pageNotFound")}</p>
          <Link href="/">
            <Button>{tc("home")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Contact page has a special layout
  if (slug === "contact") {
    return (
      <div className="bg-background min-h-screen">
        <div className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
            <nav className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-gold-500 transition-colors">{tc("home")}</Link>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground font-medium">{t(pageConfig.titleKey)}</span>
            </nav>
          </div>
        </div>

        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
          <h1 className="text-3xl font-heading font-bold text-foreground mb-8">{t(pageConfig.titleKey)}</h1>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Contact Info */}
            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-gold-500/10">
                    <MapPin className="h-5 w-5 text-gold-500" />
                  </div>
                  <h3 className="font-bold text-foreground">{t("contactAddress")}</h3>
                </div>
                <p className="text-sm text-muted-foreground">{t("contactAddressValue")}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-gold-500/10">
                    <Phone className="h-5 w-5 text-gold-500" />
                  </div>
                  <h3 className="font-bold text-foreground">{t("contactPhone")}</h3>
                </div>
                <p className="text-sm text-muted-foreground">+255 712 345 678</p>
                <p className="text-sm text-muted-foreground">+255 754 987 654</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-gold-500/10">
                    <Mail className="h-5 w-5 text-gold-500" />
                  </div>
                  <h3 className="font-bold text-foreground">{t("contactEmail")}</h3>
                </div>
                <p className="text-sm text-muted-foreground">info@narofashion.co.tz</p>
                <p className="text-sm text-muted-foreground">support@narofashion.co.tz</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-gold-500/10">
                    <Clock className="h-5 w-5 text-gold-500" />
                  </div>
                  <h3 className="font-bold text-foreground">{t("contactHours")}</h3>
                </div>
                <p className="text-sm text-muted-foreground">{t("contactHoursWeekday")}</p>
                <p className="text-sm text-muted-foreground">{t("contactHoursWeekend")}</p>
              </div>
            </div>

            {/* Contact Form */}
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold text-foreground mb-4">{t("sendMessage")}</h2>
              <form className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">{t("contactName")}</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">{t("contactEmailLabel")}</label>
                  <input
                    type="email"
                    className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">{t("contactSubject")}</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">{t("contactMessage")}</label>
                  <textarea
                    rows={5}
                    className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 resize-none"
                  />
                </div>
                <Button type="button" className="w-full">{t("sendButton")}</Button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Standard content pages (About, FAQ, Terms, Privacy, Size Guide, Shipping, Returns)
  return (
    <div className="bg-background min-h-screen">
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">{tc("home")}</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{t(pageConfig.titleKey)}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <h1 className="text-3xl font-heading font-bold text-foreground mb-8">{t(pageConfig.titleKey)}</h1>

        <div className="space-y-8">
          {pageConfig.sections.map((section) => (
            <section key={section.headingKey} className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold text-foreground mb-3">{t(section.headingKey)}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {t(section.contentKey)}
              </p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
