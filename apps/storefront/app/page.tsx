"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Crown,
  Sparkles,
  Timer,
  Star,
  ChevronRight,
  Loader2,
  Heart,
  Shield,
  MapPin,
  Calendar,
} from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ProductCard from "@/components/ui/ProductCard";
import Button from "@/components/ui/Button";
import { formatCountdown } from "@/lib/utils";
import InstagramFeed from "@/components/social/InstagramFeed";
import { useTranslation } from "@/lib/i18n";
import { categoriesApi, productsApi, flashSalesApi, cmsApi } from "@/lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
const API_ORIGIN = API_BASE_URL.replace('/api/v1', '');

/** Map API product to ProductCard props */
function mapProduct(p: any, overrides: Partial<Product> = {}): Product {
  const price = Number(p.basePrice) || 0;
  const originalPrice = p.compareAtPrice ? Number(p.compareAtPrice) : undefined;
  const rentPrice = p.rentalPricePerDay ? Number(p.rentalPricePerDay) : undefined;
  const primaryImage = p.images?.[0]?.url;
  const image = primaryImage
    ? (primaryImage.startsWith('/uploads') ? `${API_ORIGIN}${primaryImage}` : primaryImage)
    : undefined;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    price,
    originalPrice,
    image,
    rating: p.avgRating ?? 0,
    reviewCount: p.reviewCount ?? 0,
    rentPrice,
    availabilityMode: p.availabilityMode,
    defaultVariantId: p.variants?.[0]?.id,
    isNew: false,
    isOnSale: originalPrice != null && originalPrice > price,
    isRentable: p.availabilityMode === 'RENTAL_ONLY' || p.availabilityMode === 'BOTH',
    ...overrides,
  };
}

interface Category {
  id: string;
  name: string;
  slug: string;
  image?: string;
  imageUrl?: string;
  _count?: { products: number };
  badge?: string;
}

interface Product {
  id: string;
  name: string;
  slug?: string;
  price: number;
  originalPrice?: number;
  image?: string;
  images?: string[];
  rating?: number;
  reviewCount?: number;
  isNew?: boolean;
  isOnSale?: boolean;
  isRentable?: boolean;
  rentPrice?: number;
  availabilityMode?: string;
  defaultVariantId?: string;
}

interface FlashSale {
  id: string;
  name?: string;
  endsAt: string;
  products?: Product[];
}

/** Default values for CMS settings (English) */
const CMS_DEFAULTS: Record<string, string> = {
  new_arrivals_title: 'New Arrivals',
  new_arrivals_subtitle: 'Fresh styles just dropped this week',
  new_arrivals_layout: 'single_row',
  rental_section_badge: 'Premium Rental Service',
  rental_section_title: 'Rent Designer Gowns for Your Special Occasion',
  rental_section_description: 'Why buy when you can rent? Access our exclusive collection of designer gowns and formal wear at a fraction of the price.',
  rental_section_features: 'Designer gowns\nDaily rental rates\nCleaning included\n25% down payment\nFree alterations',
  rental_section_cta: 'Browse All Gowns',
};

