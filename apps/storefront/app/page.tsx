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
  MapPin,
  Calendar,
} from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ProductCard from "@/components/ui/ProductCard";
import Button from "@/components/ui/Button";
import { formatCountdown } from "@/lib/utils";
import InstagramFeed from "@/components/social/InstagramFeed";
import { categoriesApi, productsApi, flashSalesApi } from "@/lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

interface Category {
  id: string;
  name: string;
  slug: string;
  image?: string;
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
}

interface FlashSale {
  id: string;
  name?: string;
  endsAt: string;
  products?: Product[];
}

export default function HomePage() {
  const [flashSaleSeconds, setFlashSaleSeconds] = useState(0);
  const [email, setEmail] = useState("");

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
        setNewArrivals(
          items.map((p: any) => ({
            ...p,
            isNew: true,
            isOnSale: p.originalPrice && p.originalPrice > p.price,
            isRentable:
              p.availabilityMode === "RENTAL_ONLY" ||
              p.availabilityMode === "BOTH",
          })),
        );
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
            (activeSale.products ?? []).map((p: any) => ({
              ...p,
              isOnSale: true,
            })),
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
      .getAll({ availability_mode: "RENTAL_ONLY,BOTH", limit: 3 })
      .then((res) => {
        const items = res?.data ?? [];
        setRentalGowns(
          items.map((p: any) => ({
            ...p,
            isRentable: true,
          })),
        );
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
    image: cat.image || `/images/categories/${cat.slug}.jpg`,
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
      <section className="relative min-h-[600px] lg:min-h-[700px] flex items-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#D4AF37]/20 to-[#D4AF37]/10" />
        <div className="absolute top-20 right-10 w-72 h-72 rounded-full bg-[#D4AF37]/10 blur-3xl" />
        <div className="absolute bottom-20 left-10 w-96 h-96 rounded-full bg-[#D4AF37]/10 blur-3xl" />

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
              <div>
                <span className="block text-2xl font-bold text-white">500+</span>
                Products
              </div>
              <div className="w-px h-10 bg-gray-700" />
              <div>
                <span className="block text-2xl font-bold text-white">50+</span>
                Gowns for Rent
              </div>
              <div className="w-px h-10 bg-gray-700" />
              <div>
                <span className="block text-2xl font-bold text-white">10K+</span>
                Happy Customers
              </div>
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
                  className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-muted"
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
                New{" "}
                <span className="text-gold-500">Arrivals</span>
              </h2>
              <p className="mt-3 text-muted-foreground">
                Fresh styles just dropped this week
              </p>
            </div>
            <Link
              href="/products?sort=newest"
              className="hidden sm:inline-flex items-center gap-2 text-sm font-medium text-gold-500 hover:text-gold-600 transition-colors"
            >
              View All <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {loadingArrivals ? (
            <LoadingGrid cols={4} />
          ) : newArrivals.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {newArrivals.map((product) => (
                <ProductCard key={product.id} {...product} />
              ))}
            </div>
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
      <section className="py-16 lg:py-20 bg-gradient-to-br from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-[#D4AF37]/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-[#D4AF37]/10 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#D4AF37]/20 px-4 py-1.5 text-sm text-[#D4AF37] border border-[#D4AF37]/30 mb-6">
                <Crown className="h-4 w-4" />
                Premium Rental Service
              </span>
              <h2 className="text-3xl sm:text-4xl font-heading font-bold text-white leading-tight">
                Rent Designer{" "}
                <span className="text-[#D4AF37]">Gowns</span> for
                Your Special Occasion
              </h2>
              <p className="mt-4 text-gray-300 text-lg">
                Why buy when you can rent? Access our exclusive collection of
                designer gowns and formal wear at a fraction of the price.
                Perfect for weddings, galas, and special events.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  "50+ Designer gowns available",
                  "Affordable daily rental rates",
                  "Professional cleaning included",
                  "Easy booking with 25% down payment",
                  "Free alterations available",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-gray-300">
                    <Star className="h-4 w-4 text-[#D4AF37] flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link href="/rentals">
                  <Button
                    variant="secondary"
                    size="lg"
                    className="gap-2"
                  >
                    Browse Gowns <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {loadingRentals ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-[3/4] rounded-2xl bg-white/10 animate-pulse"
                  />
                ))
              ) : rentalGowns.length > 0 ? (
                rentalGowns.map((gown) => (
                  <ProductCard key={gown.id} {...gown} />
                ))
              ) : (
                <p className="text-gray-400 col-span-3 text-center py-8">
                  Rental gowns coming soon!
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

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
                  className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-muted"
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
      {/* Flash Sales */}
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

          {loadingFlashSales ? (
            <LoadingGrid cols={4} />
          ) : flashSaleProducts.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
              {flashSaleProducts.map((product) => (
                <ProductCard key={product.id} {...product} />
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              No active flash sales right now. Stay tuned!
            </p>
          )}

          <div className="mt-8 text-center">
            <Link href="/flash-sales">
              <Button variant="outline" size="md" className="gap-2">
                View All Flash Sales <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Instagram Feed */}
      <InstagramFeed />

      {/* Newsletter Section */}
      <section className="py-16 lg:py-20 bg-gradient-to-r from-[#D4AF37] to-[#D4AF37]/80 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/images/pattern.svg')] opacity-10" />
        <div className="absolute top-10 right-20 w-40 h-40 rounded-full bg-[#D4AF37]/20 blur-2xl" />

        <div className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-heading font-bold text-white">
            Join the Naro Fashion Family
          </h2>
          <p className="mt-4 text-white/80 text-lg">
            Be the first to know about new collections, exclusive offers,
            and flash sale alerts. Get 10% off your first order!
          </p>
          <form
            className="mt-8 flex flex-col sm:flex-row gap-3 max-w-lg mx-auto"
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              type="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 rounded-lg bg-white/20 backdrop-blur-sm border border-white/30 px-5 py-3 text-white placeholder:text-white/60 outline-none focus:border-white focus:ring-2 focus:ring-white/30 transition-all"
            />
            <Button
              variant="secondary"
              size="lg"
              className="shrink-0"
            >
              Subscribe
            </Button>
          </form>
          <p className="mt-4 text-xs text-white/60">
            No spam, unsubscribe anytime. By subscribing you agree to our
            Privacy Policy.
          </p>
        </div>
      </section>
    </div>
  );
}
