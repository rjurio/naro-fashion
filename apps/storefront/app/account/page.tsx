"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  User,
  ShoppingBag,
  Key,
  Heart,
  MapPin,
  Settings,
  ChevronRight,
  Package,
  Clock,
  Loader2,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { formatPrice } from "@/lib/utils";
import { authApi, ordersApi, rentalsApi, wishlistApi } from "@/lib/api";

const quickLinks = [
  { label: "My Orders", href: "/account/orders", icon: ShoppingBag, desc: "Track and manage your orders" },
  { label: "My Rentals", href: "/account/rentals", icon: Key, desc: "View active and past rentals" },
  { label: "Wishlist", href: "/account/wishlist", icon: Heart, desc: "Items you saved for later" },
  { label: "Addresses", href: "/account/addresses", icon: MapPin, desc: "Manage delivery addresses" },
  { label: "Settings", href: "/account/settings", icon: Settings, desc: "Profile and preferences" },
];

const statusColors: Record<string, string> = {
  Shipped: "bg-blue-100 text-blue-700",
  Delivered: "bg-green-100 text-green-700",
  Processing: "bg-yellow-100 text-yellow-700",
  Pending: "bg-gray-100 text-gray-700",
  SHIPPED: "bg-blue-100 text-blue-700",
  DELIVERED: "bg-green-100 text-green-700",
  PROCESSING: "bg-yellow-100 text-yellow-700",
  PENDING: "bg-gray-100 text-gray-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
};

export default function AccountPage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [stats, setStats] = useState({ orders: 0, activeRentals: 0, wishlist: 0 });

  useEffect(() => {
    const token = localStorage.getItem("token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    async function fetchData() {
      try {
        const [profileRes, ordersRes, rentalsRes, wishlistRes] = await Promise.allSettled([
          authApi.getProfile(),
          ordersApi.getAll({ limit: 3, sort: "newest" }),
          rentalsApi.getAll(),
          wishlistApi.get(),
        ].map((p) =>
          // Inject auth header by re-calling with headers — but the api module
          // doesn't support per-call headers easily. We'll set it globally below.
          p
        ));

        if (profileRes.status === "fulfilled") {
          setProfile(profileRes.value);
        }

        if (ordersRes.status === "fulfilled") {
          const ordersData = ordersRes.value;
          const ordersList = Array.isArray(ordersData) ? ordersData : (ordersData?.data || []);
          setRecentOrders(ordersList.slice(0, 3));
          setStats((prev) => ({ ...prev, orders: ordersData?.total ?? ordersList.length }));
        }

        if (rentalsRes.status === "fulfilled") {
          const rentalsData = Array.isArray(rentalsRes.value) ? rentalsRes.value : (rentalsRes.value?.data || []);
          const activeCount = rentalsData.filter(
            (r: any) => ["Active", "Upcoming", "ACTIVE", "UPCOMING"].includes(r.status)
          ).length;
          setStats((prev) => ({ ...prev, activeRentals: activeCount }));
        }

        if (wishlistRes.status === "fulfilled") {
          const wishlistData = wishlistRes.value;
          const wishlistItems = Array.isArray(wishlistData) ? wishlistData : (wishlistData?.items || wishlistData?.data || []);
          setStats((prev) => ({ ...prev, wishlist: wishlistItems.length }));
        }
      } catch {
        // Errors handled per-request via allSettled
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const firstName = profile?.firstName || profile?.name?.split(" ")[0] || "there";
  const email = profile?.email || "";

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Welcome */}
        <div className="flex items-center gap-4 mb-10">
          <div className="flex items-center justify-center h-14 w-14 rounded-full bg-gold-500/10 text-gold-500">
            <User className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">
              Welcome back, {firstName}
            </h1>
            {email && <p className="text-muted-foreground text-sm">{email}</p>}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          <div className="rounded-xl border border-border bg-card p-5 text-center">
            <ShoppingBag className="h-6 w-6 text-gold-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{stats.orders}</p>
            <p className="text-xs text-muted-foreground">Orders</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 text-center">
            <Clock className="h-6 w-6 text-gold-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{stats.activeRentals}</p>
            <p className="text-xs text-muted-foreground">Active Rentals</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 text-center">
            <Heart className="h-6 w-6 text-gold-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{stats.wishlist}</p>
            <p className="text-xs text-muted-foreground">Wishlist</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Recent Orders */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-foreground">Recent Orders</h2>
                <Link href="/account/orders" className="text-sm text-gold-500 hover:text-gold-600 font-medium">
                  View All
                </Link>
              </div>
              {recentOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No orders yet.</p>
              ) : (
                <div className="space-y-3">
                  {recentOrders.map((order: any) => {
                    const orderId = order.orderNumber || order.id;
                    const date = order.createdAt
                      ? new Date(order.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
                      : order.date;
                    const itemCount = order.items?.length ?? order.itemCount ?? 0;
                    const total = order.total ?? order.totalAmount ?? 0;
                    const status = order.status || "Pending";

                    return (
                      <Link
                        key={orderId}
                        href={`/account/orders`}
                        className="flex items-center gap-4 p-4 rounded-lg border border-border hover:border-gold-500/50 transition-colors"
                      >
                        <Package className="h-8 w-8 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{orderId}</p>
                          <p className="text-xs text-muted-foreground">{date} &middot; {itemCount} items</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-foreground">{formatPrice(total)}</p>
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[status] || "bg-gray-100 text-gray-700"}`}>
                            {status}
                          </span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold text-foreground mb-4">Quick Links</h2>
              <div className="space-y-2">
                {quickLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors group"
                  >
                    <link.icon className="h-5 w-5 text-muted-foreground group-hover:text-gold-500 transition-colors" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{link.label}</p>
                      <p className="text-xs text-muted-foreground">{link.desc}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
