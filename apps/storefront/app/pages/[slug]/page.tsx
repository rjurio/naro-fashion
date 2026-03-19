"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Mail, Phone, MapPin, Clock, ChevronRight, Send, MessageCircle, Loader2, CheckCircle2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { useTranslation } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { cmsApi } from "@/lib/api";

// Fallback config for pages that haven't been created via CMS yet
const fallbackPages: Record<string, { titleKey: string; sections: { headingKey: string; contentKey: string }[] }> = {
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

interface CmsPage {
  id: string;
  title: string;
  titleSwahili?: string;
  slug: string;
  content: string;
  contentSwahili?: string;
  isPublished: boolean;
}

export default function CMSPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { t } = useTranslation("pages");
  const { t: tc } = useTranslation("common");
  const { locale } = useI18n();

  const [cmsPage, setCmsPage] = useState<CmsPage | null>(null);
  const [loading, setLoading] = useState(true);

  // Try to fetch CMS page from API
  useEffect(() => {
    cmsApi
      .getPage(slug)
      .then((page) => {
        if (page && page.isPublished !== false) {
          setCmsPage(page);
        }
      })
      .catch(() => {
        // Page not found in CMS — will use i18n fallback
      })
      .finally(() => setLoading(false));
  }, [slug]);

  const fallback = fallbackPages[slug];

  // Contact page always gets the full form layout (regardless of CMS page)
  if (slug === "contact" && !loading) {
    return <ContactPage />;
  }

  // Loading state
  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" />
      </div>
    );
  }

  // 404 — not in CMS and no fallback
  if (!cmsPage && !fallback) {
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

  // If CMS page exists, render CMS content (admin-managed)
  if (cmsPage) {
    const title = locale === "sw" && cmsPage.titleSwahili ? cmsPage.titleSwahili : cmsPage.title;
    const content = locale === "sw" && cmsPage.contentSwahili ? cmsPage.contentSwahili : cmsPage.content;

    return (
      <div className="bg-background min-h-screen">
        <div className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
            <nav className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-gold-500 transition-colors">{tc("home")}</Link>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground font-medium">{title}</span>
            </nav>
          </div>
        </div>

        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
          <h1 className="text-3xl font-heading font-bold text-foreground mb-8">{title}</h1>
          <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
            <div
              className="prose prose-sm max-w-none text-muted-foreground
                prose-headings:text-foreground prose-headings:font-bold
                prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3
                prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2
                prose-p:leading-relaxed prose-p:mb-4
                prose-ul:list-disc prose-ul:pl-5 prose-ul:mb-4
                prose-ol:list-decimal prose-ol:pl-5 prose-ol:mb-4
                prose-li:mb-1
                prose-strong:text-foreground
                prose-a:text-gold-500 prose-a:no-underline hover:prose-a:underline"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Contact page has a special layout
  if (slug === "contact") {
    return <ContactPage />;
  }

  // Standard i18n fallback pages (About, FAQ, Terms, Privacy, Size Guide, Shipping, Returns)
  return (
    <div className="bg-background min-h-screen">
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">{tc("home")}</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{t(fallback!.titleKey)}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <h1 className="text-3xl font-heading font-bold text-foreground mb-8">{t(fallback!.titleKey)}</h1>

        <div className="space-y-8">
          {fallback!.sections.map((section) => (
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

// ============================================================
// Contact Page Component
// ============================================================

function WhatsAppIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function ContactPage() {
  const { settings } = useSiteSettings();
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const whatsappNumber = (settings.whatsappNumber || '').replace(/\D/g, '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setError('Please fill in your name, email, and message.');
      return;
    }
    setSending(true);
    setError('');
    try {
      // Send to API — contact form endpoint
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
      const res = await fetch(`${API_URL}/cms/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed');
      setSent(true);
      setForm({ name: '', email: '', phone: '', subject: '', message: '' });
    } catch {
      // If no API endpoint exists, compose a WhatsApp message as fallback
      const msg = `Contact Form:\nName: ${form.name}\nEmail: ${form.email}\nPhone: ${form.phone || 'N/A'}\nSubject: ${form.subject || 'General Inquiry'}\n\n${form.message}`;
      if (whatsappNumber) {
        window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(msg)}`, '_blank');
        setSent(true);
        setForm({ name: '', email: '', phone: '', subject: '', message: '' });
      } else {
        setError('Unable to send message right now. Please try WhatsApp or email us directly.');
      }
    } finally {
      setSending(false);
    }
  };

  const sendViaWhatsApp = () => {
    const msg = form.message.trim()
      ? `Hi ${settings.businessName}!\n\n${form.subject ? `Subject: ${form.subject}\n` : ''}${form.message}${form.name ? `\n\n— ${form.name}` : ''}`
      : `Hi ${settings.businessName}! I'd like to get in touch.`;
    window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const inputClass = 'w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20 transition-all placeholder:text-muted-foreground/60';

  return (
    <div className="bg-background min-h-screen">
      {/* Hero */}
      <section className="relative bg-[#1A1A1A] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A]" />
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-gold-500/5 blur-[120px]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-bold text-white">
            Get in <span className="text-gold-500">Touch</span>
          </h1>
          <p className="mt-3 text-white/60 max-w-xl mx-auto">
            We&apos;d love to hear from you. Reach out via the form below, WhatsApp, or visit us.
          </p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid lg:grid-cols-5 gap-8 lg:gap-12">

          {/* Contact Info — Left Column */}
          <div className="lg:col-span-2 space-y-5">
            {/* Address */}
            <div className="rounded-2xl border border-border bg-card p-5 flex items-start gap-4">
              <div className="p-2.5 rounded-xl bg-gold-500/10 shrink-0">
                <MapPin className="h-5 w-5 text-gold-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-sm">Visit Us</h3>
                <p className="text-sm text-muted-foreground mt-1">{settings.contactAddress}</p>
              </div>
            </div>

            {/* Phone */}
            <div className="rounded-2xl border border-border bg-card p-5 flex items-start gap-4">
              <div className="p-2.5 rounded-xl bg-gold-500/10 shrink-0">
                <Phone className="h-5 w-5 text-gold-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-sm">Call Us</h3>
                <a href={`tel:${settings.contactPhone}`} className="text-sm text-muted-foreground mt-1 block hover:text-gold-500 transition-colors">{settings.contactPhone}</a>
              </div>
            </div>

            {/* Email */}
            <div className="rounded-2xl border border-border bg-card p-5 flex items-start gap-4">
              <div className="p-2.5 rounded-xl bg-gold-500/10 shrink-0">
                <Mail className="h-5 w-5 text-gold-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-sm">Email Us</h3>
                <a href={`mailto:${settings.contactEmail}`} className="text-sm text-muted-foreground mt-1 block hover:text-gold-500 transition-colors">{settings.contactEmail}</a>
              </div>
            </div>

            {/* Hours */}
            <div className="rounded-2xl border border-border bg-card p-5 flex items-start gap-4">
              <div className="p-2.5 rounded-xl bg-gold-500/10 shrink-0">
                <Clock className="h-5 w-5 text-gold-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-sm">Business Hours</h3>
                <p className="text-sm text-muted-foreground mt-1">Mon – Sat: 9:00 AM – 6:00 PM</p>
                <p className="text-sm text-muted-foreground">Sunday: Closed</p>
              </div>
            </div>

            {/* WhatsApp CTA */}
            {whatsappNumber && (
              <button
                type="button"
                onClick={sendViaWhatsApp}
                className="w-full flex items-center justify-center gap-3 px-5 py-4 rounded-2xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20BD5A] transition-colors"
              >
                <WhatsAppIcon className="h-5 w-5" />
                Chat on WhatsApp
              </button>
            )}
          </div>

          {/* Contact Form — Right Column */}
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
              {sent ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  </div>
                  <h2 className="text-xl font-heading font-bold text-foreground mb-2">Message Sent!</h2>
                  <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                    Thank you for reaching out. We&apos;ll get back to you as soon as possible.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="mt-6 text-sm text-gold-500 hover:underline font-medium"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <>
                  <div className="mb-6">
                    <h2 className="text-lg font-heading font-bold text-foreground">Send us a Message</h2>
                    <p className="text-sm text-muted-foreground mt-1">Fill out the form and we&apos;ll respond within 24 hours.</p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1.5">Full Name *</label>
                        <input
                          type="text"
                          required
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          className={inputClass}
                          placeholder="Your name"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1.5">Email *</label>
                        <input
                          type="email"
                          required
                          value={form.email}
                          onChange={(e) => setForm({ ...form, email: e.target.value })}
                          className={inputClass}
                          placeholder="you@example.com"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1.5">Phone (optional)</label>
                        <input
                          type="tel"
                          value={form.phone}
                          onChange={(e) => setForm({ ...form, phone: e.target.value })}
                          className={inputClass}
                          placeholder="+255 700 000 000"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1.5">Subject</label>
                        <select
                          title="Subject"
                          value={form.subject}
                          onChange={(e) => setForm({ ...form, subject: e.target.value })}
                          className={inputClass}
                        >
                          <option value="">General Inquiry</option>
                          <option value="Order Inquiry">Order Inquiry</option>
                          <option value="Rental Question">Rental Question</option>
                          <option value="Returns & Exchange">Returns & Exchange</option>
                          <option value="Size Help">Size Help</option>
                          <option value="Partnership">Partnership</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Message *</label>
                      <textarea
                        required
                        rows={5}
                        value={form.message}
                        onChange={(e) => setForm({ ...form, message: e.target.value })}
                        className={`${inputClass} resize-y`}
                        placeholder="How can we help you?"
                      />
                    </div>

                    {error && (
                      <p className="text-sm text-red-500">{error}</p>
                    )}

                    <div className="flex flex-col sm:flex-row gap-3 pt-2">
                      <Button type="submit" className="flex-1 gap-2" disabled={sending}>
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {sending ? 'Sending...' : 'Send Message'}
                      </Button>
                      {whatsappNumber && (
                        <button
                          type="button"
                          onClick={sendViaWhatsApp}
                          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-[#25D366] text-[#25D366] font-medium text-sm hover:bg-[#25D366] hover:text-white transition-colors"
                        >
                          <WhatsAppIcon className="h-4 w-4" />
                          WhatsApp Instead
                        </button>
                      )}
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
