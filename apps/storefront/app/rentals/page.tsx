"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Crown,
  Star,
  Filter,
  ChevronDown,
  ArrowRight,
  Shield,
  Sparkles,
  Clock,
  CreditCard,
  Loader2,
} from "lucide-react";
import ProductCard from "@/components/ui/ProductCard";
import Button from "@/components/ui/Button";
import { productsApi, categoriesApi } from "@/lib/api";

interface RentalCategory {
  name: string;
  slug?: string;
  count: number;
}

interface RentalProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  rating: number;
  reviewCount: number;
  isRentable: boolean;
  rentPrice: number;
}

export default function RentalsPage() {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [sortBy, setSortBy] = useState("popular");
  const [rentalCategories, setRentalCategories] = useState<RentalCategory[]>([]);
  const [rentalProducts, setRentalProducts] = useState<RentalProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [productsRes, categoriesRes] = await Promise.all([
          productsApi.getAll({ availability_mode: "RENTAL_ONLY,BOTH" }).catch(() => ({ data: [], total: 0, page: 1, limit: 20 })),
          categoriesApi.getAll().catch(() => []),
        ]);

        const products = (productsRes?.data ?? []).map((p: any) => ({
          id: p.id ?? p.slug,
          name: p.name ?? "Unknown",
          price: p.price ?? 0,
          image: p.image ?? p.images?.[0] ?? "/images/placeholder.jpg",
          rating: p.rating ?? p.averageRating ?? 0,
          reviewCount: p.reviewCount ?? p.review_count ?? 0,
          isRentable: true,
          rentPrice: p.rentPrice ?? p.rent_price ?? p.rentalPrice ?? 0,
        }));
        setRentalProducts(products);

        const cats = Array.isArray(categoriesRes) ? categoriesRes : [];
        const mappedCats: RentalCategory[] = [
          { name: "All", count: products.length },
          ...cats.map((c: any) => ({
            name: c.name ?? "Unknown",
            slug: c.slug,
            count: c.productCount ?? c.product_count ?? 0,
          })),
        ];
        setRentalCategories(mappedCats);
      } catch {
        setRentalProducts([]);
        setRentalCategories([{ name: "All", count: 0 }]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="bg-background min-h-screen">
      {/* Hero Banner */}
      <section className="relative bg-gradient-to-br from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A] py-16 lg:py-24 overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-[#D4AF37]/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-[#D4AF37]/10 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#D4AF37]/20 px-4 py-1.5 text-sm text-[#D4AF37] border border-[#D4AF37]/30 mb-6">
            <Crown className="h-4 w-4" />
            Premium Rental Collection
          </span>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-bold text-white">
            Rent Designer{" "}
            <span className="text-[#D4AF37]">Gowns & Formal Wear</span>
          </h1>
          <p className="mt-4 text-lg text-gray-300 max-w-2xl mx-auto">
            Access our exclusive collection of designer gowns, suits, and formal
            wear at a fraction of the retail price. Perfect for weddings, galas,
            and special occasions.
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-12 bg-muted/30 border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-lg font-semibold text-foreground mb-8">
            How Renting Works
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Sparkles,
                title: "Browse & Select",
                desc: "Choose from our curated collection of designer pieces",
              },
              {
                icon: Clock,
                title: "Pick Your Dates",
                desc: "Select your rental period with our date picker",
              },
              {
                icon: CreditCard,
                title: "Pay 25% Deposit",
                desc: "Secure with a down payment, full payment before dispatch",
              },
              {
                icon: Shield,
                title: "ID Verification",
                desc: "Quick national ID verification for security",
              },
            ].map((step, idx) => (
              <div key={idx} className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gold-500/10 text-gold-600 mb-3">
                  <step.icon className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                <p className="text-xs text-muted-foreground mt-1">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Filters Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
            {rentalCategories.map((cat) => (
              <button
                key={cat.name}
                onClick={() => setSelectedCategory(cat.name)}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  selectedCategory === cat.name
                    ? "bg-gold-500 text-[#1A1A1A]"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {cat.name} ({cat.count})
              </button>
            ))}
          </div>

          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="appearance-none rounded-lg border border-border bg-card px-4 py-2 pr-8 text-sm font-medium text-foreground outline-none focus:border-gold-500 cursor-pointer"
            >
              <option value="popular">Most Popular</option>
              <option value="price-asc">Rent: Low to High</option>
              <option value="price-desc">Rent: High to Low</option>
              <option value="rating">Best Rating</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Product Grid */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
                <div className="aspect-[3/4] bg-muted" />
                <div className="p-3 sm:p-4 space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                  <div className="h-5 bg-muted rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : rentalProducts.length === 0 ? (
          <div className="text-center py-16">
            <Crown className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-heading font-bold text-foreground mb-2">
              No rental products available
            </h2>
            <p className="text-muted-foreground">
              Check back soon for our latest rental collection.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {rentalProducts.map((product) => (
              <Link key={product.id} href={`/rentals/${product.id}`}>
                <ProductCard {...product} />
              </Link>
            ))}
          </div>
        )}

        {/* Load More */}
        {rentalProducts.length > 0 && (
          <div className="mt-12 text-center">
            <Button variant="outline" size="lg">
              Load More Rentals
            </Button>
          </div>
        )}
      </div>

      {/* CTA Section */}
      <section className="py-16 bg-gradient-to-r from-[#D4AF37]/10 to-[#D4AF37]/5 border-t border-border">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <Crown className="h-10 w-10 text-gold-500 mx-auto mb-4" />
          <h2 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">
            Can&apos;t find what you&apos;re looking for?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Contact us with your requirements and we&apos;ll help you find the
            perfect outfit for your special occasion.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/contact">
              <Button variant="secondary" size="lg" className="gap-2">
                Contact Us <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
