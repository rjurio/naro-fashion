'use client';

import { useState, useEffect } from 'react';
import {
  Trash2, RotateCcw, Loader2, Package, FolderTree, Zap,
  ClipboardList, Image as ImageIcon, FileText, AlertTriangle, Camera,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';

type TabKey = 'products' | 'categories' | 'flashSales' | 'checklists' | 'banners' | 'pages' | 'events';

interface DeletedItem {
  id: string;
  name?: string;
  title?: string;
  slug?: string;
  deletedAt: string;
  [key: string]: unknown;
}

const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'products', label: 'Products', icon: Package },
  { key: 'categories', label: 'Categories', icon: FolderTree },
  { key: 'flashSales', label: 'Flash Sales', icon: Zap },
  { key: 'checklists', label: 'Checklists', icon: ClipboardList },
  { key: 'banners', label: 'Banners', icon: ImageIcon },
  { key: 'pages', label: 'Pages', icon: FileText },
  { key: 'events', label: 'Events', icon: Camera },
];

const fetchFns: Record<TabKey, () => Promise<any>> = {
  products: () => adminApi.getDeletedProducts(),
  categories: () => adminApi.getDeletedCategories(),
  flashSales: () => adminApi.getDeletedFlashSales(),
  checklists: () => adminApi.getDeletedChecklistTemplates(),
  banners: () => adminApi.getDeletedBanners(),
  pages: () => adminApi.getDeletedPages(),
  events: () => adminApi.getDeletedEvents(),
};

const restoreFns: Record<TabKey, (id: string) => Promise<any>> = {
  products: (id) => adminApi.restoreProduct(id),
  categories: (id) => adminApi.restoreCategory(id),
  flashSales: (id) => adminApi.restoreFlashSale(id),
  checklists: (id) => adminApi.restoreChecklistTemplate(id),
  banners: (id) => adminApi.restoreBanner(id),
  pages: (id) => adminApi.restorePage(id),
  events: (id) => adminApi.restoreEvent(id),
};

function getItemName(item: DeletedItem): string {
  return item.name || item.title || item.slug || item.id;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RecycleBinPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('products');
  const [items, setItems] = useState<DeletedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<TabKey, number>>({
    products: 0, categories: 0, flashSales: 0, checklists: 0, banners: 0, pages: 0, events: 0,
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    // Fetch counts for all tabs
    const fetchCounts = async () => {
      const results = await Promise.allSettled(
        tabs.map(async (tab) => {
          try {
            const data = await fetchFns[tab.key]();
            return { key: tab.key, count: Array.isArray(data) ? data.length : 0 };
          } catch {
            return { key: tab.key, count: 0 };
          }
        })
      );
      const newCounts: Record<string, number> = {};
      results.forEach((r) => {
        if (r.status === 'fulfilled') {
          newCounts[r.value.key] = r.value.count;
        }
      });
      setCounts((prev) => ({ ...prev, ...newCounts }));
    };
    fetchCounts();
  }, []);

  useEffect(() => {
    const fetchItems = async () => {
      setLoading(true);
      try {
        const data = await fetchFns[activeTab]();
        setItems(Array.isArray(data) ? data : []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    fetchItems();
  }, [activeTab]);

  const handleRestore = async (id: string) => {
    setRestoring(id);
    try {
      await restoreFns[activeTab](id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      setCounts((prev) => ({ ...prev, [activeTab]: Math.max(0, prev[activeTab] - 1) }));
    } catch (err) {
      console.error('Failed to restore:', err);
      alert('Failed to restore item. Please try again.');
    } finally {
      setRestoring(null);
    }
  };

  const totalDeleted = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
            <Trash2 className="w-6 h-6 text-[hsl(var(--muted-foreground))]" />
            Recycle Bin
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            {totalDeleted} deleted item{totalDeleted !== 1 ? 's' : ''} across all categories
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[hsl(var(--border))] overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-brand-gold text-brand-gold'
                : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border))]'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {counts[tab.key] > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-medium ${
                activeTab === tab.key
                  ? 'bg-brand-gold text-white'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              }`}>
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20">
          <Trash2 className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3 opacity-30" />
          <p className="text-[hsl(var(--muted-foreground))]">
            No deleted {tabs.find((t) => t.key === activeTab)?.label.toLowerCase()} found
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] opacity-75 hover:opacity-100 transition-opacity"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-5 h-5 text-red-500" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-[hsl(var(--foreground))] truncate">
                    {getItemName(item)}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      ID: {item.id.slice(0, 12)}...
                    </span>
                    {item.deletedAt && (
                      <span className="text-xs text-red-500">
                        Deleted {formatDate(item.deletedAt)}
                      </span>
                    )}
                    {(item as any).category && (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        {typeof (item as any).category === 'object' ? (item as any).category.name : (item as any).category}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                <Button
                  size="sm"
                  onClick={() => handleRestore(item.id)}
                  disabled={restoring === item.id}
                  className="gap-1.5"
                >
                  {restoring === item.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  Restore
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Warning */}
      {items.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
              Soft-deleted items
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
              These items are hidden from customers but still in the database. Restore them to make them available again.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
