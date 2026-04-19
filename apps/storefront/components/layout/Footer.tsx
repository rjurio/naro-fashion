"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Facebook,
  Instagram,
  Twitter,
  Send,
  MapPin,
  Phone,
  Mail,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { useTranslation } from "@/lib/i18n";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { newsletterApi, categoriesApi } from "@/lib/api";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

export default function Footer() {
  const { t } = useTranslation();
  const { settings } = useSiteSettings();
  const [footerEmail, setFooterEmail] = useState("");
  const [footerSubscribing, setFooterSubscribing] = useState(false);
  const [footerMsg, setFooterMsg] = useState("");
  const [footerMsgSuccess, setFooterMsgSuccess] = useState(false);

  // Dynamic data
  const [categoryLinks, setCategoryLinks] = useState<{ name: string; href: string }[]>([]);
  const [supportLinks, setSupportLinks] = useState<{ name: string; href: string }[]>([]);
  const [companyLinks, setCompanyLinks] = useState<{ name: string; href: string }[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string; iconUrl?: string }[]>([]);

  useEffect(() => {
    // Load payment methods from API
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1'}/payment-methods`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setPaymentMethods(data); })
      .catch(() => {});

    // Load categories from API
    categoriesApi.getAll()
      .then((cats) => {
        const list = (Array.isArray(cats) ? cats : [])
          .filter((c: any) => c.isActive !== false)
          .slice(0, 6)
          .map((c: any) => ({ name: c.name, href: `/categories/${c.slug}` }));
        setCategoryLinks(list);
      })
      .catch(() => {});

    // Load published CMS pages to build support/company links.
    // Names use translation keys so they update with locale.
    const supportSlugs: Record<string, string> = {
      'contact': t('footer.contactUs'),
      'size-guide': t('footer.sizeGuide'),
      'shipping-info': t('footer.shippingInfo'),
      'returns-exchanges': t('footer.returnsExchanges'),
      'faq': t('footer.faq'),
    };
    const companySlugs: Record<string, string> = {
      'about': t('footer.aboutNaroFashion'),
      'terms': t('footer.termsOfService'),
      'privacy': t('footer.privacyPolicy'),
    };

    // The pages endpoint is public and returns all non-deleted pages
    const tenantId = document.cookie.match(/(?:^|;\s*)tenantId=([^;]*)/)?.[1] || '';
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1'}/cms/pages`, {
      headers: tenantId ? { 'X-Tenant-Id': tenantId } : {},
    })
      .then((r) => r.json())
      .then((pages: any[]) => {
        if (!Array.isArray(pages)) return;
        const slugSet = new Set(pages.filter((p) => p.isPublished).map((p) => p.slug));

        const support: { name: string; href: string }[] = [];
        Object.entries(supportSlugs).forEach(([slug, name]) => {
          if (slugSet.has(slug)) support.push({ name, href: `/pages/${slug}` });
        });
        setSupportLinks(support);

        const company: { name: string; href: string }[] = [];
        Object.entries(companySlugs).forEach(([slug, name]) => {
          if (slugSet.has(slug)) company.push({ name, href: `/pages/${slug}` });
        });
        setCompanyLinks(company);
      })
      .catch(() => {
        // Fallback: show all with i18n defaults
        setSupportLinks([
          { name: t('footer.contactUs'), href: '/pages/contact' },
          { name: t('footer.sizeGuide'), href: '/pages/size-guide' },
          { name: t('footer.faq'), href: '/pages/faq' },
        ]);
        setCompanyLinks([
          { name: t('footer.aboutNaroFashion'), href: '/pages/about' },
          { name: t('footer.termsOfService'), href: '/pages/terms' },
          { name: t('footer.privacyPolicy'), href: '/pages/privacy' },
        ]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const shopLinks = [
    { name: t('footer.newArrivals'), href: '/shop?sort=newest' },
    { name: t('footer.bestSellers'), href: '/shop?sort=popular' },
    { name: t('footer.flashSales'), href: '/flash-sales' },
    { name: t('footer.gownRentals'), href: '/rentals' },
  ];

  return (
    <footer className="bg-dark-500 text-white">
      {/* Newsletter Section */}
      <div className="border-b border-dark-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h3 className="text-xl sm:text-2xl font-heading font-bold">
                {t('footer.stayInStyle')}
              </h3>
              <p className="mt-1 text-sm text-dark-200">
                {t('footer.subscribeDesc')}
              </p>
            </div>
            <div className="w-full max-w-md">
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!footerEmail.trim()) return;
                  setFooterSubscribing(true);
                  setFooterMsg("");
                  try {
                    const res = await newsletterApi.subscribe({ email: footerEmail.trim() });
                    setFooterMsg(res.message || t('footer.subscribeSuccess'));
                    setFooterMsgSuccess(true);
                    setFooterEmail("");
                  } catch {
                    setFooterMsg(t('footer.subscribeFailed'));
                    setFooterMsgSuccess(false);
                  } finally {
                    setFooterSubscribing(false);
                  }
                }}
              >
                <input
                  type="email"
                  required
                  placeholder={t('common.email')}
                  value={footerEmail}
                  onChange={(e) => setFooterEmail(e.target.value)}
                  className="flex-1 rounded-lg bg-dark-400 border border-dark-300 px-4 py-2.5 text-sm text-white placeholder:text-dark-200 outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors"
                />
                <Button variant="primary" size="md" className="shrink-0 gap-2" disabled={footerSubscribing}>
                  <Send className="h-4 w-4" />
                  <span className="hidden sm:inline">{footerSubscribing ? "..." : t('common.subscribe')}</span>
                </Button>
              </form>
              {footerMsg && (
                <p className={`text-xs mt-2 ${footerMsgSuccess ? 'text-green-400' : 'text-red-400'}`}>
                  {footerMsg}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Links Section */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8">
          {/* Brand Column */}
          <div className="col-span-2 md:col-span-4 lg:col-span-1 mb-4 lg:mb-0">
            <Link href="/" className="inline-flex items-center gap-2">
              <Image src={settings.iconUrl} alt={settings.businessName} width={32} height={32} className="rounded-full" unoptimized />
              <span className="text-xl font-heading font-bold text-gold-500">{settings.businessName.toUpperCase()}</span>
            </Link>
            <p className="mt-3 text-sm text-dark-200 max-w-xs">
              {t('footer.footerDesc')}
            </p>
            <div className="mt-4 space-y-2 text-sm text-dark-200">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-gold-500" />
                <span>{settings.contactAddress}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-gold-500" />
                <a href={`tel:${settings.contactPhone.replace(/\s/g, '')}`} className="hover:text-gold-500 transition-colors">{settings.contactPhone}</a>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-gold-500" />
                <a href={`mailto:${settings.contactEmail}`} className="hover:text-gold-500 transition-colors">{settings.contactEmail}</a>
              </div>
            </div>

            {/* Social Links */}
            <div className="mt-4 flex gap-3">
              {settings.facebookUrl && (
                <a
                  href={settings.facebookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-dark-400 hover:bg-gold-500 hover:scale-110 transition-all duration-200"
                  aria-label="Facebook"
                >
                  <Facebook className="h-4 w-4" />
                </a>
              )}
              {settings.instagramUrl && (
                <a
                  href={settings.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-dark-400 hover:bg-gold-500 hover:scale-110 transition-all duration-200"
                  aria-label="Instagram"
                >
                  <Instagram className="h-4 w-4" />
                </a>
              )}
              {settings.twitterUrl && (
                <a
                  href={settings.twitterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-dark-400 hover:bg-gold-500 hover:scale-110 transition-all duration-200"
                  aria-label="Twitter"
                >
                  <Twitter className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>

          {/* Shop */}
          {shopLinks.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-gold-500 mb-4">
                {t('footer.shopTitle')}
              </h4>
              <ul className="space-y-2.5">
                {shopLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-dark-200 hover:text-gold-500 hover:translate-x-1 transition-all inline-block">
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Categories */}
          {categoryLinks.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-gold-500 mb-4">
                {t('footer.categoriesTitle')}
              </h4>
              <ul className="space-y-2.5">
                {categoryLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-dark-200 hover:text-gold-500 hover:translate-x-1 transition-all inline-block">
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Support */}
          {supportLinks.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-gold-500 mb-4">
                {t('footer.supportTitle')}
              </h4>
              <ul className="space-y-2.5">
                {supportLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-dark-200 hover:text-gold-500 hover:translate-x-1 transition-all inline-block">
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Company */}
          {companyLinks.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-gold-500 mb-4">
                {t('footer.companyTitle')}
              </h4>
              <ul className="space-y-2.5">
                {companyLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-dark-200 hover:text-gold-500 hover:translate-x-1 transition-all inline-block">
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-dark-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-dark-300">
              © {new Date().getFullYear()} {settings.businessName}. {t('footer.allRightsReserved')}
            </p>

            {/* Payment Methods */}
            {paymentMethods.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-dark-300 mr-1">{t('footer.weAccept')}</span>
                <div className="flex items-center gap-2 flex-wrap">
                  {paymentMethods.map((pm: any) => (
                    pm.iconUrl ? (
                      <img
                        key={pm.id}
                        src={pm.iconUrl.startsWith('/uploads') ? `${API_ORIGIN}${pm.iconUrl}` : pm.iconUrl}
                        alt={pm.name}
                        title={pm.name}
                        className="w-10 h-7 object-contain rounded"
                      />
                    ) : (
                      <span key={pm.id} className="text-[10px] text-dark-200 font-medium bg-dark-400 rounded px-2 py-1">{pm.name}</span>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
