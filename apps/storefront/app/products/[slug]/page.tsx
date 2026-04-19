"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import {
  Heart,
  ShoppingCart,
  Star,
  Minus,
  Plus,
  Share2,
  Truck,
  RotateCcw,
  Shield,
  Crown,
  ChevronRight,
  Check,
  Box,
  ImageIcon,
  Loader2,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import ProductCard from "@/components/ui/ProductCard";
import { formatPrice } from "@/lib/utils";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { useTranslation } from "@/lib/i18n";
import { productsApi, reviewsApi, cartApi, wishlistApi } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";

const ModelViewer = dynamic(() => import("@/components/product/ModelViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-muted rounded-2xl">
      <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
    </div>
  ),
});

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

function resolveImageUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

export default function ProductDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const router = useRouter();
  const { settings } = useSiteSettings();
  const { t, locale } = useTranslation();
  const toast = useToast();

  const [product, setProduct] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<"photos" | "3d">("photos");
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [activeTab, setActiveTab] = useState<"description" | "reviews" | "size-guide">("description");
  const [addingToCart, setAddingToCart] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Review form state
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewHover, setReviewHover] = useState(0);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewMsg, setReviewMsg] = useState({ text: '', ok: false });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsLoggedIn(!!localStorage.getItem('token'));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    productsApi.getBySlug(slug)
      .then((data) => {
        setProduct(data);
        // Auto-select first color from variants
        const firstVariantWithColor = (data.variants || []).find((v: any) => v.color && v.isActive !== false);
        if (firstVariantWithColor) setSelectedColor(firstVariantWithColor.color);
        // Auto-select first variant if only one exists
        const activeVariants = (data.variants || []).filter((v: any) => v.isActive !== false);
        if (activeVariants.length === 1) setSelectedSize(activeVariants[0].id);
        // Fetch reviews
        if (data?.id) {
          reviewsApi.getByProduct(data.id)
            .then((r) => setReviews(Array.isArray(r) ? r : r?.data || []))
            .catch(() => setReviews([]));
        }
        // Fetch related products by category
        if (data?.categoryId || data?.category) {
          const catParam = data.categorySlug || data.category?.slug || data.categoryId || "";
          productsApi.getAll({ category: catParam, limit: 4 })
            .then((r) => {
              const items = Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [];
              setRelatedProducts(items.filter((p: any) => p.id !== data.id).slice(0, 4));
            })
            .catch(() => setRelatedProducts([]));
        }
        // Check wishlist status if logged in
        if (data?.id && typeof window !== 'undefined' && localStorage.getItem('token')) {
          wishlistApi.check(data.id)
            .then((r) => setIsWishlisted(r?.inWishlist ?? false))
            .catch(() => {});
        }
      })
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [slug]);

  // Dynamic page title
  useEffect(() => {
    if (product) {
      document.title = `${product.name} | ${settings.businessName}`;
    }
  }, [product]);

  // JSON-LD structured data for SEO
  const jsonLd = product ? {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || "",
    image: product.images?.[0]?.url ? resolveImageUrl(product.images[0].url) : "",
    sku: product.sku || product.id,
    brand: { "@type": "Brand", name: settings.businessName },
    offers: {
      "@type": "Offer",
      url: typeof window !== "undefined" ? window.location.href : "",
      priceCurrency: "TZS",
      price: Number(product.basePrice) || 0,
      availability: "https://schema.org/InStock",
    },
    ...(product.avgRating ? {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: product.avgRating,
        reviewCount: product.reviewCount || 0,
      },
    } : {}),
  } : null;

  const handleAddToCart = async () => {
    if (!product || !selectedSize) return;
    setAddingToCart(true);
    try {
      await cartApi.addItem({ productId: product.id, variantId: selectedSize, quantity });
    } catch {
      // silently fail for now
    } finally {
      setAddingToCart(false);
    }
  };

  const handleToggleWishlist = async () => {
    if (!product) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      router.push('/auth/login');
      return;
    }
    setIsWishlisted(!isWishlisted);
    try {
      const res = await wishlistApi.toggle(product.id);
      setIsWishlisted(res?.added ?? !isWishlisted);
    } catch {
      setIsWishlisted(isWishlisted);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || !reviewRating) {
      setReviewMsg({ text: t('product.pleaseSelectRating'), ok: false });
      return;
    }
    setSubmittingReview(true);
    setReviewMsg({ text: '', ok: false });
    try {
      const newReview = await reviewsApi.create(product.id, {
        rating: reviewRating,
        title: reviewTitle || undefined,
        comment: reviewComment || undefined,
      });
      setReviews((prev) => [newReview, ...prev]);
      setReviewRating(0);
      setReviewTitle('');
      setReviewComment('');
      setReviewMsg({ text: t('product.reviewSubmittedDesc'), ok: true });
    } catch {
      setReviewMsg({ text: t('product.failedSubmitReview'), ok: false });
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-background min-h-screen">
        <div className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
            <nav className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-gold-500 transition-colors">{t("common.home")}</Link>
              <ChevronRight className="h-3 w-3" />
              <Link href="/products" className="hover:text-gold-500 transition-colors">{t("common.products")}</Link>
            </nav>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 animate-pulse">
            <div className="aspect-[3/4] rounded-2xl bg-muted" />
            <div>
              <div className="h-6 w-24 bg-muted rounded mb-3" />
              <div className="h-8 w-72 bg-muted rounded mb-4" />
              <div className="h-10 w-40 bg-muted rounded mb-6" />
              <div className="h-4 w-full bg-muted rounded mb-2" />
              <div className="h-4 w-3/4 bg-muted rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">{t("product.productNotFound")}</h1>
          <p className="text-muted-foreground mb-4">{t("product.productNotFoundDesc")}</p>
          <Link href="/products">
            <Button>{t("product.browseProducts")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Map API fields to display values
  const price = Number(product.basePrice) || 0;
  const images = (product.images || []).map((img: any) => resolveImageUrl(img.url || img));
  const variants = (product.variants || []).filter((v: any) => v.isActive !== false);
  const uniqueSizes = [...new Set(variants.map((v: any) => v.size).filter(Boolean))] as string[];
  const uniqueColors = variants
    .filter((v: any) => v.color)
    .reduce((acc: any[], v: any) => {
      if (!acc.find((c: any) => c.name === v.color)) acc.push({ name: v.color, value: v.colorHex || v.color });
      return acc;
    }, []);
  const stockCount = variants.reduce((sum: number, v: any) => sum + (v.stock || 0), 0);
  const reviewCount = product.reviewCount ?? reviews.length ?? 0;
  const rating = product.avgRating ?? 0;
  const originalPrice = product.compareAtPrice ? Number(product.compareAtPrice) : undefined;
  const discount = originalPrice && originalPrice > price
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : 0;
  const categoryName = product.category?.name || "";
  const rentPrice = product.rentalPricePerDay ? Number(product.rentalPricePerDay) : undefined;
  const isRentable = product.availabilityMode === 'RENTAL_ONLY' || product.availabilityMode === 'BOTH';
  const features: string[] = Array.isArray(product.specifications) ? product.specifications : [];
  // Size guide: product-level overrides category-level
  const sizeGuide = product.sizeGuideRef || product.category?.sizeGuideRef || null;

  // 3D model support
  const has3dModel = !!product?.model3dUrl;

  return (
    <div className="bg-background min-h-screen">
      {/* JSON-LD Structured Data */}
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {/* Breadcrumb */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">{t("common.home")}</Link>
            <ChevronRight className="h-3 w-3" />
            <Link href="/products" className="hover:text-gold-500 transition-colors">{t("common.products")}</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{product.name}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Image Gallery */}
          <div>
            {/* Photos / 3D Toggle */}
            {has3dModel && (
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setViewMode("photos")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                    viewMode === "photos"
                      ? "border-gold-500 bg-gold-500 text-white"
                      : "border-border text-muted-foreground hover:border-gold-500 hover:text-foreground"
                  }`}
                >
                  <ImageIcon className="h-4 w-4" />
                  {t("product.photos")}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("3d")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                    viewMode === "3d"
                      ? "border-gold-500 bg-gold-500 text-white"
                      : "border-border text-muted-foreground hover:border-gold-500 hover:text-foreground"
                  }`}
                >
                  <Box className="h-4 w-4" />
                  {t("product.view3D")}
                </button>
              </div>
            )}

            {/* Main Image / 3D Viewer */}
            <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-muted mb-4">
              {viewMode === "photos" && (
                <>
                  {images[selectedImage] ? (
                    <img
                      src={images[selectedImage]}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      {t("product.noImage")}
                    </div>
                  )}
                </>
              )}

              {viewMode === "3d" && has3dModel && (
                <ModelViewer
                  src={resolveImageUrl(product.model3dUrl)}
                  poster={
                    product.model3dPosterUrl
                      ? resolveImageUrl(product.model3dPosterUrl)
                      : images[0]
                  }
                  alt={`${product.name} - 3D Model`}
                />
              )}

              {/* Badges */}
              <div className="absolute top-4 left-4 flex flex-col gap-2 z-10">
                {discount > 0 && (
                  <Badge variant="sale">-{discount}%</Badge>
                )}
                {isRentable && (
                  <Badge variant="rent">{t("product.rentAvailable")}</Badge>
                )}
              </div>

              {/* Share button */}
              <button
                type="button"
                aria-label={t("product.shareProduct")}
                onClick={async () => {
                  const url = window.location.href;
                  if (navigator.share) {
                    try { await navigator.share({ title: product.name, url }); } catch {}
                  } else {
                    await navigator.clipboard.writeText(url);
                    toast.success(t('product.linkCopied'));
                  }
                }}
                className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-sm hover:scale-110 transition-transform z-10"
              >
                <Share2 className="h-4 w-4 text-gray-700" />
              </button>
            </div>

            {/* Thumbnails (only shown in photos mode) */}
            {viewMode === "photos" && images.length > 1 && (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {images.map((image: string, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedImage(idx)}
                    className={`relative w-20 h-24 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
                      selectedImage === idx
                        ? "border-gold-500 ring-2 ring-gold-500/30"
                        : "border-border hover:border-gold-300"
                    }`}
                  >
                    <img
                      src={image}
                      alt={`${product.name} ${idx + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product Info */}
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                {categoryName && (
                  <p className="text-sm font-medium text-gold-500 mb-1">
                    {categoryName}
                  </p>
                )}
                <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">
                  {product.name}
                </h1>
              </div>
              <button
                type="button"
                onClick={handleToggleWishlist}
                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all ${
                  isWishlisted
                    ? "border-gold-500 bg-gold-500 text-white"
                    : "border-border text-muted-foreground hover:border-gold-500 hover:text-gold-500"
                }`}
              >
                <Heart
                  className="h-5 w-5"
                  fill={isWishlisted ? "currentColor" : "none"}
                />
              </button>
            </div>

            {/* Rating */}
            <div className="flex items-center gap-2 mt-3">
              <div className="flex items-center">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    className={`h-4 w-4 ${
                      i < Math.floor(rating)
                        ? "text-gold-500 fill-gold-500"
                        : "text-gray-300"
                    }`}
                  />
                ))}
              </div>
              <span className="text-sm text-muted-foreground">
                {rating} ({reviewCount} {t("product.reviewsCountSuffix")})
              </span>
            </div>

            {/* Price */}
            <div className="mt-6 flex items-baseline gap-3">
              <span className="text-3xl font-bold text-foreground">
                {formatPrice(price)}
              </span>
              {originalPrice && originalPrice > price && (
                <span className="text-lg text-muted-foreground line-through">
                  {formatPrice(originalPrice)}
                </span>
              )}
              {discount > 0 && (
                <span className="text-sm font-semibold text-gold-500">
                  {t("product.save")} {discount}%
                </span>
              )}
            </div>

            {/* Rental Price */}
            {isRentable && rentPrice && (
              <div className="mt-3 flex items-center gap-2 p-3 rounded-lg bg-gold-500/10 border border-gold-500/30">
                <Crown className="h-5 w-5 text-gold-600" />
                <span className="text-sm font-medium text-gold-700">
                  {t("product.rentalPrice")} {formatPrice(rentPrice)}{t("product.perDay")}
                </span>
              </div>
            )}

            {/* Color Selection */}
            {uniqueColors.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-foreground mb-3">
                  {t("product.color")}: <span className="font-normal text-muted-foreground">{selectedColor}</span>
                </h3>
                <div className="flex gap-3">
                  {uniqueColors.map((color: any) => (
                    <button
                      key={color.name}
                      onClick={() => setSelectedColor(color.name)}
                      title={color.name}
                      className={`w-10 h-10 rounded-full border-2 transition-all ${
                        selectedColor === color.name
                          ? "border-gold-500 ring-2 ring-gold-500/30 scale-110"
                          : "border-border hover:scale-105"
                      }`}
                      style={{ backgroundColor: color.value }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Size / Variant Selection */}
            {uniqueSizes.length > 0 ? (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground">{t("product.size")}</h3>
                  <Link href="/pages/size-guide" className="text-sm text-gold-500 hover:text-gold-600 font-medium">
                    {t("product.sizeGuide")}
                  </Link>
                </div>
                <div className="flex flex-wrap gap-2">
                  {uniqueSizes.map((size) => {
                    const variant = variants.find((v: any) => v.size === size && (!selectedColor || !v.color || v.color === selectedColor));
                    const outOfStock = variant ? variant.stock <= 0 : false;
                    return (
                      <button
                        key={size}
                        onClick={() => !outOfStock && setSelectedSize(variant?.id || size)}
                        disabled={outOfStock}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                          selectedSize === (variant?.id || size)
                            ? "border-gold-500 bg-gold-500 text-white"
                            : outOfStock
                              ? "border-border text-muted-foreground/40 cursor-not-allowed line-through"
                              : "border-border text-foreground hover:border-gold-500"
                        }`}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : variants.length > 0 ? (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-foreground mb-3">{t("product.selectVariant")}</h3>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v: any) => (
                    <button
                      key={v.id}
                      onClick={() => v.stock > 0 && setSelectedSize(v.id)}
                      disabled={v.stock <= 0}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                        selectedSize === v.id
                          ? "border-gold-500 bg-gold-500 text-white"
                          : v.stock <= 0
                            ? "border-border text-muted-foreground/40 cursor-not-allowed"
                            : "border-border text-foreground hover:border-gold-500"
                      }`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Quantity */}
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-foreground mb-3">{t("product.quantity")}</h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="flex h-10 w-14 items-center justify-center text-sm font-medium">
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity(Math.min(stockCount || 99, quantity + 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
                {stockCount > 0 && (
                  <span className="ml-3 text-sm text-muted-foreground">
                    {stockCount} {t("product.inStock")}
                  </span>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              {product.availabilityMode !== 'RENTAL_ONLY' && (
                <Button size="lg" className="flex-1 gap-2" onClick={handleAddToCart} disabled={addingToCart || !selectedSize}>
                  <ShoppingCart className="h-5 w-5" />
                  {addingToCart ? t("product.addingToCart") : !selectedSize ? t("product.selectAVariant") : t("product.addToCart")}
                </Button>
              )}
              {isRentable && (
                <Link href={`/rentals/${product.slug || product.id}`} className="flex-1">
                  <Button variant="secondary" size="lg" className="w-full gap-2">
                    <Crown className="h-5 w-5" />
                    {t("product.rentNow")}
                  </Button>
                </Link>
              )}
            </div>

            {/* Trust Badges */}
            <div className="mt-8 grid grid-cols-3 gap-4">
              <div className="flex flex-col items-center text-center gap-2 p-3 rounded-lg bg-muted/50">
                <Truck className="h-5 w-5 text-gold-500" />
                <span className="text-xs text-muted-foreground">
                  {t("product.freeDelivery")}
                </span>
              </div>
              <div className="flex flex-col items-center text-center gap-2 p-3 rounded-lg bg-muted/50">
                <RotateCcw className="h-5 w-5 text-gold-500" />
                <span className="text-xs text-muted-foreground">
                  {t("product.sevenDayReturns")}
                </span>
              </div>
              <div className="flex flex-col items-center text-center gap-2 p-3 rounded-lg bg-muted/50">
                <Shield className="h-5 w-5 text-gold-500" />
                <span className="text-xs text-muted-foreground">
                  {t("product.securePayment")}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs: Description & Reviews */}
        <div className="mt-16">
          <div className="flex gap-8 border-b border-border">
            <button
              onClick={() => setActiveTab("description")}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "description"
                  ? "border-gold-500 text-gold-500"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("product.description")}
            </button>
            <button
              onClick={() => setActiveTab("reviews")}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "reviews"
                  ? "border-gold-500 text-gold-500"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("product.reviews")} ({reviewCount})
            </button>
            {sizeGuide && (
              <button
                onClick={() => setActiveTab("size-guide")}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "size-guide"
                    ? "border-gold-500 text-gold-500"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t("product.sizeGuide")}
              </button>
            )}
          </div>

          <div className="py-8">
            {activeTab === "description" && (
              <div className="max-w-3xl">
                <p className="text-foreground leading-relaxed">
                  {product.description}
                </p>
                {features.length > 0 && (
                  <>
                    <h3 className="mt-6 text-lg font-semibold text-foreground">
                      {t("product.features")}
                    </h3>
                    <ul className="mt-3 space-y-2">
                      {features.map((feature: string) => (
                        <li key={feature} className="flex items-center gap-2 text-muted-foreground">
                          <Check className="h-4 w-4 text-gold-500 flex-shrink-0" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {activeTab === "size-guide" && sizeGuide && (
              <div className="max-w-3xl">
                <div
                  className="prose prose-sm max-w-none text-muted-foreground
                    prose-headings:text-foreground prose-headings:font-bold
                    prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3
                    prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2
                    prose-p:leading-relaxed prose-p:mb-4
                    prose-ul:list-disc prose-ul:pl-5 prose-ul:mb-4
                    prose-li:mb-1
                    prose-strong:text-foreground
                    prose-table:w-full prose-table:border-collapse
                    prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-xs prose-th:font-semibold prose-th:bg-muted
                    prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-td:text-sm"
                  dangerouslySetInnerHTML={{
                    __html: (locale === 'sw' && sizeGuide.contentSwahili)
                      ? sizeGuide.contentSwahili
                      : sizeGuide.content,
                  }}
                />
                {((locale === 'sw' && sizeGuide.pdfUrlSwahili) || sizeGuide.pdfUrl) && (
                  <div className="mt-6">
                    <a
                      href={(() => {
                        const url = (locale === 'sw' && sizeGuide.pdfUrlSwahili) ? sizeGuide.pdfUrlSwahili : sizeGuide.pdfUrl;
                        return url?.startsWith('/uploads') ? `${(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '')}${url}` : url;
                      })()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:border-gold-500 hover:text-gold-500 transition-colors"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><polyline points="9 15 12 18 15 15" /></svg>
                      {t("product.downloadSizeGuide")}
                    </a>
                  </div>
                )}
              </div>
            )}

            {activeTab === "reviews" && (
              <div className="max-w-3xl space-y-6">
                {/* Write a Review Form */}
                {isLoggedIn ? (
                  <form onSubmit={handleSubmitReview} className="p-6 rounded-xl border border-border bg-card space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">{t("product.writeAReview")}</h3>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">{t("product.rating")} *</label>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: 5 }, (_, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setReviewRating(i + 1)}
                            onMouseEnter={() => setReviewHover(i + 1)}
                            onMouseLeave={() => setReviewHover(0)}
                            className="p-0.5"
                            aria-label={(i === 0 ? t("product.rateStars") : t("product.rateStarsPlural")).replace("{n}", String(i + 1))}
                          >
                            <Star
                              className={`h-6 w-6 transition-colors ${
                                i < (reviewHover || reviewRating)
                                  ? "text-gold-500 fill-gold-500"
                                  : "text-gray-300"
                              }`}
                            />
                          </button>
                        ))}
                        {reviewRating > 0 && (
                          <span className="text-xs text-muted-foreground ml-2">{reviewRating}/5</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">{t("product.titleOptional")}</label>
                      <input
                        type="text"
                        value={reviewTitle}
                        onChange={(e) => setReviewTitle(e.target.value)}
                        placeholder={t("product.summarizeExperience")}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">{t("product.review")}</label>
                      <textarea
                        value={reviewComment}
                        onChange={(e) => setReviewComment(e.target.value)}
                        placeholder={t("product.shareThoughts")}
                        rows={3}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 resize-y"
                      />
                    </div>
                    {reviewMsg.text && (
                      <p className={`text-xs ${reviewMsg.ok ? 'text-green-600' : 'text-red-500'}`}>{reviewMsg.text}</p>
                    )}
                    <Button type="submit" size="sm" disabled={submittingReview || !reviewRating}>
                      {submittingReview ? t("product.submitting") : t("product.submitReview")}
                    </Button>
                  </form>
                ) : (
                  <div className="p-4 rounded-xl border border-dashed border-border text-center">
                    <p className="text-sm text-muted-foreground">
                      <Link href="/auth/login" className="text-gold-500 hover:underline font-medium">{t("product.signIn")}</Link>
                      {' '}{t("product.toWriteReview")}
                    </p>
                  </div>
                )}

                {/* Review List */}
                {reviews.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t("product.noReviewsYet")}</p>
                ) : (
                  reviews.map((review) => (
                    <div
                      key={review.id}
                      className="p-6 rounded-xl border border-border bg-card"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-500 text-white font-bold text-sm">
                          {(review.user?.firstName || review.name || "U").charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-foreground">
                              {review.user?.firstName ? `${review.user.firstName} ${(review.user.lastName || "").charAt(0)}.` : review.name || t("product.anonymous")}
                            </h4>
                            <span className="text-xs text-muted-foreground">
                              {review.createdAt ? new Date(review.createdAt).toLocaleDateString() : review.date || ""}
                            </span>
                          </div>
                          <div className="flex items-center mt-1">
                            {Array.from({ length: 5 }, (_, i) => (
                              <Star
                                key={i}
                                className={`h-3.5 w-3.5 ${
                                  i < (review.rating || 0)
                                    ? "text-gold-500 fill-gold-500"
                                    : "text-gray-300"
                                }`}
                              />
                            ))}
                          </div>
                          {review.title && (
                            <p className="mt-1 text-sm font-medium text-foreground">{review.title}</p>
                          )}
                          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                            {review.comment || review.content || ""}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <div className="mt-16">
            <h2 className="text-2xl font-heading font-bold text-foreground mb-8">
              {t("product.youMayAlsoLike")}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
              {relatedProducts.map((rp) => (
                <ProductCard key={rp.id} {...rp} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
