"use client";

import Link from "next/link";
import {
  Facebook,
  Instagram,
  Twitter,
  Send,
  MapPin,
  Phone,
  Mail,
  CreditCard,
  Smartphone,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { useTranslation } from "@/lib/i18n";

export default function Footer() {
  const { t } = useTranslation();

  const shopLinks = [
    { name: t('footer.newArrivals'), href: '/shop?sort=newest' },
    { name: t('footer.bestSellers'), href: '/shop?sort=popular' },
    { name: t('footer.flashSales'), href: '/flash-sales' },
    { name: t('footer.gownRentals'), href: '/rentals' },
    { name: t('footer.giftCards'), href: '/gift-cards' },
  ];

  const categoryLinks = [
    { name: t('footer.women'), href: '/categories/women' },
    { name: t('footer.men'), href: '/categories/men' },
    { name: t('footer.kids'), href: '/categories/kids' },
    { name: t('footer.accessories'), href: '/categories/accessories' },
    { name: t('footer.shoes'), href: '/categories/shoes' },
  ];

  const supportLinks = [
    { name: t('footer.contactUs'), href: '/contact' },
    { name: t('footer.sizeGuide'), href: '/size-guide' },
    { name: t('footer.shippingInfo'), href: '/shipping' },
    { name: t('footer.returnsExchanges'), href: '/returns' },
    { name: t('footer.faq'), href: '/faq' },
  ];

  const companyLinks = [
    { name: t('footer.aboutNaro'), href: '/about' },
    { name: t('footer.careers'), href: '/careers' },
    { name: t('footer.privacyPolicy'), href: '/privacy' },
    { name: t('footer.termsOfService'), href: '/terms' },
    { name: t('footer.blog'), href: '/blog' },
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
            <form
              className="flex w-full max-w-md gap-2"
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                type="email"
                placeholder={t('common.email')}
                className="flex-1 rounded-lg bg-dark-400 border border-dark-300 px-4 py-2.5 text-sm text-white placeholder:text-dark-200 outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors"
              />
              <Button variant="primary" size="md" className="shrink-0 gap-2">
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">{t('common.subscribe')}</span>
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Links Section */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8">
          {/* Brand Column */}
          <div className="col-span-2 md:col-span-4 lg:col-span-1 mb-4 lg:mb-0">
            <Link href="/" className="inline-block">
              <span className="text-xl font-heading font-bold">
                <span className="text-gold-500">NARO</span>
                <span className="text-gold-500"> FASHION</span>
              </span>
            </Link>
            <p className="mt-3 text-sm text-dark-200 max-w-xs">
              {t('footer.footerDesc')}
            </p>
            <div className="mt-4 space-y-2 text-sm text-dark-200">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-gold-500" />
                <span>Dar es Salaam, Tanzania</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-gold-500" />
                <span>+255 700 000 000</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-gold-500" />
                <span>hello@narofashion.co.tz</span>
              </div>
            </div>

            {/* Social Links */}
            <div className="mt-4 flex gap-3">
              <a
                href="#"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-dark-400 hover:bg-gold-500 transition-colors"
                aria-label="Facebook"
              >
                <Facebook className="h-4 w-4" />
              </a>
              <a
                href="https://www.instagram.com/narofashion2019/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-dark-400 hover:bg-gold-500 transition-colors"
                aria-label="Instagram"
              >
                <Instagram className="h-4 w-4" />
              </a>
              <a
                href="#"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-dark-400 hover:bg-gold-500 transition-colors"
                aria-label="Twitter"
              >
                <Twitter className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Shop */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-gold-500 mb-4">
              {t('footer.shopTitle')}
            </h4>
            <ul className="space-y-2.5">
              {shopLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-dark-200 hover:text-gold-500 transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Categories */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-gold-500 mb-4">
              {t('footer.categoriesTitle')}
            </h4>
            <ul className="space-y-2.5">
              {categoryLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-dark-200 hover:text-gold-500 transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-gold-500 mb-4">
              {t('footer.supportTitle')}
            </h4>
            <ul className="space-y-2.5">
              {supportLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-dark-200 hover:text-gold-500 transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-gold-500 mb-4">
              {t('footer.companyTitle')}
            </h4>
            <ul className="space-y-2.5">
              {companyLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-dark-200 hover:text-gold-500 transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-dark-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-dark-300">
              {t('footer.copyright')}
            </p>

            {/* Payment Methods */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-dark-300 mr-1">{t('footer.weAccept')}</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-dark-400 rounded px-2 py-1">
                  <CreditCard className="h-3.5 w-3.5 text-dark-200" />
                  <span className="text-[10px] text-dark-200 font-medium">
                    Visa
                  </span>
                </div>
                <div className="flex items-center gap-1 bg-dark-400 rounded px-2 py-1">
                  <CreditCard className="h-3.5 w-3.5 text-dark-200" />
                  <span className="text-[10px] text-dark-200 font-medium">
                    Mastercard
                  </span>
                </div>
                <div className="flex items-center gap-1 bg-dark-400 rounded px-2 py-1">
                  <Smartphone className="h-3.5 w-3.5 text-dark-200" />
                  <span className="text-[10px] text-dark-200 font-medium">
                    M-Pesa
                  </span>
                </div>
                <div className="flex items-center gap-1 bg-dark-400 rounded px-2 py-1">
                  <Smartphone className="h-3.5 w-3.5 text-dark-200" />
                  <span className="text-[10px] text-dark-200 font-medium">
                    Tigo Pesa
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
