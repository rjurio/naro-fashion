"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Zap, ShoppingCart, Star, Clock, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { formatPrice, formatCountdown } from "@/lib/utils";
import { flashSalesApi } from "@/lib/api";

interface FlashSaleProduct {
  id: string;
  name: string;
  originalPrice: number;
  salePrice: number;
  image: string;
  rating: number;
  reviewCount: number;
  soldCount: number;
  totalStock: number;
}

function CountdownTimer({ endTime }: { endTime: number }) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      setSecondsLeft(diff);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  const { days, hours, minutes, secs } = formatCountdown(secondsLeft);

  if (secondsLeft <= 0) return <span className="text-red-500 font-bold">Sale Ended</span>;

  return (
    <div className="flex items-center gap-1.5">
      {[
        { val: days, label: "D" },
        { val: hours, label: "H" },
        { val: minutes, label: "M" },
        { val: secs, label: "S" },
      ].map((unit, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <div className="flex flex-col items-center bg-dark-500 text-white rounded-lg px-2.5 py-1.5 min-w-[40px]">
            <span className="text-lg sm:text-xl font-bold leading-tight">
              {String(unit.val).padStart(2, "0")}
            </span>
            <span className="text-[10px] text-gray-400 uppercase">{unit.label}</span>
          </div>
          {idx < 3 && <span className="text-lg font-bold text-muted-foreground">:</span>}
        </div>
      ))}
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
      <div className="aspect-[3/4] bg-muted" />
      <div className="p-3 sm:p-4 space-y-2">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/2" />
        <div className="h-5 bg-muted rounded w-2/3" />
        <div className="h-1.5 bg-muted rounded mt-3" />
        <div className="h-8 bg-muted rounded mt-3" />
      </div>
    </div>
  );
}

export default function FlashSalesPage() {
  const [products, setProducts] = useState<FlashSaleProduct[]>([]);
  const [saleEndTime, setSaleEndTime] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFlashSales = async () => {
      try {
        const data = await flashSalesApi.getActive();
        const sales = Array.isArray(data) ? data : [];

        // Use the first sale's end time, or fallback
        if (sales.length > 0 && sales[0].endTime) {
          setSaleEndTime(new Date(sales[0].endTime).getTime());
        } else if (sales.length > 0 && sales[0].end_time) {
          setSaleEndTime(new Date(sales[0].end_time).getTime());
        }

        // Flatten products from all active sales
        const allProducts: FlashSaleProduct[] = sales.flatMap((sale: any) => {
          const items = sale.products ?? sale.items ?? [];
          return items.map((item: any) => ({
            id: item.id ?? item.productId ?? item.product_id,
            name: item.name ?? item.product?.name ?? "Unknown",
            originalPrice: item.originalPrice ?? item.original_price ?? item.product?.price ?? 0,
            salePrice: item.salePrice ?? item.sale_price ?? item.price ?? 0,
            image: item.image ?? item.product?.image ?? "/images/placeholder.jpg",
            rating: item.rating ?? item.product?.rating ?? 0,
            reviewCount: item.reviewCount ?? item.review_count ?? item.product?.reviewCount ?? 0,
            soldCount: item.soldCount ?? item.sold_count ?? 0,
            totalStock: item.totalStock ?? item.total_stock ?? item.stock ?? 1,
          }));
        });

        setProducts(allProducts);
      } catch {
        setProducts([]);
      } finally {
        setLoading(false);
      }
    };
    fetchFlashSales();
  }, []);

  return (
    <div className="bg-background min-h-screen">
      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-gold-500 to-gold-600 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Zap className="h-6 w-6 fill-gold-500 text-gold-500" />
            <h1 className="text-2xl sm:text-4xl font-heading font-bold">Flash Sale</h1>
            <Zap className="h-6 w-6 fill-gold-500 text-gold-500" />
          </div>
          <p className="text-gold-100 mb-6 text-sm sm:text-base">
            Limited time offers on your favorite styles. Grab them before they are gone!
          </p>
          {saleEndTime > 0 && (
            <>
              <div className="flex items-center justify-center gap-2 mb-2">
                <Clock className="h-4 w-4" />
                <span className="text-sm font-medium">Sale ends in:</span>
              </div>
              <div className="flex justify-center">
                <CountdownTimer endTime={saleEndTime} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Products Grid */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4 sm:gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <ProductSkeleton key={i} />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16">
            <Zap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-heading font-bold text-foreground mb-2">
              No active flash sales
            </h2>
            <p className="text-muted-foreground">
              Check back soon for amazing deals!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4 sm:gap-6">
            {products.map((product) => {
              const discountPct = product.originalPrice > 0
                ? Math.round(((product.originalPrice - product.salePrice) / product.originalPrice) * 100)
                : 0;
              const soldPct = product.totalStock > 0
                ? Math.round((product.soldCount / product.totalStock) * 100)
                : 0;

              return (
                <div key={product.id} className="group rounded-xl border border-border bg-card overflow-hidden">
                  <div className="relative">
                    <Link href={`/products/${product.id}`}>
                      <div
                        className="aspect-[3/4] bg-muted"
                        style={{ backgroundImage: `url(${product.image})`, backgroundSize: "cover", backgroundPosition: "center" }}
                      />
                    </Link>
                    {discountPct > 0 && (
                      <span className="absolute top-2 left-2 bg-gold-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                        -{discountPct}%
                      </span>
                    )}
                  </div>
                  <div className="p-3 sm:p-4">
                    <Link href={`/products/${product.id}`}>
                      <h3 className="text-sm font-medium text-foreground line-clamp-2 hover:text-gold-500 transition-colors">
                        {product.name}
                      </h3>
                    </Link>
                    <div className="flex items-center gap-1 mt-1">
                      <Star className="h-3 w-3 fill-gold-500 text-gold-500" />
                      <span className="text-xs text-muted-foreground">{product.rating} ({product.reviewCount})</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-base font-bold text-gold-500">{formatPrice(product.salePrice)}</span>
                      {product.originalPrice > product.salePrice && (
                        <span className="text-xs text-muted-foreground line-through">{formatPrice(product.originalPrice)}</span>
                      )}
                    </div>
                    {/* Stock bar */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>{product.soldCount} sold</span>
                        <span>{product.totalStock - product.soldCount} left</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gold-500 transition-all"
                          style={{ width: `${soldPct}%` }}
                        />
                      </div>
                    </div>
                    <Button size="sm" className="w-full mt-3 gap-1.5 text-xs">
                      <ShoppingCart className="h-3.5 w-3.5" /> Add to Cart
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
