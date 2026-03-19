"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, ShoppingCart, Star, Loader2 } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { cartApi, wishlistApi } from "@/lib/api";
import Badge from "./Badge";
import Button from "./Button";

interface ProductCardProps {
  id: string;
  name: string;
  slug?: string;
  href?: string;
  price: number;
  originalPrice?: number;
  image?: string;
  rating?: number;
  reviewCount?: number;
  isNew?: boolean;
  isOnSale?: boolean;
  isRentable?: boolean;
  rentPrice?: number;
  defaultVariantId?: string;
  className?: string;
}

export default function ProductCard({
  id,
  name,
  slug,
  href,
  price,
  originalPrice,
  image = "/uploads/products/placeholder.jpg",
  rating = 0,
  reviewCount = 0,
  isNew = false,
  isOnSale = false,
  isRentable = false,
  rentPrice,
  defaultVariantId,
  className,
}: ProductCardProps) {
  const router = useRouter();
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [cartLoading, setCartLoading] = useState(false);
  const [cartMsg, setCartMsg] = useState("");

  const discount = originalPrice
    ? Math.round(((Number(originalPrice) - Number(price)) / Number(originalPrice)) * 100)
    : 0;

  const productHref = href ?? (slug ? `/products/${slug}` : `/products/${id}`);

  const handleWishlistToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      router.push("/auth/login");
      return;
    }
    setWishlistLoading(true);
    try {
      const res = await wishlistApi.toggle(id);
      setIsWishlisted(res?.added ?? !isWishlisted);
    } catch {
      // If 401, redirect to login
      router.push("/auth/login");
    } finally {
      setWishlistLoading(false);
    }
  };

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      router.push("/auth/login");
      return;
    }
    if (!defaultVariantId) {
      // No variant available — go to product detail to select one
      router.push(productHref);
      return;
    }
    setCartLoading(true);
    setCartMsg("");
    try {
      await cartApi.addItem({ productId: id, variantId: defaultVariantId, quantity: 1 });
      setCartMsg("Added!");
      setTimeout(() => setCartMsg(""), 2000);
    } catch {
      setCartMsg("Failed");
      setTimeout(() => setCartMsg(""), 2000);
    } finally {
      setCartLoading(false);
    }
  };

  return (
    <Link
      href={productHref}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl bg-card shadow-sm border border-border transition-all duration-300 hover:shadow-lg hover:-translate-y-1",
        className,
      )}
    >
      {/* Image Container */}
      <div className="relative aspect-[3/4] overflow-hidden bg-muted">
        <div className="absolute inset-0 bg-gradient-to-t from-dark-500/20 to-transparent z-10 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div
          className="h-full w-full bg-muted flex items-center justify-center text-muted-foreground text-sm"
          style={{
            backgroundImage: `url(${image})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {!image && "Product Image"}
        </div>

        {/* Badges */}
        <div className="absolute top-2 left-2 z-20 flex flex-col gap-1">
          {isNew && <Badge variant="new">New</Badge>}
          {isOnSale && discount > 0 && (
            <Badge variant="sale">-{discount}%</Badge>
          )}
          {isRentable && <Badge variant="rent">Rent Available</Badge>}
        </div>

        {/* Wishlist Button */}
        <button
          onClick={handleWishlistToggle}
          disabled={wishlistLoading}
          className={cn(
            "absolute top-2 right-2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-sm transition-all duration-200 hover:scale-110",
            isWishlisted ? "text-gold-500" : "text-dark-300",
          )}
          aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
        >
          {wishlistLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Heart
              className="h-4 w-4"
              fill={isWishlisted ? "currentColor" : "none"}
            />
          )}
        </button>

        {/* Quick Add to Cart - shows on hover */}
        <div className="absolute bottom-3 left-3 right-3 z-20 opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
          <Button
            size="sm"
            className="w-full gap-2"
            onClick={handleAddToCart}
            disabled={cartLoading}
          >
            {cartLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : cartMsg ? (
              cartMsg
            ) : (
              <>
                <ShoppingCart className="h-4 w-4" />
                Add to Cart
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Product Info */}
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <h3 className="text-sm font-medium text-card-foreground line-clamp-2 mb-1 group-hover:text-gold-500 transition-colors">
          {name}
        </h3>

        {/* Rating */}
        <div className="flex items-center gap-1 mb-2">
          <div className="flex items-center">
            {Array.from({ length: 5 }, (_, i) => (
              <Star
                key={i}
                className={cn(
                  "h-3 w-3",
                  i < Math.floor(rating)
                    ? "text-gold-500 fill-gold-500"
                    : "text-dark-200",
                )}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">({reviewCount})</span>
        </div>

        {/* Price */}
        <div className="mt-auto flex items-baseline gap-2">
          <span className="text-base font-bold text-card-foreground">
            {formatPrice(price)}
          </span>
          {originalPrice && Number(originalPrice) > Number(price) && (
            <span className="text-xs text-muted-foreground line-through">
              {formatPrice(originalPrice)}
            </span>
          )}
        </div>

        {/* Rent price */}
        {isRentable && rentPrice && (
          <p className="mt-1 text-xs text-gold-600">
            Rent from {formatPrice(rentPrice)}/day
          </p>
        )}
      </div>
    </Link>
  );
}
