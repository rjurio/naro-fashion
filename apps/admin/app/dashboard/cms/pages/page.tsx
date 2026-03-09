'use client';

import { useState } from 'react';
import { Plus, Pencil, Eye, EyeOff, X, FileText } from 'lucide-react';
import Button from '@/components/ui/Button';
import { formatDate } from '@/lib/utils';

interface CMSPage {
  id: string;
  titleEn: string;
  titleSw: string;
  slug: string;
  published: boolean;
  updatedAt: string;
}

const mockPages: CMSPage[] = [
  { id: '1', titleEn: 'About Us', titleSw: 'Kuhusu Sisi', slug: 'about-us', published: true, updatedAt: '2026-03-05' },
  { id: '2', titleEn: 'Contact', titleSw: 'Wasiliana Nasi', slug: 'contact', published: true, updatedAt: '2026-03-02' },
  { id: '3', titleEn: 'FAQ', titleSw: 'Maswali Yanayoulizwa Mara kwa Mara', slug: 'faq', published: true, updatedAt: '2026-02-28' },
  { id: '4', titleEn: 'Terms & Conditions', titleSw: 'Sheria na Masharti', slug: 'terms-and-conditions', published: true, updatedAt: '2026-02-20' },
  { id: '5', titleEn: 'Privacy Policy', titleSw: 'Sera ya Faragha', slug: 'privacy-policy', published: true, updatedAt: '2026-02-20' },
  { id: '6', titleEn: 'Return Policy', titleSw: 'Sera ya Kurudisha', slug: 'return-policy', published: false, updatedAt: '2026-01-15' },
];

export default function CMSPagesPage() {
  const [pages, setPages] = useState<CMSPage[]>(mockPages);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    titleEn: '',
    titleSw: '',
    slug: '',
    contentEn: '',
    contentSw: '',
    published: false,
  });

  const handleSlugGenerate = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newPage: CMSPage = {
      id: String(pages.length + 1),
      titleEn: form.titleEn,
      titleSw: form.titleSw,
      slug: form.slug,
      published: form.published,
      updatedAt: new Date().toISOString().split('T')[0],
    };
    setPages([newPage, ...pages]);
    setForm({ titleEn: '', titleSw: '', slug: '', contentEn: '', contentSw: '', published: false });
    setShowForm(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">CMS Pages</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Manage static pages for the storefront
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : 'Create Page'}
        </Button>
      </div>

      {/* Create Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">New Page</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Title (English)</label>
              <input
                type="text"
                required
                value={form.titleEn}
                onChange={(e) => {
                  setForm({ ...form, titleEn: e.target.value, slug: handleSlugGenerate(e.target.value) });
                }}
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
                placeholder="Page title in English"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Title (Swahili)</label>
              <input
                type="text"
                required
                value={form.titleSw}
                onChange={(e) => setForm({ ...form, titleSw: e.target.value })}
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
                placeholder="Kichwa cha ukurasa kwa Kiswahili"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Slug</label>
            <input
              type="text"
              required
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] font-mono outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Content (English)</label>
              <textarea
                rows={5}
                value={form.contentEn}
                onChange={(e) => setForm({ ...form, contentEn: e.target.value })}
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold resize-y"
                placeholder="Page content in English..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">Content (Swahili)</label>
              <textarea
                rows={5}
                value={form.contentSw}
                onChange={(e) => setForm({ ...form, contentSw: e.target.value })}
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold resize-y"
                placeholder="Maudhui ya ukurasa kwa Kiswahili..."
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => setForm({ ...form, published: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[hsl(var(--muted))] peer-focus:ring-2 peer-focus:ring-brand-gold/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-gold"></div>
            </label>
            <span className="text-sm text-[hsl(var(--foreground))]">Published</span>
          </div>

          <div className="flex justify-end">
            <Button type="submit">Create Page</Button>
          </div>
        </form>
      )}

      {/* Pages List */}
      <div className="grid gap-3">
        {pages.map((page) => (
          <div
            key={page.id}
            className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="p-2 bg-[hsl(var(--muted))] rounded-lg shrink-0">
                <FileText className="w-5 h-5 text-brand-gold" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-[hsl(var(--foreground))] truncate">{page.titleEn}</h3>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">/ {page.titleSw}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  <span className="font-mono">/{page.slug}</span>
                  <span>Updated {formatDate(page.updatedAt)}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  page.published
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                }`}
              >
                {page.published ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {page.published ? 'Published' : 'Draft'}
              </span>
              <Button variant="outline" size="sm">
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
