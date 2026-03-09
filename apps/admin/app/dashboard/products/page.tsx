'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Search,
  Filter,
  Download,
  MoreHorizontal,
  Edit,
  Trash2,
  Eye,
  Package,
  Loader2,
} from 'lucide-react';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { adminApi } from '@/lib/api';

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  status: string;
  availability: string;
  image: string;
  [key: string]: unknown;
}

const statusStyles: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  'Out of Stock': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

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
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    try {
      const res = await adminApi.getProducts();
      const data = Array.isArray(res) ? res : res?.data || res?.products || [];
      setProducts(data);
    } catch (err) {
      console.error('Failed to fetch products:', err);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    setDeleting(id);
    try {
      const token = localStorage.getItem('token');
      if (token) adminApi.setToken(token);
      await adminApi.deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to delete product:', err);
      alert('Failed to delete product. Please try again.');
    } finally {
      setDeleting(null);
    }
  };

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: 'Product',
      sortable: true,
      render: (item) => (
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg bg-[hsl(var(--muted))] flex-shrink-0"
            style={{
              backgroundImage: `url(${item.image})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div>
            <p className="font-medium text-[hsl(var(--card-foreground))]">{item.name as string}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{item.id as string}</p>
          </div>
        </div>
      ),
    },
    { key: 'category', header: 'Category', sortable: true },
    {
      key: 'price',
      header: 'Price',
      sortable: true,
      render: (item) => <span className="font-medium">{formatCurrency(item.price as number)}</span>,
    },
    {
      key: 'stock',
      header: 'Stock',
      sortable: true,
      render: (item) => (
        <span className={cn('font-medium', (item.stock as number) <= 5 && (item.stock as number) > 0 && 'text-amber-600', (item.stock as number) === 0 && 'text-red-600')}>
          {item.stock as number}
        </span>
      ),
    },
    {
      key: 'availability',
      header: 'Type',
      render: (item) => (
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', availabilityStyles[item.availability as string])}>
          {availabilityLabels[item.availability as string]}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (item) => (
        <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', statusStyles[item.status as string])}>
          {item.status as string}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (item) => (
        <div className="flex items-center gap-1">
          <button className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors" title="View">
            <Eye className="w-4 h-4" />
          </button>
          <button className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-blue-600 transition-colors" title="Edit">
            <Edit className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors disabled:opacity-50"
            title="Delete"
            disabled={deleting === item.id}
            onClick={() => handleDelete(item.id as string)}
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
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-9 pr-4 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
          />
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none">
            <option>All Categories</option>
            <option>Women</option>
            <option>Men</option>
            <option>Gowns</option>
            <option>Accessories</option>
            <option>Shoes</option>
          </select>
          <select className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none">
            <option>All Status</option>
            <option>Active</option>
            <option>Draft</option>
            <option>Out of Stock</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <DataTable columns={columns} data={filteredProducts} pageSize={10} />
    </div>
  );
}
