'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Zap,
  Edit,
  Trash2,
  Eye,
  X,
  Search,
  Loader2,
} from 'lucide-react';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import { formatCurrency, formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { adminApi } from '@/lib/api';

interface FlashSaleProduct {
  [key: string]: string | number;
  name: string;
  originalPrice: number;
  salePrice: number;
}

interface FlashSale {
  id: string;
  titleEn: string;
  titleSw: string;
  startDate: string;
  endDate: string;
  products: FlashSaleProduct[];
  status: string;
  [key: string]: unknown;
}

const statusStyles: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Ended: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export default function FlashSalesPage() {
  const [flashSales, setFlashSales] = useState<FlashSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formTitleEn, setFormTitleEn] = useState('');
  const [formTitleSw, setFormTitleSw] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formProducts, setFormProducts] = useState<FlashSaleProduct[]>([
    { name: '', originalPrice: 0, salePrice: 0 },
  ]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchFlashSales = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getFlashSales();
        setFlashSales(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to fetch flash sales:', err);
        setFlashSales([]);
      } finally {
        setLoading(false);
      }
    };
    fetchFlashSales();
  }, []);

  const addFormProduct = () => {
    setFormProducts([...formProducts, { name: '', originalPrice: 0, salePrice: 0 }]);
  };

  const updateFormProduct = (idx: number, field: keyof FlashSaleProduct, value: string | number) => {
    const updated = [...formProducts];
    (updated[idx] as Record<string, unknown>)[field] = value;
    setFormProducts(updated);
  };

  const removeFormProduct = (idx: number) => {
    setFormProducts(formProducts.filter((_, i) => i !== idx));
  };

  const resetForm = () => {
    setFormTitleEn('');
    setFormTitleSw('');
    setFormStart('');
    setFormEnd('');
    setFormProducts([{ name: '', originalPrice: 0, salePrice: 0 }]);
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!formTitleEn || !formStart || !formEnd) return;
    try {
      setSubmitting(true);
      const created = await adminApi.createFlashSale({
        titleEn: formTitleEn,
        titleSw: formTitleSw,
        startDate: formStart,
        endDate: formEnd,
        products: formProducts.filter((p) => p.name),
      });
      setFlashSales((prev) => [...prev, created]);
      resetForm();
    } catch (err) {
      console.error('Failed to create flash sale:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this flash sale?')) return;
    try {
      await adminApi.deleteFlashSale(id);
      setFlashSales((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Failed to delete flash sale:', err);
    }
  };

  const filteredSales = flashSales.filter(
    (s) =>
      (s.titleEn || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.titleSw || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const columns: Column<FlashSale>[] = [
    {
      key: 'titleEn',
      header: 'Title',
      sortable: true,
      render: (item) => (
        <div>
          <p className="font-medium text-[hsl(var(--card-foreground))]">{item.titleEn as string}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{item.titleSw as string}</p>
        </div>
      ),
    },
    {
      key: 'startDate',
      header: 'Start Date',
      sortable: true,
      render: (item) => (
        <span className="text-sm">{formatDate(item.startDate as string)}</span>
      ),
    },
    {
      key: 'endDate',
      header: 'End Date',
      sortable: true,
      render: (item) => (
        <span className="text-sm">{formatDate(item.endDate as string)}</span>
      ),
    },
    {
      key: 'products',
      header: 'Products',
      render: (item) => (
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[hsl(var(--muted))] text-sm font-medium text-[hsl(var(--foreground))]">
          {(item.products as FlashSaleProduct[] || []).length}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (item) => (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
            statusStyles[item.status as string]
          )}
        >
          {(item.status as string) === 'Active' && <Zap className="w-3 h-3" />}
          {item.status as string}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (item) => (
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors"
            title="View"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-blue-600 transition-colors"
            title="Edit"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleDelete(item.id)}
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  const inputClass =
    'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Flash Sales</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Create and manage time-limited promotions
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setShowForm(true)}
        >
          <Plus className="w-4 h-4" />
          Create Flash Sale
        </Button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="rounded-lg border border-brand-gold bg-[hsl(var(--card))] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
              New Flash Sale
            </h3>
            <button
              onClick={resetForm}
              className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">
                Title (English) *
              </label>
              <input
                type="text"
                value={formTitleEn}
                onChange={(e) => setFormTitleEn(e.target.value)}
                placeholder="e.g. Weekend Special"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">
                Title (Swahili)
              </label>
              <input
                type="text"
                value={formTitleSw}
                onChange={(e) => setFormTitleSw(e.target.value)}
                placeholder="e.g. Maalum ya Wikendi"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">
                Start Date & Time *
              </label>
              <input
                type="datetime-local"
                value={formStart}
                onChange={(e) => setFormStart(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">
                End Date & Time *
              </label>
              <input
                type="datetime-local"
                value={formEnd}
                onChange={(e) => setFormEnd(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {/* Products in sale */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[hsl(var(--foreground))]">
                Sale Products
              </label>
              <button
                onClick={addFormProduct}
                className="text-xs text-brand-gold hover:underline font-medium"
              >
                + Add Product
              </button>
            </div>

            {formProducts.map((fp, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end p-3 rounded-lg bg-[hsl(var(--muted))]"
              >
                <div>
                  <label className="block text-[10px] text-[hsl(var(--muted-foreground))] mb-1">
                    Product
                  </label>
                  <select
                    value={fp.name}
                    onChange={(e) => updateFormProduct(idx, 'name', e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select product</option>
                    <option value="Elegant Pink Silk Blouse">Elegant Pink Silk Blouse</option>
                    <option value="Ankara Print Maxi Dress">Ankara Print Maxi Dress</option>
                    <option value="Gold Beaded Evening Gown">Gold Beaded Evening Gown</option>
                    <option value="Pearl Studded Clutch Bag">Pearl Studded Clutch Bag</option>
                    <option value="Slim Fit Navy Suit">Slim Fit Navy Suit</option>
                    <option value="Leather Ankle Boots">Leather Ankle Boots</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[hsl(var(--muted-foreground))] mb-1">
                    Original Price (TZS)
                  </label>
                  <input
                    type="number"
                    value={fp.originalPrice || ''}
                    onChange={(e) => updateFormProduct(idx, 'originalPrice', parseInt(e.target.value) || 0)}
                    placeholder="85000"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[hsl(var(--muted-foreground))] mb-1">
                    Sale Price (TZS)
                  </label>
                  <input
                    type="number"
                    value={fp.salePrice || ''}
                    onChange={(e) => updateFormProduct(idx, 'salePrice', parseInt(e.target.value) || 0)}
                    placeholder="59000"
                    className={inputClass}
                  />
                </div>
                {formProducts.length > 1 && (
                  <button
                    onClick={() => removeFormProduct(idx)}
                    className="p-2 rounded-lg hover:bg-red-100 text-red-500 hover:text-red-700 transition-colors self-end"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button size="sm" onClick={handleCreate} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Create Flash Sale
            </Button>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
        <input
          type="text"
          placeholder="Search flash sales..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-9 pr-4 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            label: 'Active',
            count: flashSales.filter((s) => s.status === 'Active').length,
            color: 'text-emerald-600',
          },
          {
            label: 'Scheduled',
            count: flashSales.filter((s) => s.status === 'Scheduled').length,
            color: 'text-blue-600',
          },
          {
            label: 'Ended',
            count: flashSales.filter((s) => s.status === 'Ended').length,
            color: 'text-gray-500',
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 flex items-center justify-between"
          >
            <span className="text-sm text-[hsl(var(--muted-foreground))]">{stat.label}</span>
            <span className={cn('text-2xl font-bold', stat.color)}>{stat.count}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : (
        <DataTable columns={columns} data={filteredSales} pageSize={10} />
      )}
    </div>
  );
}
