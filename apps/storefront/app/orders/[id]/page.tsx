"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Package, ArrowLeft, Loader2, MapPin, CreditCard } from "lucide-react";
import Button from "@/components/ui/Button";
import { formatPrice } from "@/lib/utils";
import { ordersApi } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1").replace("/api/v1", "");

function resolveImg(url?: string): string {
  if (!url) return "/uploads/products/placeholder.jpg";
  if (url.startsWith("/uploads")) return `${API_ORIGIN}${url}`;
  return url;
}

const statusClasses: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  PROCESSING: "bg-yellow-100 text-yellow-700",
  SHIPPED: "bg-purple-100 text-purple-700",
  DELIVERED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export default function OrderDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const showSuccess = searchParams.get("success") === "true";

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function fetchOrder() {
      try {
        const data = await ordersApi.getOne(params.id);
        setOrder(data);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    if (params.id) fetchOrder();
  }, [params.id]);

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
      </div>
    );
  }

  if (notFound || !order) {
    return (
      <div className="bg-background min-h-screen flex flex-col items-center justify-center px-4">
        <Package className="h-16 w-16 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold text-foreground mb-2">{t("orders.orderNotFound")}</h1>
        <p className="text-muted-foreground mb-6 text-center">{t("orders.orderNotFoundMsg")}</p>
        <div className="flex gap-3">
          <Link href="/account/orders">
            <Button variant="outline">{t("account.myOrders")}</Button>
          </Link>
          <Link href="/products">
            <Button>{t("account.browseProducts")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  const orderNumber = order.orderNumber || order.id;
  const items = order.items || order.orderItems || [];
  const subtotal = Number(order.subtotal ?? 0);
  const shippingFee = Number(order.shippingFee ?? order.shipping ?? 0);
  const total = Number(order.total ?? order.totalAmount ?? 0);
  const status = (order.status || "PENDING").toUpperCase();
  const paymentMethod = order.paymentMethod;
  const notes = order.notes;
  const createdAt = order.createdAt
    ? new Date(order.createdAt).toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <div className="bg-background min-h-screen">
      <div className="border-b border-border">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-gold-500 transition-colors">{t("common.home")}</Link>
            <span>/</span>
            <Link href="/account/orders" className="hover:text-gold-500 transition-colors">{t("account.orders")}</Link>
            <span>/</span>
            <span className="text-foreground font-medium truncate max-w-[200px]">{orderNumber}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {showSuccess && (
          <div className="mb-8 rounded-xl border border-green-500/30 bg-green-500/10 p-5 sm:p-6 flex items-start gap-4">
            <CheckCircle2 className="h-10 w-10 text-green-500 flex-shrink-0" />
            <div>
              <h2 className="text-xl font-bold text-foreground mb-1">{t("orders.orderPlacedTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("orders.orderPlacedMsg")}</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">
              {t("orders.orderId")} <span className="text-gold-500">{orderNumber}</span>
            </h1>
            {createdAt && <p className="text-muted-foreground text-sm mt-1">{createdAt}</p>}
          </div>
          <Link href="/account/orders">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> {t("account.orders")}
            </Button>
          </Link>
        </div>

        <div className="mb-6 flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{t("orders.status")}:</span>
          <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${statusClasses[status] || "bg-gray-100 text-gray-700"}`}>
            {status}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="border-b border-border px-5 py-4">
                <h2 className="font-bold text-foreground">{t("checkout.items")}</h2>
              </div>
              <div className="divide-y divide-border">
                {items.map((item: any, idx: number) => {
                  const name = item.product?.name || item.name || t("checkout.items");
                  const sizeLabel = item.variant?.name || item.size || "";
                  const qty = item.quantity || 1;
                  const unitPrice = Number(item.price ?? item.unitPrice ?? 0);
                  const imgRaw = item.product?.images?.[0];
                  const img = resolveImg(typeof imgRaw === "string" ? imgRaw : imgRaw?.url);
                  return (
                    <div key={idx} className="flex items-center gap-4 p-4">
                      <div
                        className="h-16 w-16 rounded-lg bg-muted flex-shrink-0"
                        style={{ backgroundImage: `url(${img})`, backgroundSize: "cover", backgroundPosition: "center" }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground line-clamp-1">{name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {sizeLabel && <>{sizeLabel} &middot; </>}{t("account.qty")}: {qty}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-foreground flex-shrink-0">
                        {formatPrice(unitPrice * qty)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {(paymentMethod || notes) && (
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                {paymentMethod && (
                  <div className="flex items-start gap-3">
                    <CreditCard className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">{t("checkout.paymentMethod")}</p>
                      <p className="text-sm font-medium text-foreground">{paymentMethod.replace(/_/g, " ")}</p>
                    </div>
                  </div>
                )}
                {notes && (
                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{t("checkout.shippingAddress")}</p>
                      <p className="text-sm font-medium text-foreground whitespace-pre-wrap break-words">{notes}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className="rounded-xl border border-border bg-card p-5 h-fit lg:sticky lg:top-6">
            <h2 className="font-bold text-foreground mb-4">{t("checkout.orderSummary")}</h2>
            <div className="space-y-2 text-sm">
              {subtotal > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("cart.subtotal")}</span>
                  <span className="text-foreground">{formatPrice(subtotal)}</span>
                </div>
              )}
              {shippingFee > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("checkout.shipping")}</span>
                  <span className="text-foreground">{formatPrice(shippingFee)}</span>
                </div>
              )}
              <div className="border-t border-border pt-2 mt-2 flex justify-between font-bold text-foreground">
                <span>{t("cart.total")}</span>
                <span className="text-gold-500">{formatPrice(total)}</span>
              </div>
            </div>
            <Button className="w-full mt-5" onClick={() => router.push("/products")}>
              {t("account.browseProducts")}
            </Button>
          </aside>
        </div>
      </div>
    </div>
  );
}
