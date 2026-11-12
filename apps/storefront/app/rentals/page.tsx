"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import ProductCard from "@/components/ui/ProductCard";
import Button from "@/components/ui/Button";
import { productsApi, rentalsApi } from "@/lib/api";
import { listData, listTotal, rentalHref } from "@/lib/rental-ui";
import { useTranslation } from "@/lib/i18n";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

function resolveImg(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

interface RentalCategory {
  key: string;
  name: string;
  count: number;
}

/** Filter value for "all categories" — independent of the UI language. */
const ALL = "__all__";

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
  availabilityMode?: string;
  defaultVariantId?: string;
  categoryName?: string;
}

export default function RentalsPage() {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL);
  const [sortBy, setSortBy] = useState("popular");
  const [rentalProducts, setRentalProducts] = useState<RentalProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // A failed request is NOT "no rental products" — say so and offer a retry.
  const [loadError, setLoadError] = useState(false);
  // "How it works": only says "no down payment" when the shop's policy is
  // 0 %. Unknown (loading / failed) → the general wording, which is true either way.
  const [downPaymentRequired, setDownPaymentRequired] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
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
      availabilityMode: p.availabilityMode,
      defaultVariantId: p.variants?.[0]?.id,
      categoryName: p.category?.name,
    };
  };

  const fetchPage = (page: number) =>
    productsApi.getAll({ availability_mode: "RENTAL_ONLY,BOTH", limit: String(PAGE_SIZE), page: String(page) });

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetchPage(1);
      const products = listData(res).map(mapProduct);
      setRentalProducts(products);
      // The API returns { data, meta: { total } } — reading a top-level
      // `total` showed "All (0)" and hid "Load more" (11 of 23 gowns).
      setTotal(listTotal(res, products.length));
      setCurrentPage(1);
    } catch {
      setRentalProducts([]);
      setTotal(0);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    rentalsApi.termsSummary()
      .then((r) => { if (!cancelled && r?.downPaymentRequired === false) setDownPaymentRequired(false); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const nextPage = currentPage + 1;
      const res = await fetchPage(nextPage);
      const more = listData(res).map(mapProduct);
      setRentalProducts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...more.filter((p) => !seen.has(p.id))];
      });
      setTotal((prev) => listTotal(res, prev));
      setCurrentPage(nextPage);
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const hasMore = !loadError && rentalProducts.length < total;

  // Category pills come from the loaded rental products themselves (so gowns
  // in subcategories such as "Mermaid" get a pill too); "All" uses the total.
  const rentalCategories: RentalCategory[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of rentalProducts) {
      if (p.categoryName) counts.set(p.categoryName, (counts.get(p.categoryName) ?? 0) + 1);
    }
    return [
      { key: ALL, name: t('rentals.all'), count: total },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ key: name, name, count })),
    ];
  }, [rentalProducts, total, t]);

  const visibleProducts = rentalProducts
    .filter((p) => selectedCategory === ALL || p.categoryName === selectedCategory)
    .sort((a, b) => {
      if (sortBy === "price-asc") return (a.rentPrice ?? a.price) - (b.rentPrice ?? b.price);
      if (sortBy === "price-desc") return (b.rentPrice ?? b.price) - (a.rentPrice ?? a.price);
      if (sortBy === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
      return (b.reviewCount ?? 0) - (a.reviewCount ?? 0); // popular
    });

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
                title: downPaymentRequired ? t('rentals.payDeposit') : t('rentals.noDownPaymentStep'),
                desc: downPaymentRequired ? t('rentals.payDepositDesc') : t('rentals.noDownPaymentStepDesc'),
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
            {!loadError && rentalCategories.map((cat) => (
              <button
                type="button"
                key={cat.key}
                onClick={() => setSelectedCategory(cat.key)}
                data-testid={cat.key === ALL ? "rental-filter-all" : undefined}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  selectedCategory === cat.key
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
        ) : loadError ? (
          <div className="text-center py-16" role="alert" data-testid="rentals-load-error">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-heading font-bold text-foreground mb-2">
              {t('rentals.loadFailed')}
            </h2>
            <p className="text-muted-foreground mb-6">
              {t('rentals.loadFailedDesc')}
            </p>
            <Button type="button" variant="outline" onClick={loadFirstPage} className="gap-2">
              <RotateCcw className="h-4 w-4" /> {t('rentals.retry')}
            </Button>
          </div>
        ) : rentalProducts.length === 0 ? (
          <div className="text-center py-16" data-testid="rentals-empty">
            <Crown className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-heading font-bold text-foreground mb-2">
              {t('rentals.noRentalProducts')}
            </h2>
            <p className="text-muted-foreground">
              {t('rentals.noRentalProductsDesc')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6" data-testid="rentals-grid">
            {visibleProducts.map((product) => (
              <ProductCard
                key={product.id}
                {...product}
                href={rentalHref(product.slug)}
                context="rentals"
              />
            ))}
          </div>
        )}

        {/* Load More */}
        {hasMore && (
          <div className="mt-12 text-center">
            {loadMoreError && (
              <p className="text-sm text-amber-600 mb-3" role="alert">{t('rentals.loadMoreFailed')}</p>
            )}
            <Button type="button" variant="outline" size="lg" onClick={handleLoadMore} disabled={loadingMore} data-testid="rentals-load-more">
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
