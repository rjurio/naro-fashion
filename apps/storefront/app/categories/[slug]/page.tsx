"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  SlidersHorizontal,
  X,
  ChevronDown,
  Grid3X3,
  LayoutList,
  Star,
  ShoppingCart,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { formatPrice } from "@/lib/utils";
import { categoriesApi, productsApi } from "@/lib/api";

const sizes = ["XS", "S", "M", "L", "XL", "XXL"];
const colors = [
  { name: "Black", value: "#000000" },
  { name: "White", value: "#FFFFFF" },
  { name: "Pink", value: "#D4AF37" },
  { name: "Gold", value: "#D4AF37" },
  { name: "Red", value: "#DC2626" },
  { name: "Blue", value: "#2563EB" },
];
const priceRanges = [
  { label: "Under TZS 50,000", min: 0, max: 50000 },
  { label: "TZS 50,000 - 100,000", min: 50000, max: 100000 },
  { label: "TZS 100,000 - 200,000", min: 100000, max: 200000 },
  { label: "Over TZS 200,000", min: 200000, max: Infinity },
];
const sortOptions = [
  { label: "Newest", value: "newest" },
  { label: "Price: Low to High", value: "price-asc" },
  { label: "Price: High to Low", value: "price-desc" },
  { label: "Most Popular", value: "popular" },
];

