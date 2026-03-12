'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  Package,
  Loader2,
  Power,
  Barcode,
} from 'lucide-react';
import DataTable, { type Column } from '@/components/ui/DataTable';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import BarcodeModal from '@/components/products/BarcodeModal';

interface Product {
  id: string;
  name: string;
  category: any;
  basePrice: number;
  price: number;
  stock: number;
  isActive: boolean;
  availabilityMode: string;
  sku: string | null;
  variants: any[];
  images: any[];
  [key: string]: unknown;
}

const availabilityStyles: Record<string, string> = {
  PURCHASE_ONLY: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  RENTAL_ONLY: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  BOTH: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

const availabilityLabels: Record<string, string> = {
  PURCHASE_ONLY: 'Purchase',
  RENTAL_ONLY: 'Rental',
  BOTH: 'Both',
};

export default function ProductsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [barcodeProduct, setBarcodeProduct] = useState<Product | null>(null);

  const fetchProducts = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    try {
      const res = await adminApi.getProducts();
      const data = Array.isArray(res) ? res : res?.data || res?.products || [];
      setProducts(data);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Delete Product',
      message: 'This product will be moved to the recycle bin. You can restore it later.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    setDeleting(id);
    try {
      await adminApi.deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
      toast('Product deleted', 'success');
    } catch {
      toast('Failed to delete product', 'error');
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleActive = async (id: string) => {
    try {
      const updated = await adminApi.toggleProduct(id);
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updated, isActive: updated.isActive } : p)));
      toast(updated.isActive ? 'Product activated' : 'Product deactivated', 'success');
    } catch {
      toast('Failed to toggle product', 'error');
    }
  };

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getImage = (item: Product) => {
    if (item.images?.[0]?.url) return item.images[0].url.startsWith('/') ? `http://localhost:4000${item.images[0].url}` : item.images[0].url;
    if ((item as any).image) return (item as any).image;
    return null;
  };

  const getStock = (item: Product) => {
    if (item.variants?.length) return item.variants.reduce((s: number, v: any) => s + (v.stock || 0), 0);
    return (item as any).stock ?? 0;
  };

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: 'Product',
      sortable: true,
      render: (item) => {
        const img = getImage(item);
        return (
          <div className="flex items-center gap-3">
            {img ? (
              <img src={img} alt={item.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-[hsl(var(--muted))] flex items-center justify-center flex-shrink-0">
                <Package className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
              </div>
            )}
            <div>
              <p className="font-medium text-[hsl(var(--card-foreground))]">{item.name}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{item.sku || item.id.substring(0, 8)}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'category',
      header: 'Category',
      sortable: true,
      render: (item) => typeof item.category === 'object' && item.category ? item.category.name : (item.category || 'Uncategorized'),
    },
    {
      key: 'price',
      header: 'Price',
      sortable: true,
      render: (item) => <span className="font-medium">{formatCurrency(Number(item.basePrice || item.price || 0))}</span>,
    },
    {
      key: 'stock',
      header: 'Stock',
      sortable: true,
      render: (item) => {
        const stock = getStock(item);
        return (
          <span className={cn('font-medium', stock <= 5 && stock > 0 && 'text-amber-600', stock === 0 && 'text-red-600')}>
            {stock}
          </span>
        );
      },
    },
    {
      key: 'availabilityMode',
      header: 'Type',
      render: (item) => {
        const mode = item.availabilityMode || 'PURCHASE_ONLY';
        return (
          <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', availabilityStyles[mode])}>
            {availabilityLabels[mode]}
          </span>
        );
      },
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (item) => {
        const active = item.isActive !== false;
        return (
          <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
            active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          )}>
            {active ? 'Active' : 'Inactive'}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: (item) => (
        <div className="flex items-center gap-1">
          <button
            className={`p-1.5 rounded-lg transition-colors ${item.isActive !== false ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            title={item.isActive !== false ? 'Deactivate' : 'Activate'}
            onClick={() => handleToggleActive(item.id)}
          >
            <Power className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors"
            title="Barcode"
            onClick={() => setBarcodeProduct(item)}
          >
            <Barcode className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-blue-600 transition-colors"
            title="Edit"
            onClick={() => router.push(`/dashboard/products/${item.id}/edit`)}
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors disabled:opacity-50"
            title="Delete"
            disabled={deleting === item.id}
            onClick={() => handleDelete(item.id)}
          >
            {deleting === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Products</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Manage your product inventory ({products.length} total)
          </p>
        </div>
        <button
          onClick={() => router.push('/dashboard/products/new')}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-gold text-black text-sm font-medium hover:bg-brand-gold/90"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
        <input
          type="text"
          placeholder="Search products..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-9 pr-4 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
        />
      </div>

      {/* Table */}
      <DataTable columns={columns} data={filteredProducts} pageSize={10} />

      {/* Barcode Modal */}
      {barcodeProduct && (
        <BarcodeModal
          productName={barcodeProduct.name}
          productSku={barcodeProduct.sku}
          variants={barcodeProduct.variants || []}
          onClose={() => setBarcodeProduct(null)}
        />
      )}
    </div>
  );
}
