"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  SlidersHorizontal,
  X,
  ChevronDown,
  Grid3X3,
  LayoutList,
  Loader2,
  Search,
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

/** Map raw API product to the Product interface used by this page */
function mapApiProduct(p: any): Product {
  const price = Number(p.basePrice) || 0;
  const compareAt = p.compareAtPrice ? Number(p.compareAtPrice) : undefined;
  const primaryImage = p.images?.[0]?.url || p.images?.[0];
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    price,
    originalPrice: compareAt,
    image: resolveImg(typeof primaryImage === 'string' ? primaryImage : primaryImage?.url),
    rating: p.avgRating ?? 0,
    reviewCount: p.reviewCount ?? 0,
    isNew: false,
    isOnSale: compareAt != null && compareAt > price,
    isRentable: p.availabilityMode === 'RENTAL_ONLY' || p.availabilityMode === 'BOTH',
    rentPrice: p.rentalPricePerDay ? Number(p.rentalPricePerDay) : undefined,
    availabilityMode: p.availabilityMode,
    defaultVariantId: p.variants?.[0]?.id,
  };
}

const sizes = ["XS", "S", "M", "L", "XL", "XXL"];

const colors = [
  { name: "Black", value: "#000000" },
  { name: "White", value: "#FFFFFF" },
  { name: "Pink", value: "#E91E8C" },
  { name: "Gold", value: "#D4AF37" },
  { name: "Red", value: "#DC2626" },
  { name: "Blue", value: "#2563EB" },
  { name: "Green", value: "#16A34A" },
];


interface Category {
  id: string;
  name: string;
  slug: string;
  productCount?: number;
}

interface Product {
  id: string;
  name: string;
  slug?: string;
  price: number;
  originalPrice?: number;
  image?: string;
  rating?: number;
  reviewCount?: number;
  isNew?: boolean;
  isOnSale?: boolean;
  isRentable?: boolean;
  rentPrice?: number;
  availabilityMode?: string;
  defaultVariantId?: string;
}