export default function CategoryPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [category, setCategory] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedPriceRange, setSelectedPriceRange] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState("newest");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      categoriesApi.getBySlug(slug).catch(() => null),
      productsApi.getAll({ category: slug }).catch(() => ({ data: [] })),
    ]).then(([cat, prods]) => {
      setCategory(cat);
      setProducts(Array.isArray(prods?.data) ? prods.data : Array.isArray(prods) ? prods : []);
      setLoading(false);
    });
  }, [slug]);

  const toggleSize = (size: string) => {
    setSelectedSizes((prev) => prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]);
  };
  const toggleColor = (color: string) => {
    setSelectedColors((prev) => prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]);
  };
  const activeFilterCount = selectedSizes.length + selectedColors.length + (selectedPriceRange !== null ? 1 : 0);

  const categoryName = category?.name || slug;
  const categoryDescription = category?.description || "";
  const subcategories = category?.subcategories || category?.children || [];

  if (loading) {
    return (
      <div className="bg-background min-h-screen">
        <div className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
            <nav className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-gold-500 transition-colors">Home</Link>
              <span>/</span>
              <Link href="/categories" className="hover:text-gold-500 transition-colors">Categories</Link>
              <span>/</span>
              <span className="text-foreground font-medium">{slug}</span>
            </nav>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse">
            <div className="h-8 w-48 bg-muted rounded mb-4" />
            <div className="h-4 w-96 bg-muted rounded mb-8" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="aspect-[3/4] bg-muted" />
                  <div className="p-3">
                    <div className="h-4 w-32 bg-muted rounded mb-2" />
                    <div className="h-4 w-20 bg-muted rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      {/* Breadcrumb */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">Home</Link>
            <span>/</span>
            <Link href="/categories" className="hover:text-gold-500 transition-colors">Categories</Link>
            <span>/</span>
            <span className="text-foreground font-medium">{categoryName}</span>
          </nav>
        </div>
      </div>

      {/* Category Header */}
      <div className="bg-gradient-to-r from-gold-500/5 to-gold-500/5 border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">{categoryName}</h1>
          {categoryDescription && (
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm sm:text-base">{categoryDescription}</p>
          )}
          {/* Subcategory chips */}
          {subcategories.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {subcategories.map((sub: any) => (
                <Link
                  key={sub.slug || sub.id}
                  href={`/categories/${sub.slug}`}
                  className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border border-border bg-card text-foreground hover:border-gold-500 hover:text-gold-500 transition-colors"
                >
                  {sub.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <p className="text-sm text-muted-foreground">{products.length} products</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="lg:hidden inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-gold-500 text-white text-xs">{activeFilterCount}</span>
              )}
            </button>
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="appearance-none rounded-lg border border-border bg-card px-4 py-2 pr-8 text-sm font-medium text-foreground focus:border-gold-500 outline-none cursor-pointer"
              >
                {sortOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
            <div className="hidden sm:flex items-center border border-border rounded-lg overflow-hidden">
              <button onClick={() => setViewMode("grid")} className={`p-2 transition-colors ${viewMode === "grid" ? "bg-gold-500 text-white" : "hover:bg-muted text-muted-foreground"}`}>
                <Grid3X3 className="h-4 w-4" />
              </button>
              <button onClick={() => setViewMode("list")} className={`p-2 transition-colors ${viewMode === "list" ? "bg-gold-500 text-white" : "hover:bg-muted text-muted-foreground"}`}>
                <LayoutList className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-8">
          {/* Filters Sidebar */}
          <aside className={`${showFilters ? "fixed inset-0 z-50 bg-background p-6 overflow-y-auto lg:static lg:p-0 lg:z-auto" : "hidden"} lg:block lg:w-60 lg:flex-shrink-0`}>
            <div className="flex items-center justify-between mb-6 lg:hidden">
              <h2 className="text-lg font-bold">Filters</h2>
              <button onClick={() => setShowFilters(false)}><X className="h-5 w-5" /></button>
            </div>

            {activeFilterCount > 0 && (
              <button onClick={() => { setSelectedSizes([]); setSelectedColors([]); setSelectedPriceRange(null); }} className="text-sm text-gold-500 hover:text-gold-600 font-medium mb-4">
                Clear all ({activeFilterCount})
              </button>
            )}

            {/* Price */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">Price Range</h3>
              <div className="space-y-2">
                {priceRanges.map((range, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedPriceRange(selectedPriceRange === idx ? null : idx)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedPriceRange === idx ? "bg-gold-500/10 text-gold-500 font-medium" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sizes */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">Size</h3>
              <div className="flex flex-wrap gap-2">
                {sizes.map((size) => (
                  <button
                    key={size}
                    onClick={() => toggleSize(size)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${selectedSizes.includes(size) ? "border-gold-500 bg-gold-500 text-white" : "border-border text-muted-foreground hover:border-gold-500"}`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Colors */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">Color</h3>
              <div className="flex flex-wrap gap-2">
                {colors.map((color) => (
                  <button
                    key={color.name}
                    onClick={() => toggleColor(color.name)}
                    title={color.name}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${selectedColors.includes(color.name) ? "border-gold-500 scale-110 ring-2 ring-gold-500/30" : "border-border hover:scale-105"}`}
                    style={{ backgroundColor: color.value }}
                  />
                ))}
              </div>
            </div>

            <div className="lg:hidden mt-6">
              <Button onClick={() => setShowFilters(false)} className="w-full">Apply Filters</Button>
            </div>
          </aside>

          {/* Product Grid */}
          <div className="flex-1">
            {products.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-muted-foreground">No products found in this category.</p>
              </div>
            ) : (
              <div className={viewMode === "grid" ? "grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6" : "space-y-4"}>
                {products.map((product) => (
                  <Link key={product.id} href={`/products/${product.slug || product.id}`}>
                    <div className="group rounded-xl border border-border bg-card overflow-hidden hover:border-gold-500/50 transition-colors">
                      <div className="relative">
                        <div
                          className="aspect-[3/4] bg-muted"
                          style={{ backgroundImage: `url(${product.images?.[0] || product.image || ""})`, backgroundSize: "cover", backgroundPosition: "center" }}
                        />
                        {product.originalPrice && product.originalPrice > product.price && (
                          <span className="absolute top-2 left-2 bg-gold-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                            -{Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}%
                          </span>
                        )}
                      </div>
                      <div className="p-3">
                        <h3 className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-gold-500 transition-colors">
                          {product.name}
                        </h3>
                        <div className="flex items-center gap-1 mt-1">
                          <Star className="h-3 w-3 fill-gold-500 text-gold-500" />
                          <span className="text-xs text-muted-foreground">{product.rating ?? 0} ({product.reviewCount ?? 0})</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-sm font-bold text-foreground">{formatPrice(product.price)}</span>
                          {product.originalPrice && product.originalPrice > product.price && (
                            <span className="text-xs text-muted-foreground line-through">{formatPrice(product.originalPrice)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Load More */}
            {products.length > 0 && (
              <div className="mt-12 text-center">
                <Button variant="outline" size="lg">Load More Products</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
