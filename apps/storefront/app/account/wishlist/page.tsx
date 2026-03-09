"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, ShoppingCart, X, ArrowLeft, Star, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { formatPrice } from "@/lib/utils";
import { wishlistApi } from "@/lib/api";

interface WishlistItem {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  slug?: string;
}

function normalizeItem(raw: any): WishlistItem {
  const product = raw.product || raw;
  return {
    id: product.id || raw.productId,
    name: product.name || product.title || "Product",
    price: product.price ?? product.salePrice ?? 0,
    originalPrice: product.originalPrice ?? product.compareAtPrice ?? undefined,
    image: product.image || product.images?.[0]?.url || product.images?.[0] || "/images/products/placeholder.jpg",
    rating: product.rating ?? product.averageRating ?? 0,
    reviewCount: product.reviewCount ?? product.totalReviews ?? 0,
    inStock: product.inStock ?? product.stockQuantity > 0 ?? true,
    slug: product.slug,
  };
}

export default function WishlistPage() {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchWishlist() {
      try {
        const res = await wishlistApi.get();
        const raw = Array.isArray(res) ? res : (res?.items || res?.data || []);
        setItems(raw.map(normalizeItem));
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
    fetchWishlist();
  }, []);

  const removeItem = async (id: string) => {
    setRemovingId(id);
    try {
      await wishlistApi.remove(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch {
      // Optimistic fallback: remove locally anyway
      setItems((prev) => prev.filter((item) => item.id !== id));
    } finally {
      setRemovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">Home</Link>
            <span>/</span>
            <Link href="/account" className="hover:text-gold-500 transition-colors">Account</Link>
            <span>/</span>
            <span className="text-foreground font-medium">Wishlist</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">My Wishlist</h1>
            <p className="text-muted-foreground text-sm mt-1">{items.length} items saved</p>
          </div>
          <Link href="/account">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> Account
            </Button>
          </Link>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-20">
            <Heart className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">Your wishlist is empty</h2>
            <p className="text-muted-foreground mb-8">Save items you love for later.</p>
            <Link href="/products">
              <Button size="lg">Browse Products</Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {items.map((item) => {
              const productHref = item.slug ? `/products/${item.slug}` : `/products/${item.id}`;
              return (
                <div key={item.id} className="group rounded-xl border border-border bg-card overflow-hidden">
                  <div className="relative">
                    <Link href={productHref}>
                      <div
                        className="aspect-[3/4] bg-muted"
                        style={{ backgroundImage: `url(${item.image})`, backgroundSize: "cover", backgroundPosition: "center" }}
                      />
                    </Link>
                    <button
                      onClick={() => removeItem(item.id)}
                      disabled={removingId === item.id}
                      className="absolute top-2 right-2 flex items-center justify-center h-8 w-8 rounded-full bg-white/90 text-red-500 hover:bg-red-500 hover:text-white transition-colors shadow-sm disabled:opacity-50"
                      title="Remove from wishlist"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    {item.originalPrice && (
                      <span className="absolute top-2 left-2 bg-gold-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                        -{Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100)}%
                      </span>
                    )}
                    {!item.inStock && (
                      <div className="absolute inset-0 bg-dark-500/50 flex items-center justify-center">
                        <span className="bg-white text-dark-500 text-sm font-bold px-4 py-1.5 rounded-full">Out of Stock</span>
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <Link href={productHref}>
                      <h3 className="text-sm font-medium text-foreground line-clamp-2 hover:text-gold-500 transition-colors">
                        {item.name}
                      </h3>
                    </Link>
                    <div className="flex items-center gap-1 mt-1">
                      <Star className="h-3 w-3 fill-gold-500 text-gold-500" />
                      <span className="text-xs text-muted-foreground">{item.rating} ({item.reviewCount})</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-sm font-bold text-foreground">{formatPrice(item.price)}</span>
                      {item.originalPrice && (
                        <span className="text-xs text-muted-foreground line-through">{formatPrice(item.originalPrice)}</span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      className="w-full mt-3 gap-1.5 text-xs"
                      disabled={!item.inStock}
                    >
                      <ShoppingCart className="h-3.5 w-3.5" />
                      {item.inStock ? "Add to Cart" : "Out of Stock"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
