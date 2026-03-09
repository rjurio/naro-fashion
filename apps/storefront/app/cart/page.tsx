"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Minus,
  Plus,
  X,
  ShoppingBag,
  ArrowRight,
  Tag,
  Truck,
  Shield,
  Loader2,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { formatPrice } from "@/lib/utils";
import { cartApi } from "@/lib/api";

interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  size: string;
  color: string;
  quantity: number;
  maxQuantity: number;
}

export default function CartPage() {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState(false);

  useEffect(() => {
    const fetchCart = async () => {
      try {
        const data = await cartApi.get();
        const items: CartItem[] = (data?.items ?? []).map((item: any) => ({
          id: item.id,
          name: item.product?.name ?? item.name ?? "Unknown Product",
          price: item.price ?? item.product?.price ?? 0,
          image: item.product?.image ?? item.image ?? "/images/placeholder.jpg",
          size: item.variant?.size ?? item.size ?? "One Size",
          color: item.variant?.color ?? item.color ?? "",
          quantity: item.quantity ?? 1,
          maxQuantity: item.product?.stock ?? item.maxQuantity ?? 10,
        }));
        setCartItems(items);
      } catch {
        setCartItems([]);
      } finally {
        setLoading(false);
      }
    };
    fetchCart();
  }, []);

  const updateQuantity = async (id: string, newQuantity: number) => {
    const item = cartItems.find((i) => i.id === id);
    if (!item) return;
    const clamped = Math.max(1, Math.min(item.maxQuantity, newQuantity));
    setCartItems((items) =>
      items.map((i) => (i.id === id ? { ...i, quantity: clamped } : i))
    );
    try {
      await cartApi.updateItem(id, { quantity: clamped });
    } catch {
      // revert on failure - refetch
    }
  };

  const removeItem = async (id: string) => {
    setCartItems((items) => items.filter((item) => item.id !== id));
    try {
      await cartApi.removeItem(id);
    } catch {
      // item already removed from UI
    }
  };

  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const deliveryFee = subtotal >= 100000 ? 0 : 5000;
  const discount = promoApplied ? Math.round(subtotal * 0.1) : 0;
  const total = subtotal + deliveryFee - discount;

  const applyPromo = () => {
    if (promoCode.toUpperCase() === "NARO10") {
      setPromoApplied(true);
    }
  };

  if (loading) {
    return (
      <div className="bg-background min-h-screen">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
          <div className="text-center">
            <Loader2 className="h-10 w-10 text-gold-500 mx-auto mb-4 animate-spin" />
            <p className="text-muted-foreground">Loading your cart...</p>
          </div>
        </div>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="bg-background min-h-screen">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
          <div className="text-center">
            <ShoppingBag className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h1 className="text-2xl font-heading font-bold text-foreground mb-2">
              Your cart is empty
            </h1>
            <p className="text-muted-foreground mb-8">
              Looks like you haven&apos;t added anything to your cart yet.
            </p>
            <Link href="/products">
              <Button size="lg" className="gap-2">
                Continue Shopping <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
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
            <span className="text-foreground font-medium">Shopping Cart</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground mb-8">
          Shopping Cart ({cartItems.length} {cartItems.length === 1 ? "item" : "items"})
        </h1>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-2 space-y-4">
            {cartItems.map((item) => (
              <div
                key={item.id}
                className="flex gap-4 p-4 rounded-xl border border-border bg-card"
              >
                {/* Product Image */}
                <div
                  className="w-24 h-28 sm:w-28 sm:h-32 rounded-lg bg-muted flex-shrink-0"
                  style={{
                    backgroundImage: `url(${item.image})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />

                {/* Product Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/products/${item.id}`}
                        className="text-sm sm:text-base font-medium text-foreground hover:text-gold-500 transition-colors line-clamp-2"
                      >
                        {item.name}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-1">
                        Size: {item.size} &middot; Color: {item.color}
                      </p>
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-end justify-between mt-4">
                    {/* Quantity Controls */}
                    <div className="flex items-center border border-border rounded-lg">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="flex h-8 w-8 items-center justify-center hover:bg-muted transition-colors rounded-l-lg"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="flex h-8 w-10 items-center justify-center text-sm font-medium border-x border-border">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="flex h-8 w-8 items-center justify-center hover:bg-muted transition-colors rounded-r-lg"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Price */}
                    <span className="text-base font-bold text-foreground">
                      {formatPrice(item.price * item.quantity)}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-sm font-medium text-gold-500 hover:text-gold-600 transition-colors mt-4"
            >
              <ArrowRight className="h-4 w-4 rotate-180" />
              Continue Shopping
            </Link>
          </div>

          {/* Order Summary */}
          <div>
            <div className="rounded-xl border border-border bg-card p-6 sticky top-24">
              <h2 className="text-lg font-bold text-foreground mb-6">
                Order Summary
              </h2>

              {/* Promo Code */}
              <div className="mb-6">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Promo code"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background pl-9 pr-4 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="md"
                    onClick={applyPromo}
                    disabled={promoApplied}
                  >
                    {promoApplied ? "Applied" : "Apply"}
                  </Button>
                </div>
                {promoApplied && (
                  <p className="text-xs text-green-600 mt-1.5">
                    NARO10 applied! You save {formatPrice(discount)}
                  </p>
                )}
              </div>

              {/* Price Breakdown */}
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium text-foreground">
                    {formatPrice(subtotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Delivery</span>
                  <span className="font-medium text-foreground">
                    {deliveryFee === 0 ? (
                      <span className="text-green-600">Free</span>
                    ) : (
                      formatPrice(deliveryFee)
                    )}
                  </span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount (10%)</span>
                    <span className="font-medium">-{formatPrice(discount)}</span>
                  </div>
                )}
                <div className="border-t border-border pt-3 flex justify-between">
                  <span className="text-base font-bold text-foreground">Total</span>
                  <span className="text-base font-bold text-foreground">
                    {formatPrice(total)}
                  </span>
                </div>
              </div>

              {/* Checkout Button */}
              <Button size="lg" className="w-full mt-6 gap-2">
                Proceed to Checkout <ArrowRight className="h-5 w-5" />
              </Button>

              {/* Trust badges */}
              <div className="mt-6 flex items-center justify-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Shield className="h-3.5 w-3.5" /> Secure
                </span>
                <span className="flex items-center gap-1">
                  <Truck className="h-3.5 w-3.5" /> Fast Delivery
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
