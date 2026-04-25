'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, GripVertical, Eye, EyeOff,
  ImageIcon, ExternalLink, Loader2, X,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import PresetImageUploadField from '@/components/ui/PresetImageUploadField';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { adminApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Banner {
  id: string;
  title: string;
  titleSwahili?: string;
  subtitle?: string;
  subtitleSwahili?: string;
  imageUrl?: string;
  linkUrl?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

const emptyForm = {
  title: '', titleSwahili: '', subtitle: '', subtitleSwahili: '',
  imageUrl: '', linkUrl: '', sortOrder: 0,
};

export default function BannersPage() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const fetchBanners = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getBanners();
      setBanners(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load banners');
      setBanners([]);
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { fetchBanners(); }, [fetchBanners]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (b: Banner) => {
    setEditingId(b.id);
    setForm({
      title: b.title || '',
      titleSwahili: b.titleSwahili || '',
      subtitle: b.subtitle || '',
      subtitleSwahili: b.subtitleSwahili || '',
      imageUrl: b.imageUrl || '',
      linkUrl: b.linkUrl || '',
      sortOrder: b.sortOrder ?? 0,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      if (editingId) {
        const updated = await adminApi.updateBanner(editingId, form);
        setBanners((prev) => prev.map((b) => (b.id === editingId ? { ...b, ...updated } : b)));
        toast.success('Banner updated');
      } else {
        const created = await adminApi.createBanner(form);
        setBanners((prev) => [...prev, created]);
        toast.success('Banner created');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
    } catch { toast.error('Failed to save banner'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (b: Banner) => {
    try {
      const updated = await adminApi.updateBanner(b.id, { isActive: !b.isActive });
      setBanners((prev) => prev.map((x) => (x.id === b.id ? { ...x, ...updated } : x)));
      toast.success(b.isActive ? 'Banner deactivated' : 'Banner activated');
    } catch { toast.error('Failed to toggle banner'); }
  };

  const handleDelete = async (b: Banner) => {
    const ok = await confirm({
      title: 'Delete Banner',
      message: `Move "${b.title}" to recycle bin?`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await adminApi.deleteBanner(b.id);
      setBanners((prev) => prev.filter((x) => x.id !== b.id));
      toast.success('Banner moved to recycle bin');
    } catch { toast.error('Failed to delete banner'); }
  };

  const inputClass = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50';
  const labelClass = 'block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5';

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

      {/* Banner Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5 md:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))]">
              {editingId ? 'Edit Banner' : 'Create New Banner'}
            </h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Title (English) *</label>
              <input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g., Summer Collection 2026" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Title (Swahili)</label>
              <input type="text" value={form.titleSwahili} onChange={(e) => setForm({ ...form, titleSwahili: e.target.value })} placeholder="e.g., Mkusanyiko wa Kiangazi 2026" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Subtitle (English)</label>
              <input type="text" value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="Short description text" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Subtitle (Swahili)</label>
              <input type="text" value={form.subtitleSwahili} onChange={(e) => setForm({ ...form, subtitleSwahili: e.target.value })} placeholder="Maelezo mafupi" className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Banner Image</label>
              <PresetImageUploadField
                presetKey="banner"
                value={form.imageUrl || null}
                onChange={(u) => setForm({ ...form, imageUrl: u || '' })}
              />
            </div>
            <div>
              <label className={labelClass}>Link URL</label>
              <input type="text" value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} placeholder="/products or /rentals" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Sort Order</label>
              <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} className={inputClass} />
            </div>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:gap-3 mt-5">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} type="button">Cancel</Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : editingId ? 'Update Banner' : 'Create Banner'}
            </Button>
          </div>
        </form>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : banners.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-12 text-center">
          <ImageIcon className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <h3 className="font-semibold text-[hsl(var(--card-foreground))]">No banners yet</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-4">Create your first homepage banner</p>
          <Button size="sm" className="gap-1.5" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Add Banner
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {banners.map((banner) => (
            <div key={banner.id}
              className={`rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden transition-opacity ${
                banner.isActive ? 'border-[hsl(var(--border))]' : 'border-dashed border-[hsl(var(--border))] opacity-60'
              }`}>
              <div className="flex flex-col sm:flex-row">
                <div className="sm:w-48 h-32 sm:h-auto bg-[hsl(var(--muted))] flex items-center justify-center shrink-0">
                  {banner.imageUrl ? (
                    <img src={banner.imageUrl.startsWith('/uploads') ? `${API_ORIGIN}${banner.imageUrl}` : banner.imageUrl} alt={banner.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-[hsl(var(--muted-foreground))]">
                      <ImageIcon className="w-8 h-8" /><span className="text-xs">No image</span>
                    </div>
                  )}
                </div>
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
                          }`}>{banner.isActive ? 'Active' : 'Inactive'}</span>
                        </div>
                        {banner.subtitle && <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">{banner.subtitle}</p>}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                          {banner.titleSwahili && <span>SW: {banner.titleSwahili}</span>}
                          {banner.linkUrl && (
                            <span className="flex items-center gap-1"><ExternalLink className="w-3 h-3" />{banner.linkUrl}</span>
                          )}
                          <span>Order: #{banner.sortOrder}</span>
                          <span>Created: {formatDate(banner.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => toggleActive(banner)} className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
                        title={banner.isActive ? 'Deactivate' : 'Activate'}>
                        {banner.isActive ? <Eye className="w-4 h-4 text-emerald-600" /> : <EyeOff className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />}
                      </button>
                      <button onClick={() => openEdit(banner)} className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(banner)} className="p-2 rounded-lg hover:bg-red-50 text-[hsl(var(--muted-foreground))] hover:text-red-600 dark:hover:bg-red-900/20 transition-colors" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
