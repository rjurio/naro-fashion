"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Crown,
  Star,
  Filter,
  ChevronDown,
  ArrowRight,
  Shield,
  Sparkles,
  Clock,
  CreditCard,
  Loader2,
} from "lucide-react";
import ProductCard from "@/components/ui/ProductCard";
import Button from "@/components/ui/Button";
import { productsApi, categoriesApi } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

function resolveImg(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

interface RentalCategory {
  name: string;
  slug?: string;
  count: number;
}

interface RentalProduct {
  id: string;
  slug: string;
  name: string;
  price: number;
  image: string;
  rating: number;
  reviewCount: number;
  isRentable: boolean;
  rentPrice?: number;
  defaultVariantId?: string;
  categoryName?: string;
}

export default function RentalsPage() {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState(() => "All");
  const [sortBy, setSortBy] = useState("popular");

  // Keep the initial "All" selection in sync when locale changes
  useEffect(() => {
    setSelectedCategory((prev) => (prev === "All" || prev === t('rentals.all') ? t('rentals.all') : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  const [rentalCategories, setRentalCategories] = useState<RentalCategory[]>([]);
  const [rentalProducts, setRentalProducts] = useState<RentalProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const PAGE_SIZE = 12;

  const mapProduct = (p: any): RentalProduct => {
    const primaryImage = p.images?.[0]?.url || p.images?.[0];
    return {
      id: p.id,
      slug: p.slug ?? p.id,
      name: p.name ?? "Unknown",
      price: Number(p.basePrice) || 0,
      image: resolveImg(typeof primaryImage === 'string' ? primaryImage : primaryImage?.url),
      rating: p.avgRating ?? 0,
      reviewCount: p.reviewCount ?? 0,
      isRentable: true,
      rentPrice: p.rentalPricePerDay ? Number(p.rentalPricePerDay) : undefined,
      defaultVariantId: p.variants?.[0]?.id,
      categoryName: p.category?.name,
    };
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [productsRes, categoriesRes] = await Promise.all([
          productsApi.getAll({ availability_mode: "RENTAL_ONLY,BOTH", limit: String(PAGE_SIZE), page: "1" }).catch(() => ({ data: [], total: 0, page: 1, limit: PAGE_SIZE })),
          categoriesApi.getAll().catch(() => []),
        ]);

        const products = (productsRes?.data ?? []).map(mapProduct);
        const total = productsRes?.total ?? 0;
        setRentalProducts(products);
        setCurrentPage(1);
        setHasMore(products.length < total);

        // Build category filter from actual products
        const cats = Array.isArray(categoriesRes) ? categoriesRes : [];
        const catCounts: Record<string, number> = {};
        products.forEach((p) => { if (p.categoryName) catCounts[p.categoryName] = (catCounts[p.categoryName] || 0) + 1; });
        const mappedCats: RentalCategory[] = [
          { name: t('rentals.all'), count: total },
          ...cats
            .filter((c: any) => catCounts[c.name])
            .map((c: any) => ({
              name: c.name ?? "Unknown",
              slug: c.slug,
              count: catCounts[c.name] ?? 0,
            })),
        ];
        setRentalCategories(mappedCats);
      } catch {
        setRentalProducts([]);
        setRentalCategories([{ name: t('rentals.all'), count: 0 }]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const res = await productsApi.getAll({ availability_mode: "RENTAL_ONLY,BOTH", limit: String(PAGE_SIZE), page: String(nextPage) });
      const more = (res?.data ?? []).map(mapProduct);
      setRentalProducts((prev) => [...prev, ...more]);
      setCurrentPage(nextPage);
      setHasMore(rentalProducts.length + more.length < (res?.total ?? 0));
    } catch {
      // silently fail
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="bg-background min-h-screen">
      {/* Hero Banner */}
      <section className="relative bg-gradient-to-br from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A] py-16 lg:py-24 overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-[#D4AF37]/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-[#D4AF37]/10 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#D4AF37]/20 px-4 py-1.5 text-sm text-[#D4AF37] border border-[#D4AF37]/30 mb-6">
            <Crown className="h-4 w-4" />
            {t('rentals.premiumRentalCollection')}
          </span>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-bold text-white">
            {t('rentals.title')}{" "}
            <span className="text-[#D4AF37]">{t('rentals.titleHighlight')}</span>
          </h1>
          <p className="mt-4 text-lg text-gray-300 max-w-2xl mx-auto">
            {t('rentals.subtitle')}
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-12 bg-muted/30 border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-lg font-semibold text-foreground mb-8">
            {t('rentals.howItWorks')}
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Sparkles,
                title: t('rentals.browseAndSelect'),
                desc: t('rentals.browseAndSelectDesc'),
              },
              {
                icon: Clock,
                title: t('rentals.pickYourDates'),
                desc: t('rentals.pickYourDatesDesc'),
              },
              {
                icon: CreditCard,
                title: t('rentals.payDeposit'),
                desc: t('rentals.payDepositDesc'),
              },
              {
                icon: Shield,
                title: t('rentals.idVerification'),
                desc: t('rentals.idVerificationDesc'),
              },
            ].map((step, idx) => (
              <div key={idx} className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gold-500/10 text-gold-600 mb-3">
                  <step.icon className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                <p className="text-xs text-muted-foreground mt-1">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Filters Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
            {rentalCategories.map((cat) => (
              <button
                type="button"
                key={cat.name}
                onClick={() => setSelectedCategory(cat.name)}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  selectedCategory === cat.name
                    ? "bg-gold-500 text-[#1A1A1A]"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {cat.name} ({cat.count})
              </button>
            ))}
          </div>

          <div className="relative">
            <select
              title={t('rentals.sortRentals')}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="appearance-none rounded-lg border border-border bg-card px-4 py-2 pr-8 text-sm font-medium text-foreground outline-none focus:border-gold-500 cursor-pointer"
            >
              <option value="popular">{t('rentals.mostPopular')}</option>
              <option value="price-asc">{t('rentals.rentLowToHigh')}</option>
              <option value="price-desc">{t('rentals.rentHighToLow')}</option>
              <option value="rating">{t('rentals.bestRating')}</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Product Grid */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
                <div className="aspect-[3/4] bg-muted" />
                <div className="p-3 sm:p-4 space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                  <div className="h-5 bg-muted rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : rentalProducts.length === 0 ? (
          <div className="text-center py-16">
            <Crown className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-heading font-bold text-foreground mb-2">
              {t('rentals.noRentalProducts')}
            </h2>
            <p className="text-muted-foreground">
              {t('rentals.noRentalProductsDesc')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {rentalProducts
              .filter((p) => selectedCategory === t('rentals.all') || p.categoryName === selectedCategory)
              .sort((a, b) => {
                if (sortBy === "price-asc") return (a.rentPrice ?? a.price) - (b.rentPrice ?? b.price);
                if (sortBy === "price-desc") return (b.rentPrice ?? b.price) - (a.rentPrice ?? a.price);
                if (sortBy === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
                return (b.reviewCount ?? 0) - (a.reviewCount ?? 0); // popular
              })
              .map((product) => (
              <ProductCard key={product.id} {...product} href={`/rentals/${product.slug}`} />
            ))}
          </div>
        )}

        {/* Load More */}
        {hasMore && (
          <div className="mt-12 text-center">
            <Button type="button" variant="outline" size="lg" onClick={handleLoadMore} disabled={loadingMore}>
              {loadingMore ? <><Loader2 className="inline h-4 w-4 animate-spin mr-2" />{t('rentals.loadingMore')}</> : t('rentals.loadMoreRentals')}
            </Button>
          </div>
        )}
      </div>

      {/* CTA Section */}
      <section className="py-16 bg-gradient-to-r from-[#D4AF37]/10 to-[#D4AF37]/5 border-t border-border">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <Crown className="h-10 w-10 text-gold-500 mx-auto mb-4" />
          <h2 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">
            {t('rentals.cantFind')}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {t('rentals.cantFindDesc')}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/pages/contact">
              <Button variant="secondary" size="lg" className="gap-2">
                {t('common.contactUs')} <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
