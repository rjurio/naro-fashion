"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import ProductCard from "@/components/ui/ProductCard";
import { formatPrice } from "@/lib/utils";
import { productsApi, reviewsApi, cartApi, wishlistApi } from "@/lib/api";

export default function ProductDetailPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [product, setProduct] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [activeTab, setActiveTab] = useState<"description" | "reviews">("description");
  const [addingToCart, setAddingToCart] = useState(false);

  useEffect(() => {
    setLoading(true);
    productsApi.getBySlug(slug)
      .then((data) => {
        setProduct(data);
        if (data?.colors?.length) setSelectedColor(data.colors[0].name || data.colors[0]);
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
      })
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [slug]);

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
    setIsWishlisted(!isWishlisted);
    try {
      await wishlistApi.toggle(product.id);
    } catch {
      setIsWishlisted(isWishlisted);
    }
  };

  if (loading) {
    return (
      <div className="bg-background min-h-screen">
        <div className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
            <nav className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-gold-500 transition-colors">Home</Link>
              <ChevronRight className="h-3 w-3" />
              <Link href="/products" className="hover:text-gold-500 transition-colors">Products</Link>
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
          <h1 className="text-2xl font-bold text-foreground mb-2">Product Not Found</h1>
          <p className="text-muted-foreground mb-4">The product you are looking for does not exist.</p>
          <Link href="/products">
            <Button>Browse Products</Button>
          </Link>
        </div>
      </div>
    );
  }

  const images = product.images || [];
  const productColors = product.colors || [];
  const productSizes = product.sizes || [];
  const features = product.features || [];
  const stockCount = product.stockCount ?? product.stock ?? 0;
  const reviewCount = product.reviewCount ?? reviews.length ?? 0;
  const rating = product.rating ?? 0;
  const originalPrice = product.originalPrice ?? product.compareAtPrice;
  const discount = originalPrice && originalPrice > product.price
    ? Math.round(((originalPrice - product.price) / originalPrice) * 100)
    : 0;
  const categoryName = product.category?.name || product.categoryName || "";

  return (
    <div className="bg-background min-h-screen">
      {/* Breadcrumb */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">Home</Link>
            <ChevronRight className="h-3 w-3" />
            <Link href="/products" className="hover:text-gold-500 transition-colors">Products</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{product.name}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Image Gallery */}
          <div>
            {/* Main Image */}
            <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-muted mb-4">
              <div
                className="h-full w-full bg-muted flex items-center justify-center text-muted-foreground"
                style={{
                  backgroundImage: images[selectedImage] ? `url(${images[selectedImage]})` : undefined,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              >
                {!images[selectedImage] && "Product Image"}
              </div>

              {/* Badges */}
              <div className="absolute top-4 left-4 flex flex-col gap-2">
                {product.isNew && <Badge variant="new">New</Badge>}
                {product.isOnSale && discount > 0 && (
                  <Badge variant="sale">-{discount}%</Badge>
                )}
                {product.isRentable && (
                  <Badge variant="rent">Rent Available</Badge>
                )}
              </div>

              {/* Share button */}
              <button className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-sm hover:scale-110 transition-transform">
                <Share2 className="h-4 w-4 text-gray-700" />
              </button>
            </div>

            {/* Thumbnails */}
            {images.length > 0 && (
              <div className="flex gap-3">
                {images.map((image: string, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedImage(idx)}
                    className={`relative w-20 h-24 rounded-lg overflow-hidden border-2 transition-all ${
                      selectedImage === idx
                        ? "border-gold-500 ring-2 ring-gold-500/30"
                        : "border-border hover:border-gold-300"
                    }`}
                  >
                    <div
                      className="h-full w-full bg-muted"
                      style={{
                        backgroundImage: `url(${image})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
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
                {rating} ({reviewCount} reviews)
              </span>
            </div>

            {/* Price */}
            <div className="mt-6 flex items-baseline gap-3">
              <span className="text-3xl font-bold text-foreground">
                {formatPrice(product.price)}
              </span>
              {originalPrice && originalPrice > product.price && (
                <span className="text-lg text-muted-foreground line-through">
                  {formatPrice(originalPrice)}
                </span>
              )}
              {discount > 0 && (
                <span className="text-sm font-semibold text-gold-500">
                  Save {discount}%
                </span>
              )}
            </div>

            {/* Rental Price */}
            {product.isRentable && product.rentPrice && (
              <div className="mt-3 flex items-center gap-2 p-3 rounded-lg bg-gold-500/10 border border-gold-500/30">
                <Crown className="h-5 w-5 text-gold-600" />
                <span className="text-sm font-medium text-gold-700">
                  Available for rent from {formatPrice(product.rentPrice)}/day
                </span>
              </div>
            )}

            {/* Color Selection */}
            {productColors.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-foreground mb-3">
                  Color: <span className="font-normal text-muted-foreground">{selectedColor}</span>
                </h3>
                <div className="flex gap-3">
                  {productColors.map((color: any) => {
                    const colorName = typeof color === "string" ? color : color.name;
                    const colorValue = typeof color === "string" ? color : color.value;
                    return (
                      <button
                        key={colorName}
                        onClick={() => setSelectedColor(colorName)}
                        title={colorName}
                        className={`w-10 h-10 rounded-full border-2 transition-all ${
                          selectedColor === colorName
                            ? "border-gold-500 ring-2 ring-gold-500/30 scale-110"
                            : "border-border hover:scale-105"
                        }`}
                        style={{ backgroundColor: colorValue }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Size Selection */}
            {productSizes.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground">Size</h3>
                  <button className="text-sm text-gold-500 hover:text-gold-600 font-medium">
                    Size Guide
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {productSizes.map((size: string) => (
                    <button
                      key={size}
                      onClick={() => setSelectedSize(size)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                        selectedSize === size
                          ? "border-gold-500 bg-gold-500 text-white"
                          : "border-border text-foreground hover:border-gold-500"
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity */}
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-foreground mb-3">Quantity</h3>
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
                    {stockCount} in stock
                  </span>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Button size="lg" className="flex-1 gap-2" onClick={handleAddToCart} disabled={addingToCart}>
                <ShoppingCart className="h-5 w-5" />
                {addingToCart ? "Adding..." : "Add to Cart"}
              </Button>
              {product.isRentable && (
                <Link href={`/rentals/${product.slug || product.id}`} className="flex-1">
                  <Button variant="secondary" size="lg" className="w-full gap-2">
                    <Crown className="h-5 w-5" />
                    Rent This Item
                  </Button>
                </Link>
              )}
            </div>

            {/* Trust Badges */}
            <div className="mt-8 grid grid-cols-3 gap-4">
              <div className="flex flex-col items-center text-center gap-2 p-3 rounded-lg bg-muted/50">
                <Truck className="h-5 w-5 text-gold-500" />
                <span className="text-xs text-muted-foreground">
                  Free delivery over TZS 100K
                </span>
              </div>
              <div className="flex flex-col items-center text-center gap-2 p-3 rounded-lg bg-muted/50">
                <RotateCcw className="h-5 w-5 text-gold-500" />
                <span className="text-xs text-muted-foreground">
                  7-day returns
                </span>
              </div>
              <div className="flex flex-col items-center text-center gap-2 p-3 rounded-lg bg-muted/50">
                <Shield className="h-5 w-5 text-gold-500" />
                <span className="text-xs text-muted-foreground">
                  Secure payment
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
              Description
            </button>
            <button
              onClick={() => setActiveTab("reviews")}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "reviews"
                  ? "border-gold-500 text-gold-500"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Reviews ({reviewCount})
            </button>
          </div>

          <div className="py-8">
            {activeTab === "description" ? (
              <div className="max-w-3xl">
                <p className="text-foreground leading-relaxed">
                  {product.description}
                </p>
                {features.length > 0 && (
                  <>
                    <h3 className="mt-6 text-lg font-semibold text-foreground">
                      Features
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
            ) : (
              <div className="max-w-3xl space-y-6">
                {reviews.length === 0 ? (
                  <p className="text-muted-foreground">No reviews yet.</p>
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
                              {review.user?.firstName ? `${review.user.firstName} ${(review.user.lastName || "").charAt(0)}.` : review.name || "Anonymous"}
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
              You May Also Like
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