export default function ProductsPage() {
  const searchParams = useSearchParams();
  const urlSearch = searchParams.get("search") || "";
  const { t } = useTranslation();

  // Localized price ranges and sort options (built each render so labels switch with locale)
  const fmt = (n: number) => n.toLocaleString();
  const priceRanges = [
    { label: t("products.underPrice").replace("{price}", fmt(50000)), min: 0, max: 50000 },
    { label: t("products.priceFromTo").replace("{min}", fmt(50000)).replace("{max}", fmt(100000)), min: 50000, max: 100000 },
    { label: t("products.priceFromTo").replace("{min}", fmt(100000)).replace("{max}", fmt(200000)), min: 100000, max: 200000 },
    { label: t("products.priceFromTo").replace("{min}", fmt(200000)).replace("{max}", fmt(500000)), min: 200000, max: 500000 },
    { label: t("products.overPrice").replace("{price}", fmt(500000)), min: 500000, max: 999999999 },
  ];
  const sortOptions = [
    { label: t("products.newest"), value: "newest" },
    { label: t("products.priceLowToHigh"), value: "price-asc" },
    { label: t("products.priceHighToLow"), value: "price-desc" },
    { label: t("products.mostPopular"), value: "popular" },
    { label: t("products.bestRating"), value: "rating" },
  ];

  const [showFilters, setShowFilters] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedPriceRange, setSelectedPriceRange] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState("newest");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchTerm, setSearchTerm] = useState(urlSearch);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Sync search term from URL
  useEffect(() => {
    setSearchTerm(urlSearch);
  }, [urlSearch]);

  // Fetch categories on mount
  useEffect(() => {
    categoriesApi.getAll()
      .then((data) => {
        const cats = Array.isArray(data) ? data : [];
        setCategories(cats);
      })
      .catch(() => {
        setCategories([]);
      });
  }, []);

  // Build query params from filters
  const buildParams = useCallback(
    (pageNum: number): Record<string, string | number> => {
      const params: Record<string, string | number> = {
        page: pageNum,
        limit: 12,
        sort: sortBy,
      };
      if (searchTerm) {
        params.search = searchTerm;
      }
      if (selectedCategory !== "All") {
        params.category = selectedCategory;
      }
      if (selectedSizes.length > 0) {
        params.sizes = selectedSizes.join(",");
      }
      if (selectedColors.length > 0) {
        params.colors = selectedColors.join(",");
      }
      if (selectedPriceRange !== null) {
        const range = priceRanges[selectedPriceRange];
        params.minPrice = range.min;
        params.maxPrice = range.max;
      }
      return params;
    },
    [selectedCategory, selectedSizes, selectedColors, selectedPriceRange, sortBy, searchTerm]
  );

  // Fetch products when filters change
  useEffect(() => {
    setLoading(true);
    setPage(1);
    productsApi
      .getAll(buildParams(1))
      .then((res) => {
        const raw = res?.data ?? [];
        const items = raw.map(mapApiProduct);
        setProducts(items);
        setTotalProducts(res?.meta?.total ?? res?.total ?? items.length);
        setHasMore(items.length >= 12 && items.length < (res?.meta?.total ?? res?.total ?? 0));
      })
      .catch(() => {
        setProducts([]);
        setTotalProducts(0);
        setHasMore(false);
      })
      .finally(() => setLoading(false));
  }, [buildParams]);

  // Load more
  const loadMore = () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    productsApi
      .getAll(buildParams(nextPage))
      .then((res) => {
        const raw = res?.data ?? [];
        const items = raw.map(mapApiProduct);
        setProducts((prev) => [...prev, ...items]);
        setPage(nextPage);
        setHasMore(
          products.length + items.length < (res?.meta?.total ?? res?.total ?? 0)
        );
      })
      .catch(() => {
        setHasMore(false);
      })
      .finally(() => setLoadingMore(false));
  };

  const toggleSize = (size: string) => {
    setSelectedSizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    );
  };

  const toggleColor = (color: string) => {
    setSelectedColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]
    );
  };

  const clearFilters = () => {
    setSelectedCategory("All");
    setSelectedSizes([]);
    setSelectedColors([]);
    setSelectedPriceRange(null);
  };

  const activeFilterCount =
    (selectedCategory !== "All" ? 1 : 0) +
    selectedSizes.length +
    selectedColors.length +
    (selectedPriceRange !== null ? 1 : 0);

  // Map Product to ProductCard props (data already mapped by mapApiProduct)
  const toCardProps = (p: Product) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    price: p.price,
    originalPrice: p.originalPrice,
    image: p.image,
    rating: p.rating ?? 0,
    reviewCount: p.reviewCount ?? 0,
    isNew: p.isNew,
    isOnSale: p.isOnSale,
    isRentable: p.isRentable,
    rentPrice: p.rentPrice,
    defaultVariantId: p.defaultVariantId,
  });

  const allCategories = [
    { name: "All", displayName: t("categories.all"), slug: "all", productCount: totalProducts },
    ...categories.map((c) => ({ ...c, displayName: c.name })),
  ];

  return (
    <div className="bg-background min-h-screen">
      {/* Breadcrumb */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">
              {t("common.home")}
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">{t("common.products")}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">
              {searchTerm ? (
                <span className="flex items-center gap-2">
                  <Search className="h-6 w-6 text-gold-500" />
                  {t("products.resultsFor")} &ldquo;{searchTerm}&rdquo;
                </span>
              ) : t("products.allProducts")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {loading
                ? t("common.loading")
                : `${t("common.showing")} ${products.length} ${t("products.of")} ${totalProducts} ${t("products.results")}`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Mobile filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="lg:hidden inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {t("products.filters")}
              {activeFilterCount > 0 && (
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-gold-500 text-white text-xs">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Sort */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="appearance-none rounded-lg border border-border bg-card px-4 py-2 pr-8 text-sm font-medium text-foreground focus:border-gold-500 focus:ring-1 focus:ring-gold-500 outline-none cursor-pointer"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>

            {/* View Mode */}
            <div className="hidden sm:flex items-center border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 transition-colors ${viewMode === "grid" ? "bg-gold-500 text-white" : "hover:bg-muted text-muted-foreground"}`}
              >
                <Grid3X3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 transition-colors ${viewMode === "list" ? "bg-gold-500 text-white" : "hover:bg-muted text-muted-foreground"}`}
              >
                <LayoutList className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-8">
          {/* Sidebar Filters */}
          <aside
            className={`${
              showFilters ? "fixed inset-0 z-50 bg-background p-6 overflow-y-auto lg:static lg:p-0 lg:z-auto" : "hidden"
            } lg:block lg:w-64 lg:flex-shrink-0`}
          >
            <div className="flex items-center justify-between mb-6 lg:hidden">
              <h2 className="text-lg font-bold">{t("products.filters")}</h2>
              <button onClick={() => setShowFilters(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-sm text-gold-500 hover:text-gold-600 font-medium mb-4"
              >
                {t("products.clearAllFilters")} ({activeFilterCount})
              </button>
            )}

            {/* Categories */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">
                {t("products.category")}
              </h3>
              <div className="space-y-2">
                {allCategories.map((cat: any) => (
                  <button
                    key={cat.name}
                    onClick={() => setSelectedCategory(cat.name)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedCategory === cat.name
                        ? "bg-gold-500/10 text-gold-500 font-medium"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {cat.displayName ?? cat.name}
                    {cat.productCount !== undefined && (
                      <span className="text-xs">({cat.productCount})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Price Range */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">
                {t("products.priceRange")}
              </h3>
              <div className="space-y-2">
                {priceRanges.map((range, idx) => (
                  <button
                    key={idx}
                    onClick={() =>
                      setSelectedPriceRange(selectedPriceRange === idx ? null : idx)
                    }
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedPriceRange === idx
                        ? "bg-gold-500/10 text-gold-500 font-medium"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sizes */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">
                {t("products.size")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {sizes.map((size) => (
                  <button
                    key={size}
                    onClick={() => toggleSize(size)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      selectedSizes.includes(size)
                        ? "border-gold-500 bg-gold-500 text-white"
                        : "border-border text-muted-foreground hover:border-gold-500"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Colors */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">
                {t("products.color")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {colors.map((color) => (
                  <button
                    key={color.name}
                    onClick={() => toggleColor(color.name)}
                    title={color.name}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      selectedColors.includes(color.name)
                        ? "border-gold-500 scale-110 ring-2 ring-gold-500/30"
                        : "border-border hover:scale-105"
                    }`}
                    style={{ backgroundColor: color.value }}
                  />
                ))}
              </div>
            </div>

            {/* Apply button (mobile) */}
            <div className="lg:hidden mt-6">
              <Button
                onClick={() => setShowFilters(false)}
                className="w-full"
              >
                {t("products.applyFilters")}
              </Button>
            </div>
          </aside>

          {/* Product Grid */}
          <div className="flex-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-4" />
                <p>{t("products.loadingProducts")}</p>
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
                <p className="text-lg font-medium mb-2">{t("products.noProducts")}</p>
                <p className="text-sm">{t("products.tryAdjustingFilters")}</p>
                {activeFilterCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearFilters}
                    className="mt-4"
                  >
                    {t("products.clearFilters")}
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div
                  className={
                    viewMode === "grid"
                      ? "grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6"
                      : "space-y-4"
                  }
                >
                  {products.map((product) => (
                    <Link key={product.id} href={`/products/${product.slug || product.id}`}>
                      <ProductCard {...toCardProps(product)} />
                    </Link>
                  ))}
                </div>

                {/* Load More */}
                {hasMore && (
                  <div className="mt-12 text-center">
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={loadMore}
                      disabled={loadingMore}
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          {t("common.loading")}
                        </>
                      ) : (
                        t("products.loadMoreProducts")
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
