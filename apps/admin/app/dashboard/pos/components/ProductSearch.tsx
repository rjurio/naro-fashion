'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Plus, Barcode, Package } from 'lucide-react';
import adminApi from '../../../../lib/api';

interface Variant {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  colorHex: string | null;
  price: number;
  stock: number;
}

interface Product {
  id: string;
  name: string;
  basePrice: number;
  sku: string | null;
  variants: Variant[];
  images: { url: string; altText: string | null }[];
  category: { id: string; name: string } | null;
}

interface CartItem {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  size: string | null;
  color: string | null;
  quantity: number;
  unitPrice: number;
  stock: number;
  imageUrl?: string;
  itemDiscount?: number;
}

interface Props {
  onAddToCart: (item: CartItem) => void;
  categories: { id: string; name: string }[];
}

export default function ProductSearch({ onAddToCart, categories }: Props) {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [barcodeMode, setBarcodeMode] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();

  const searchProducts = useCallback(async (q: string) => {
    if (!q || q.length < 1) {
      setProducts([]);
      return;
    }
    setLoading(true);
    try {
      const results = await adminApi.posSearchProducts(q);
      setProducts(Array.isArray(results) ? results : []);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => searchProducts(query), 300);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [query, searchProducts]);

  const handleBarcodeSubmit = async (code: string) => {
    if (!code) return;
    try {
      const variant = await adminApi.posLookupBarcode(code);
      if (variant) {
        onAddToCart({
          productId: variant.product.id,
          variantId: variant.id,
          productName: variant.product.name,
          variantName: variant.name,
          size: variant.size,
          color: variant.color,
          quantity: 1,
          unitPrice: Number(variant.price),
          stock: variant.stock,
          imageUrl: variant.product.images?.[0]?.url,
        });
      }
    } catch {
      // Not found - silently ignore
    }
    if (barcodeRef.current) {
      barcodeRef.current.value = '';
      barcodeRef.current.focus();
    }
  };

  const handleAddVariant = (product: Product, variant: Variant) => {
    if (variant.stock <= 0) return;
    onAddToCart({
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantName: variant.name,
      size: variant.size,
      color: variant.color,
      quantity: 1,
      unitPrice: Number(variant.price),
      stock: variant.stock,
      imageUrl: product.images?.[0]?.url,
    });
  };

  const filteredProducts = selectedCategory
    ? products.filter((p) => p.category?.id === selectedCategory)
    : products;

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar */}
      <div className="p-3 border-b border-[hsl(var(--border))]">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search products by name or SKU..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
            />
          </div>
          <button
            onClick={() => setBarcodeMode(!barcodeMode)}
            className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-1.5 transition-colors ${
              barcodeMode
                ? 'bg-brand-gold text-black border-brand-gold'
                : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]'
            }`}
          >
            <Barcode className="w-4 h-4" />
            Scan
          </button>
        </div>

        {barcodeMode && (
          <div className="mt-2">
            <input
              ref={barcodeRef}
              type="text"
              placeholder="Scan barcode or type code..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleBarcodeSubmit((e.target as HTMLInputElement).value);
                }
              }}
              className="w-full px-3 py-2 rounded-lg border-2 border-brand-gold bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Quick Category Filters */}
      <div className="px-3 py-2 border-b border-[hsl(var(--border))] flex gap-1.5 overflow-x-auto">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors ${
            !selectedCategory
              ? 'bg-brand-gold text-black'
              : 'bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors ${
              cat.id === selectedCategory
                ? 'bg-brand-gold text-black'
                : 'bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <div className="text-center py-8 text-[hsl(var(--muted-foreground))] text-sm">
            Searching...
          </div>
        )}

        {!loading && query && filteredProducts.length === 0 && (
          <div className="text-center py-8">
            <Package className="w-10 h-10 mx-auto mb-2 text-[hsl(var(--muted-foreground))]" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">No products found</p>
          </div>
        )}

        {!loading && !query && (
          <div className="text-center py-8">
            <Search className="w-10 h-10 mx-auto mb-2 text-[hsl(var(--muted-foreground))]" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Search for products to add to the sale
            </p>
          </div>
        )}

        {filteredProducts.map((product) => (
          <div
            key={product.id}
            className="border border-[hsl(var(--border))] rounded-lg p-3 bg-[hsl(var(--card))]"
          >
            <div className="flex items-start gap-3 mb-2">
              {product.images?.[0]?.url ? (
                <img
                  src={product.images[0].url}
                  alt={product.name}
                  className="w-12 h-12 rounded object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded bg-[hsl(var(--accent))] flex items-center justify-center">
                  <Package className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
                  {product.name}
                </h4>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {product.category?.name} {product.sku ? `• ${product.sku}` : ''}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              {product.variants.map((variant) => (
                <button
                  key={variant.id}
                  onClick={() => handleAddVariant(product, variant)}
                  disabled={variant.stock <= 0}
                  className={`flex items-center justify-between px-3 py-2 rounded text-xs transition-colors ${
                    variant.stock > 0
                      ? 'hover:bg-brand-gold/10 border border-[hsl(var(--border))]'
                      : 'opacity-40 cursor-not-allowed border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {variant.colorHex && (
                      <span
                        className="w-3 h-3 rounded-full border border-[hsl(var(--border))]"
                        style={{ backgroundColor: variant.colorHex }}
                      />
                    )}
                    <span className="text-[hsl(var(--foreground))]">
                      {variant.size && variant.color
                        ? `${variant.size} / ${variant.color}`
                        : variant.name}
                    </span>
                    <span className={`${variant.stock <= 3 ? 'text-amber-500' : 'text-[hsl(var(--muted-foreground))]'}`}>
                      ({variant.stock})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {Number(variant.price).toLocaleString()} TZS
                    </span>
                    {variant.stock > 0 && (
                      <Plus className="w-4 h-4 text-brand-gold" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
