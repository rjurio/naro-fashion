"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Package, ChevronDown, ChevronUp, RefreshCw, ArrowLeft, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { formatPrice } from "@/lib/utils";
import { ordersApi } from "@/lib/api";

const statusColors: Record<string, string> = {
  Pending: "bg-gray-100 text-gray-700",
  Confirmed: "bg-blue-100 text-blue-700",
  Processing: "bg-yellow-100 text-yellow-700",
  Shipped: "bg-purple-100 text-purple-700",
  Delivered: "bg-green-100 text-green-700",
  PENDING: "bg-gray-100 text-gray-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  PROCESSING: "bg-yellow-100 text-yellow-700",
  SHIPPED: "bg-purple-100 text-purple-700",
  DELIVERED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOrders() {
      try {
        const res = await ordersApi.getAll({ sort: "newest" });
        const list = Array.isArray(res) ? res : (res?.data || []);
        setOrders(list);
      } catch {
        setOrders([]);
      } finally {
        setLoading(false);
      }
    }
    fetchOrders();
  }, []);

  const toggleOrder = (id: string) => {
    setExpandedOrder(expandedOrder === id ? null : id);
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
            <span className="text-foreground font-medium">Orders</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">My Orders</h1>
            <p className="text-muted-foreground text-sm mt-1">{orders.length} orders total</p>
          </div>
          <Link href="/account">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> Account
            </Button>
          </Link>
        </div>

        {orders.length === 0 ? (
          <div className="text-center py-20">
            <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">No orders yet</h2>
            <p className="text-muted-foreground mb-8">Start shopping to see your orders here.</p>
            <Link href="/products">
              <Button size="lg">Browse Products</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order: any) => {
              const orderId = order.orderNumber || order.id;
              const date = order.createdAt
                ? new Date(order.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
                : order.date;
              const items = order.items || order.orderItems || [];
              const total = order.total ?? order.totalAmount ?? 0;
              const status = order.status || "Pending";
              const trackingNumber = order.trackingNumber;

              return (
                <div key={orderId} className="rounded-xl border border-border bg-card overflow-hidden">
                  <button
                    onClick={() => toggleOrder(orderId)}
                    className="w-full flex items-center gap-4 p-4 sm:p-5 text-left hover:bg-muted/50 transition-colors"
                  >
                    <Package className="h-8 w-8 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-foreground">{orderId}</p>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[status] || "bg-gray-100 text-gray-700"}`}>
                          {status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {date} &middot; {items.length} {items.length === 1 ? "item" : "items"}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-foreground flex-shrink-0">{formatPrice(total)}</span>
                    {expandedOrder === orderId ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                  </button>

                  {expandedOrder === orderId && (
                    <div className="border-t border-border p-4 sm:p-5 bg-muted/30">
                      <div className="space-y-3 mb-4">
                        {items.map((item: any, idx: number) => {
                          const itemName = item.name || item.product?.name || "Item";
                          const itemSize = item.size || item.variant?.size || "-";
                          const itemQty = item.quantity || 1;
                          const itemPrice = item.price || item.unitPrice || 0;

                          return (
                            <div key={idx} className="flex items-center justify-between text-sm">
                              <div>
                                <p className="font-medium text-foreground">{itemName}</p>
                                <p className="text-xs text-muted-foreground">Size: {itemSize} &middot; Qty: {itemQty}</p>
                              </div>
                              <span className="font-medium text-foreground">{formatPrice(itemPrice * itemQty)}</span>
                            </div>
                          );
                        })}
                      </div>
                      {trackingNumber && (
                        <p className="text-xs text-muted-foreground mb-4">
                          Tracking: <span className="font-medium text-foreground">{trackingNumber}</span>
                        </p>
                      )}
                      <Button variant="outline" size="sm">
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Reorder
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
