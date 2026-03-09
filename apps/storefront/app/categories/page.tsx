"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { categoriesApi } from "@/lib/api";

const colorMap: Record<string, string> = {
  women: "from-[#D4AF37]/20 to-[#D4AF37]/5",
  men: "from-[#1A1A1A]/20 to-[#1A1A1A]/5",
  kids: "from-amber-200/30 to-amber-100/10",
  accessories: "from-[#D4AF37]/15 to-[#D4AF37]/5",
  shoes: "from-[#1A1A1A]/15 to-[#1A1A1A]/5",
  bags: "from-amber-300/20 to-amber-100/5",
  gowns: "from-[#D4AF37]/25 to-[#D4AF37]/10",
};

export default function CategoriesPage() {
  const { t } = useTranslation("categories");
  const { t: tc } = useTranslation("common");
  const { t: th } = useTranslation("home");

  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    categoriesApi.getAll()
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-background min-h-screen">
        <div className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
            <nav className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-gold-500 transition-colors">{tc("home")}</Link>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground font-medium">{tc("categories")}</span>
            </nav>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden animate-pulse">
                <div className="h-48 bg-muted" />
                <div className="p-5">
                  <div className="h-5 w-24 bg-muted rounded" />
                  <div className="h-4 w-16 bg-muted rounded mt-2" />
                </div>
              </div>
            ))}
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
            <Link href="/" className="hover:text-gold-500 transition-colors">{tc("home")}</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{tc("categories")}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-heading font-bold text-foreground">
            {th("shopByCategory")}{" "}
            <span className="text-gold-500">{th("shopByCategoryHighlight")}</span>
          </h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            {th("categorySubtitle")}
          </p>
        </div>

        {/* Categories Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((cat) => {
            const slug = cat.slug || "";
            const color = colorMap[slug] || "from-[#D4AF37]/15 to-[#D4AF37]/5";
            const image = cat.image || `/images/categories/${slug}.jpg`;
            const count = cat.productCount ?? cat._count?.products ?? 0;
            const name = cat.name || t(slug) || slug;

            return (
              <Link
                key={cat.id || slug}
                href={`/categories/${slug}`}
                className="group relative rounded-2xl border border-border bg-card overflow-hidden hover:shadow-lg hover:border-gold-500/50 transition-all duration-300"
              >
                {/* Image placeholder */}
                <div className={`h-48 bg-gradient-to-br ${color} flex items-center justify-center`}>
                  <span className="text-5xl font-heading font-bold text-foreground/10 group-hover:text-foreground/20 transition-colors">
                    {name.charAt(0)}
                  </span>
                </div>

                {/* Info */}
                <div className="p-5 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-foreground group-hover:text-gold-500 transition-colors">
                      {name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {count} {tc("products").toLowerCase()}
                    </p>
                  </div>
                  <div className="p-2 rounded-full bg-muted group-hover:bg-gold-500/10 transition-colors">
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-gold-500 transition-colors" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