export default function HomePage() {
  const { locale } = useTranslation();
  const [flashSaleSeconds, setFlashSaleSeconds] = useState(0);
  const [showInstagram, setShowInstagram] = useState(true);
  const [showRentalSection, setShowRentalSection] = useState(true);
  const [newArrivalsLayout, setNewArrivalsLayout] = useState<"single_row" | "multi_row">("single_row");
  const [cmsSettings, setCmsSettings] = useState<Record<string, string>>({});

  /** Get a CMS setting value, preferring the Swahili variant when locale is 'sw' */
  const cms = (key: string): string => {
    if (locale === 'sw') {
      const swVal = cmsSettings[`${key}_sw`];
      if (swVal) return swVal;
    }
    return cmsSettings[key] || CMS_DEFAULTS[key] || '';
  };

  // Derived values
  const newArrivalsTitle = cms('new_arrivals_title');
  const newArrivalsSubtitle = cms('new_arrivals_subtitle');
  const rentalBadge = cms('rental_section_badge');
  const rentalTitle = cms('rental_section_title');
  const rentalDescription = cms('rental_section_description');
  const rentalCta = cms('rental_section_cta');
  const rentalFeaturesRaw = cms('rental_section_features');
  const rentalFeatures = rentalFeaturesRaw.split('\n').map((f: string) => f.trim()).filter(Boolean);

  const [categories, setCategories] = useState<Category[]>([]);
  const [newArrivals, setNewArrivals] = useState<Product[]>([]);
  const [flashSaleProducts, setFlashSaleProducts] = useState<Product[]>([]);
  const [rentalGowns, setRentalGowns] = useState<Product[]>([]);

  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingArrivals, setLoadingArrivals] = useState(true);
  const [loadingFlashSales, setLoadingFlashSales] = useState(true);
  const [loadingRentals, setLoadingRentals] = useState(true);
  const [realWeddings, setRealWeddings] = useState<any[]>([]);
  const [loadingWeddings, setLoadingWeddings] = useState(true);
  const [stats, setStats] = useState({ productCount: 0, rentalCount: 0, customerCount: 0 });

  // Hero slides
  const [heroSlides, setHeroSlides] = useState<{ id: string; imageUrl: string; title?: string }[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);

  // Fetch hero slides + site settings
  useEffect(() => {
    cmsApi
      .getHeroSlides()
      .then((data) => setHeroSlides(Array.isArray(data) ? data : []))
      .catch(() => setHeroSlides([]));
    cmsApi
      .getSettings()
      .then((settings) => {
        if (Array.isArray(settings)) {
          const map: Record<string, string> = {};
          settings.forEach((s: any) => { map[s.key] = s.value; });
          setCmsSettings(map);
          if (map.instagram_feed_visible === 'false') setShowInstagram(false);
          if (map.rental_section_visible === 'false') setShowRentalSection(false);
          if (map.new_arrivals_layout === 'multi_row') setNewArrivalsLayout('multi_row');
        }
      })
      .catch(() => {});
    cmsApi
      .getStorefrontStats()
      .then((data) => setStats(data))
      .catch(() => {});
  }, []);

  // Auto-rotate hero slides
  useEffect(() => {
    if (heroSlides.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroSlides.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [heroSlides.length]);

  // Fetch categories
  useEffect(() => {
    categoriesApi
      .getAll()
      .then((data) => {
        const cats = Array.isArray(data) ? data : [];
        setCategories(cats);
      })
      .catch(() => setCategories([]))
      .finally(() => setLoadingCategories(false));
  }, []);

  // Fetch new arrivals
  useEffect(() => {
    productsApi
      .getAll({ sort: "newest", limit: 8 })
      .then((res) => {
        const items = res?.data ?? [];
        setNewArrivals(items.map((p: any) => mapProduct(p, { isNew: true })));
      })
      .catch(() => setNewArrivals([]))
      .finally(() => setLoadingArrivals(false));
  }, []);

  // Fetch flash sales
  useEffect(() => {
    flashSalesApi
      .getActive()
      .then((sales) => {
        const salesArr = Array.isArray(sales) ? sales : [];
        if (salesArr.length > 0) {
          const activeSale = salesArr[0] as FlashSale;
          setFlashSaleProducts(
            (activeSale.products ?? []).map((p: any) => mapProduct(p, { isOnSale: true })),
          );
          // Calculate countdown from endsAt
          if (activeSale.endsAt) {
            const endsAt = new Date(activeSale.endsAt).getTime();
            const now = Date.now();
            const diffSeconds = Math.max(0, Math.floor((endsAt - now) / 1000));
            setFlashSaleSeconds(diffSeconds);
          }
        }
      })
      .catch(() => setFlashSaleProducts([]))
      .finally(() => setLoadingFlashSales(false));
  }, []);

  // Fetch rental gowns
  useEffect(() => {
    productsApi
      .getAll({ availability_mode: "RENTAL_ONLY,BOTH", limit: 6 })
      .then((res) => {
        const items = res?.data ?? [];
        setRentalGowns(items.map((p: any) => mapProduct(p, { isRentable: true })));
      })
      .catch(() => setRentalGowns([]))
      .finally(() => setLoadingRentals(false));
  }, []);

  // Fetch real weddings events
  useEffect(() => {
    fetch(`${API_BASE_URL}/events?page=1&limit=4`)
      .then((res) => res.json())
      .then((data) => setRealWeddings(data?.data || []))
      .catch(() => setRealWeddings([]))
      .finally(() => setLoadingWeddings(false));
  }, []);

  // Countdown timer
  useEffect(() => {
    if (flashSaleSeconds <= 0) return;
    const timer = setInterval(() => {
      setFlashSaleSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [flashSaleSeconds > 0]);

  const countdown = formatCountdown(flashSaleSeconds);

  // Helper to build category display data
  const featuredCategories = categories.slice(0, 4).map((cat) => ({
    name: cat.name,
    image: (() => {
      const url = cat.image || cat.imageUrl || `/uploads/categories/${cat.slug}.jpg`;
      return url.startsWith('/uploads') ? `${API_ORIGIN}${url}` : url;
    })(),
    href:
      cat.slug === "gowns" || cat.name.toLowerCase().includes("gown")
        ? "/rentals"
        : `/products?category=${cat.slug}`,
    itemCount: cat._count?.products ?? 0,
    badge:
      cat.slug === "gowns" || cat.name.toLowerCase().includes("gown")
        ? "Rent Available"
        : undefined,
  }));

  const LoadingGrid = ({ cols = 4 }: { cols?: number }) => (
    <div
      className={`grid grid-cols-2 ${cols === 3 ? "sm:grid-cols-3" : `md:grid-cols-${Math.min(cols, 3)} lg:grid-cols-${cols}`} gap-4 sm:gap-6`}
    >
      {Array.from({ length: cols }).map((_, i) => (
        <div
          key={i}
          className="aspect-[3/4] rounded-2xl bg-muted animate-pulse"
        />
      ))}
    </div>
  );

  return (
    <div>
      {/* Hero Section */}
      <section className="relative min-h-[600px] lg:min-h-[720px] flex items-center overflow-hidden bg-[#0f0a10]">
        {/* AMBIENT BACKDROP: same slide, heavily blurred + darkened.
            Forced object-cover stretching doesn't matter when the
            image is blurred into an abstract mood wash — this gives
            the hero a rich color environment without ever showing
            the photo distorted. */}
        {heroSlides.length > 0 ? (
          heroSlides.map((slide, index) => {
            const src = slide.imageUrl.startsWith('/uploads')
              ? `${API_ORIGIN}${slide.imageUrl}`
              : slide.imageUrl;
            return (
              <div
                key={`bg-${slide.id}`}
                className="absolute inset-0 transition-opacity duration-[1.8s] ease-in-out"
                style={{ opacity: index === currentSlide ? 1 : 0 }}
              >
                <img
                  src={src}
                  alt=""
                  aria-hidden="true"
                  className={`absolute inset-0 w-full h-full object-cover will-change-transform ${
                    index === currentSlide ? 'animate-hero-kenburns' : ''
                  }`}
                  style={{
                    filter: 'blur(42px) brightness(0.55) saturate(1.25)',
                    transform: 'scale(1.15)',
                    transformOrigin: index % 2 === 0 ? 'center center' : 'left center',
                  }}
                />
              </div>
            );
          })
        ) : (
          /* Fallback animated gradient when no slides */
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-br from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A] animate-hero-gradient" />
            <div className="absolute inset-0 overflow-hidden">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-[#D4AF37]/10 animate-hero-float"
                  style={{
                    width: `${60 + i * 40}px`,
                    height: `${60 + i * 40}px`,
                    left: `${10 + i * 15}%`,
                    top: `${20 + (i % 3) * 25}%`,
                    animationDelay: `${i * 1.2}s`,
                    animationDuration: `${8 + i * 2}s`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Dark overlays for text contrast over the ambient backdrop */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/25" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/40" />

        {/* Diagonal gold shimmer sweep — travels across every 8s */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-[5]">
          <div
            className="absolute -top-1/2 left-0 h-[300%] w-1/3 animate-hero-shimmer"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(212,175,55,0.14) 45%, rgba(255,255,255,0.28) 50%, rgba(212,175,55,0.14) 55%, transparent 100%)',
              filter: 'blur(6px)',
            }}
          />
        </div>

        {/* Twinkling gold sparkles scattered across the hero */}
        <div className="pointer-events-none absolute inset-0 z-[6] hidden sm:block">
          {[
            { top: '18%', left: '58%', delay: '0s' },
            { top: '30%', left: '92%', delay: '0.6s' },
            { top: '55%', left: '54%', delay: '1.2s' },
            { top: '72%', left: '95%', delay: '1.8s' },
            { top: '40%', left: '50%', delay: '2.4s' },
            { top: '80%', left: '62%', delay: '0.9s' },
          ].map((s, i) => (
            <span
              key={i}
              className="absolute block h-1.5 w-1.5 rounded-full bg-[#D4AF37] animate-hero-sparkle"
              style={{
                top: s.top,
                left: s.left,
                animationDelay: s.delay,
                boxShadow: '0 0 12px 2px rgba(212,175,55,0.8)',
              }}
            />
          ))}
        </div>

        {/* SHARP FOREGROUND FRAME: the same slide shown at its natural
            portrait aspect ratio inside a gold-framed card. This is the
            "hero subject" — always fully visible, never stretched. The
            blurred backdrop above provides the mood; this provides the
            product clarity. Hidden on mobile (the blurred backdrop
            reads fine on small screens and we keep the text readable). */}
        {heroSlides.length > 0 && (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-[8] hidden md:flex items-center justify-end pr-6 lg:pr-16">
            <div className="relative">
              {/* Rotating decorative gold ring framing the photo */}
              <div
                className="absolute -inset-8 rounded-[2rem] border border-[#D4AF37]/30 animate-hero-orbit"
                style={{ animationDuration: '60s' }}
              />
              <div
                className="absolute -inset-4 rounded-[1.75rem] border border-dashed border-[#D4AF37]/25 animate-hero-orbit"
                style={{ animationDirection: 'reverse', animationDuration: '90s' }}
              />

              {/* The actual photo card — aspect-[3/4] keeps portrait framing */}
              <div className="relative w-[260px] sm:w-[300px] lg:w-[360px] aspect-[3/4] rounded-3xl overflow-hidden shadow-[0_25px_80px_-15px_rgba(212,175,55,0.45)] ring-1 ring-[#D4AF37]/50 animate-hero-ring-pulse bg-[#1A1A1A]">
                {heroSlides.map((slide, index) => {
                  const src = slide.imageUrl.startsWith('/uploads')
                    ? `${API_ORIGIN}${slide.imageUrl}`
                    : slide.imageUrl;
                  return (
                    <img
                      key={`fg-${slide.id}`}
                      src={src}
                      alt={slide.title || 'Featured bridal gown'}
                      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-[1.2s] ease-in-out ${
                        index === currentSlide ? 'animate-hero-kenburns' : ''
                      }`}
                      style={{
                        opacity: index === currentSlide ? 1 : 0,
                        transformOrigin: index % 2 === 0 ? 'center center' : 'left center',
                      }}
                    />
                  );
                })}

                {/* Subtle bottom gradient so the title caption is readable */}
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                {/* Caption: current slide title with gold accent bar */}
                {heroSlides[currentSlide]?.title && (
                  <div className="absolute bottom-0 left-0 right-0 p-4 lg:p-5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="block h-[2px] w-8 bg-[#D4AF37]" />
                      <span className="text-[10px] uppercase tracking-[0.2em] text-[#D4AF37] font-semibold">
                        Featured
                      </span>
                    </div>
                    <p className="text-white text-sm lg:text-base font-semibold leading-tight drop-shadow-lg line-clamp-2">
                      {heroSlides[currentSlide].title}
                    </p>
                  </div>
                )}

                {/* Diagonal light streak inside the frame for liveliness */}
                <div
                  className="absolute inset-0 pointer-events-none animate-hero-shimmer"
                  style={{
                    background:
                      'linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%)',
                    animationDuration: '6s',
                  }}
                />
              </div>

              {/* Small floating gold corner accents */}
              <span className="absolute -top-2 -left-2 h-3 w-3 rotate-45 bg-[#D4AF37] rounded-sm shadow-lg animate-hero-sparkle" />
              <span
                className="absolute -bottom-2 -right-2 h-3 w-3 rotate-45 bg-[#D4AF37] rounded-sm shadow-lg animate-hero-sparkle"
                style={{ animationDelay: '1.2s' }}
              />
            </div>
          </div>
        )}

        {/* Slide indicators */}
        {heroSlides.length > 1 && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
            {heroSlides.map((_, index) => (
              <button
                key={index}
                type="button"
                title={`Go to slide ${index + 1}`}
                onClick={() => setCurrentSlide(index)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === currentSlide
                    ? 'w-8 bg-[#D4AF37]'
                    : 'w-2 bg-white/50 hover:bg-white/80'
                }`}
              />
            ))}
          </div>
        )}

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-sm px-4 py-1.5 text-sm text-[#D4AF37] border border-[#D4AF37]/30 mb-6">
              <Sparkles className="h-4 w-4" />
              New Collection 2026
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-heading font-bold text-white leading-tight">
              Elevate Your{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#D4AF37] to-[#D4AF37]">
                Style
              </span>
              <br />
              Define Your{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#D4AF37] to-[#D4AF37]">
                Story
              </span>
            </h1>
            <p className="mt-6 text-lg text-gray-300 max-w-lg">
              Discover premium fashion, rent designer gowns, and grab exclusive
              flash sale deals. Tanzania&apos;s premier online fashion
              destination.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/products">
                <Button size="lg" className="gap-2">
                  Shop Now
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <Link href="/rentals">
                <Button variant="outline" size="lg" className="gap-2 border-[#D4AF37] text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#1A1A1A]">
                  <Crown className="h-5 w-5" />
                  Rent a Gown
                </Button>
              </Link>
            </div>
            <div className="mt-10 flex items-center gap-8 text-gray-400 text-sm">
              {stats.productCount > 0 && (
                <>
                  <div>
                    <span className="block text-2xl font-bold text-white">{stats.productCount.toLocaleString()}</span>
                    Products
                  </div>
                  <div className="w-px h-10 bg-gray-700" />
                </>
              )}
              {stats.rentalCount > 0 && (
                <>
                  <div>
                    <span className="block text-2xl font-bold text-white">{stats.rentalCount.toLocaleString()}</span>
                    Gowns for Rent
                  </div>
                  <div className="w-px h-10 bg-gray-700" />
                </>
              )}
              {stats.customerCount > 0 && (
                <div>
                  <span className="block text-2xl font-bold text-white">{stats.customerCount.toLocaleString()}</span>
                  Happy Customers
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Featured Categories */}
      <section className="py-16 lg:py-20 bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground">
              Shop by{" "}
              <span className="text-gold-500">Category</span>
            </h2>
            <p className="mt-3 text-muted-foreground max-w-md mx-auto">
              Browse our curated collections for every occasion
            </p>
          </div>

          {loadingCategories ? (
            <LoadingGrid cols={4} />
          ) : featuredCategories.length > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {featuredCategories.map((category) => (
                <Link
                  key={category.name}
                  href={category.href}
                  className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-muted hover:shadow-xl transition-all duration-300"
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-[#1A1A1A]/80 via-[#1A1A1A]/20 to-transparent z-10" />
                  <div
                    className="absolute inset-0 bg-muted transition-transform duration-500 group-hover:scale-110"
                    style={{
                      backgroundImage: `url(${category.image})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                  <div className="absolute bottom-0 left-0 right-0 z-20 p-4 sm:p-6">
                    {category.badge && (
                      <span className="inline-block mb-2 text-xs font-semibold uppercase tracking-wide bg-[#D4AF37] text-[#1A1A1A] px-2.5 py-0.5 rounded-full">
                        {category.badge}
                      </span>
                    )}
                    <h3 className="text-lg sm:text-xl font-bold text-white">
                      {category.name}
                    </h3>
                    <p className="text-sm text-gray-300 mt-1">
                      {category.itemCount} items
                    </p>
                    <span className="inline-flex items-center gap-1 text-sm text-[#D4AF37] mt-2 group-hover:gap-2 transition-all">
                      Explore <ChevronRight className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground">
              No categories available at the moment.
            </p>
          )}
        </div>
      </section>

      {/* New Arrivals */}
      <section className="py-16 lg:py-20 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-10">
            <div>
              <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground">
                {newArrivalsTitle.includes(" ") ? (
                  <>
                    {newArrivalsTitle.split(" ").slice(0, -1).join(" ")}{" "}
                    <span className="text-gold-500">{newArrivalsTitle.split(" ").pop()}</span>
                  </>
                ) : (
                  <span className="text-gold-500">{newArrivalsTitle}</span>
                )}
              </h2>
              <p className="mt-3 text-muted-foreground">
                {newArrivalsSubtitle}
              </p>
            </div>
            <Link
              href="/products?sort=newest"
              className="hidden sm:inline-flex items-center gap-2 text-sm font-medium text-gold-500 hover:text-gold-600 hover:gap-3 transition-all"
            >
              View All <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {loadingArrivals ? (
            <LoadingGrid cols={4} />
          ) : newArrivals.length > 0 ? (
            newArrivalsLayout === "single_row" ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
                {newArrivals.slice(0, 4).map((product) => (
                  <ProductCard key={product.id} {...product} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
                {newArrivals.map((product) => (
                  <ProductCard key={product.id} {...product} />
                ))}
              </div>
            )
          ) : (
            <p className="text-center text-muted-foreground py-8">
              No new arrivals at the moment. Check back soon!
            </p>
          )}

          <div className="mt-8 text-center sm:hidden">
            <Link href="/products?sort=newest">
              <Button variant="outline" size="md" className="gap-2">
                View All New Arrivals <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Rent a Gown Section */}
      {showRentalSection && (
      <section className="py-16 lg:py-20 bg-gradient-to-br from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-[#D4AF37]/8 blur-[100px]" />
        <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-[#D4AF37]/8 blur-[100px]" />

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="text-center mb-12">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#D4AF37]/20 px-4 py-1.5 text-sm text-[#D4AF37] border border-[#D4AF37]/30 mb-4">
              <Crown className="h-4 w-4" />
              {rentalBadge}
            </span>
            <h2 className="text-3xl sm:text-4xl font-heading font-bold text-white leading-tight">
              {rentalTitle}
            </h2>
            <p className="mt-3 text-gray-400 text-lg max-w-2xl mx-auto">
              {rentalDescription}
            </p>
          </div>

          {/* Features row */}
          {rentalFeatures.length > 0 && (
            <div className="flex flex-wrap justify-center gap-3 mb-12">
              {rentalFeatures.map((text, i) => {
                const icons = [Crown, Star, Sparkles, Shield, Heart, Star, Crown, Sparkles];
                const Icon = icons[i % icons.length];
                return (
                  <div key={text} className="flex items-center gap-2.5 bg-white/5 rounded-xl px-4 py-3 border border-white/10">
                    <Icon className="h-4 w-4 text-[#D4AF37] flex-shrink-0" />
                    <span className="text-sm text-gray-300">{text}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Product grid */}
          {loadingRentals ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] rounded-2xl bg-white/10 animate-pulse" />
              ))}
            </div>
          ) : rentalGowns.length > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {rentalGowns.map((gown) => (
                <ProductCard key={gown.id} {...gown} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-20 h-20 rounded-full bg-[#D4AF37]/10 flex items-center justify-center mb-4">
                <Crown className="h-10 w-10 text-[#D4AF37]" />
              </div>
              <p className="text-white text-lg font-medium">Our rental collection is being prepared</p>
              <p className="text-gray-400 mt-1 max-w-md">We&apos;re curating an exquisite selection of designer gowns. Check back soon or contact us to reserve.</p>
            </div>
          )}

          {/* CTA */}
          <div className="mt-10 text-center">
            <Link href="/rentals">
              <Button variant="secondary" size="lg" className="gap-2">
                {rentalCta} <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
      )}

      {/* Real Weddings */}
      {realWeddings.length > 0 && (
        <section className="py-16 lg:py-20 bg-[#FFF8F0] dark:bg-muted/20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <span className="inline-flex items-center gap-2 rounded-full bg-[#D4AF37]/10 px-4 py-1.5 text-sm text-[#D4AF37] border border-[#D4AF37]/30 mb-4">
                <Heart className="h-4 w-4" />
                Love Stories
              </span>
              <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground">
                Real <span className="text-gold-500">Weddings</span>
              </h2>
              <p className="mt-3 text-muted-foreground max-w-md mx-auto">
                See our beautiful brides and their special moments
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {realWeddings.map((event: any) => (
                <Link
                  key={event.id}
                  href={`/events/${event.slug}`}
                  className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-muted hover:shadow-xl transition-all duration-300"
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent z-10" />
                  {event.coverImageUrl ? (
                    <img
                      src={event.coverImageUrl}
                      alt={event.title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                  ) : event.media?.[0]?.url ? (
                    <img
                      src={event.media[0].url}
                      alt={event.title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-[#D4AF37]/20 to-[#1A1A1A]/40" />
                  )}
                  <div className="absolute bottom-0 left-0 right-0 z-20 p-4 border-l-4 border-[#D4AF37]">
                    <h3 className="text-lg font-bold text-white line-clamp-1">
                      {event.title}
                    </h3>
                    {event.eventDate && (
                      <p className="flex items-center gap-1 text-sm text-gray-300 mt-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(event.eventDate).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    )}
                    {event.location && (
                      <p className="flex items-center gap-1 text-sm text-gray-300 mt-0.5">
                        <MapPin className="h-3 w-3" />
                        {event.location}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
            <div className="mt-10 text-center">
              <Link href="/events">
                <Button
                  variant="outline"
                  size="md"
                  className="gap-2 border-[#D4AF37] text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#1A1A1A]"
                >
                  View All Real Weddings <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}
      {/* Flash Sales — only shown when there are active flash sale products */}
      {!loadingFlashSales && flashSaleProducts.length > 0 && (
        <section className="py-16 lg:py-20 bg-background">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between mb-10 gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground">
                    Flash{" "}
                    <span className="text-gold-500">Sales</span>
                  </h2>
                  <span className="inline-block h-3 w-3 rounded-full bg-gold-500 animate-pulse" />
                </div>
                <p className="text-muted-foreground">
                  Limited time deals - grab them before they&apos;re gone!
                </p>
              </div>

              {/* Countdown Timer */}
              {flashSaleSeconds > 0 && (
                <div className="flex items-center gap-3">
                  <Timer className="h-5 w-5 text-gold-500" />
                  <div className="flex items-center gap-2">
                    {[
                      { label: "Days", value: countdown.days },
                      { label: "Hrs", value: countdown.hours },
                      { label: "Min", value: countdown.minutes },
                      { label: "Sec", value: countdown.secs },
                    ].map((unit, i) => (
                      <div key={unit.label} className="flex items-center gap-2">
                        <div className="flex flex-col items-center">
                          <span className="bg-[#1A1A1A] text-white text-lg sm:text-xl font-bold rounded-lg px-3 py-1.5 min-w-[48px] text-center">
                            {String(unit.value).padStart(2, "0")}
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-1 uppercase">
                            {unit.label}
                          </span>
                        </div>
                        {i < 3 && (
                          <span className="text-xl font-bold text-muted-foreground mb-4">
                            :
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
              {flashSaleProducts.map((product) => (
                <ProductCard key={product.id} {...product} />
              ))}
            </div>

            <div className="mt-8 text-center">
              <Link href="/flash-sales">
                <Button variant="outline" size="md" className="gap-2">
                  View All Flash Sales <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Instagram Feed */}
      {showInstagram && <InstagramFeed />}

    </div>
  );
}
