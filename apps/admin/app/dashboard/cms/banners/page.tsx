'use client';

import { useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Eye,
  EyeOff,
  ImageIcon,
  ExternalLink,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { formatDate } from '@/lib/utils';

interface Banner {
  id: string;
  title: string;
  titleSwahili: string;
  subtitle: string;
  subtitleSwahili: string;
  imageUrl: string;
  linkUrl: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

const mockBanners: Banner[] = [
  {
    id: '1',
    title: 'New Collection 2026',
    titleSwahili: 'Mkusanyiko Mpya 2026',
    subtitle: 'Discover the latest trends in fashion',
    subtitleSwahili: 'Gundua mitindo ya hivi karibuni',
    imageUrl: '/images/banners/hero-1.jpg',
    linkUrl: '/products',
    sortOrder: 1,
    isActive: true,
    createdAt: '2026-02-15',
  },
  {
    id: '2',
    title: 'Rent a Gown',
    titleSwahili: 'Kodi Gauni',
    subtitle: 'Premium gowns available for rent at affordable prices',
    subtitleSwahili: 'Gauni za kifahari zinapatikana kwa bei nafuu',
    imageUrl: '/images/banners/hero-2.jpg',
    linkUrl: '/rentals',
    sortOrder: 2,
    isActive: true,
    createdAt: '2026-02-20',
  },
  {
    id: '3',
    title: 'Flash Sale Weekend',
    titleSwahili: 'Mauzo ya Haraka Wikendi',
    subtitle: 'Up to 50% off selected items this weekend only',
    subtitleSwahili: 'Hadi 50% punguzo kwa bidhaa zilizochaguliwa wikendi hii',
    imageUrl: '/images/banners/hero-3.jpg',
    linkUrl: '/flash-sales',
    sortOrder: 3,
    isActive: false,
    createdAt: '2026-03-01',
  },
  {
    id: '4',
    title: 'Free Delivery',
    titleSwahili: 'Usafirishaji Bure',
    subtitle: 'Free delivery on all orders above TZS 100,000',
    subtitleSwahili: 'Usafirishaji bure kwa oda zote zaidi ya TZS 100,000',
    imageUrl: '/images/banners/hero-4.jpg',
    linkUrl: '/products',
    sortOrder: 4,
    isActive: true,
    createdAt: '2026-03-05',
  },
];

export default function BannersPage() {
  const [banners, setBanners] = useState(mockBanners);
  const [showForm, setShowForm] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);

  const toggleActive = (id: string) => {
    setBanners((prev) =>
      prev.map((b) => (b.id === id ? { ...b, isActive: !b.isActive } : b))
    );
  };

  const deleteBanner = (id: string) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
  };

  const openEdit = (banner: Banner) => {
    setEditingBanner(banner);
    setShowForm(true);
  };

  const openCreate = () => {
    setEditingBanner(null);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Banners</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Manage homepage hero banners and promotional slides
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="w-4 h-4" />
          Add Banner
        </Button>
      </div>

      {/* Banner Form Modal */}
      {showForm && (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-4">
            {editingBanner ? 'Edit Banner' : 'Create New Banner'}
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">Title (English)</label>
              <input
                type="text"
                defaultValue={editingBanner?.title || ''}
                placeholder="e.g., Summer Collection 2026"
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">Title (Swahili)</label>
              <input
                type="text"
                defaultValue={editingBanner?.titleSwahili || ''}
                placeholder="e.g., Mkusanyiko wa Kiangazi 2026"
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">Subtitle (English)</label>
              <input
                type="text"
                defaultValue={editingBanner?.subtitle || ''}
                placeholder="Short description text"
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">Subtitle (Swahili)</label>
              <input
                type="text"
                defaultValue={editingBanner?.subtitleSwahili || ''}
                placeholder="Maelezo mafupi"
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">Image URL</label>
              <input
                type="text"
                defaultValue={editingBanner?.imageUrl || ''}
                placeholder="/images/banners/hero.jpg"
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">Link URL</label>
              <input
                type="text"
                defaultValue={editingBanner?.linkUrl || ''}
                placeholder="/products or /rentals"
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-5">
            <Button size="sm">{editingBanner ? 'Update Banner' : 'Create Banner'}</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Banner List */}
      <div className="space-y-3">
        {banners.map((banner) => (
          <div
            key={banner.id}
            className={`rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden transition-opacity ${
              banner.isActive ? 'border-[hsl(var(--border))]' : 'border-dashed border-[hsl(var(--border))] opacity-60'
            }`}
          >
            <div className="flex flex-col sm:flex-row">
              {/* Image Preview */}
              <div className="sm:w-48 h-32 sm:h-auto bg-[hsl(var(--muted))] flex items-center justify-center shrink-0">
                <div className="flex flex-col items-center gap-1 text-[hsl(var(--muted-foreground))]">
                  <ImageIcon className="w-8 h-8" />
                  <span className="text-xs">Preview</span>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <button className="mt-1 cursor-grab text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                      <GripVertical className="w-4 h-4" />
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-[hsl(var(--card-foreground))]">{banner.title}</h3>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          banner.isActive
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                          {banner.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">{banner.subtitle}</p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                        <span>SW: {banner.titleSwahili}</span>
                        <span className="flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" />
                          {banner.linkUrl}
                        </span>
                        <span>Order: #{banner.sortOrder}</span>
                        <span>Created: {formatDate(banner.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleActive(banner.id)}
                      className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
                      title={banner.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {banner.isActive ? (
                        <Eye className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <EyeOff className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                      )}
                    </button>
                    <button
                      onClick={() => openEdit(banner)}
                      className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteBanner(banner.id)}
                      className="p-2 rounded-lg hover:bg-red-50 text-[hsl(var(--muted-foreground))] hover:text-red-600 dark:hover:bg-red-900/20 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {banners.length === 0 && (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-12 text-center">
          <ImageIcon className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <h3 className="font-semibold text-[hsl(var(--card-foreground))]">No banners yet</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-4">Create your first homepage banner</p>
          <Button size="sm" className="gap-1.5" onClick={openCreate}>
            <Plus className="w-4 h-4" />
            Add Banner
          </Button>
        </div>
      )}
    </div>
  );
}
