'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Plus, Pencil, Trash2, Eye, EyeOff, X, FileText, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { adminApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), { ssr: false });

interface CMSPage {
  id: string;
  title: string;
  titleSwahili?: string;
  slug: string;
  content?: string;
  contentSwahili?: string;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

const emptyForm = { title: '', titleSwahili: '', slug: '', content: '', contentSwahili: '', isPublished: false };

export default function CMSPagesPage() {
  const [pages, setPages] = useState<CMSPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const fetchPages = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getPages();
      setPages(Array.isArray(data) ? data : []);
    } catch { toast.error('Failed to load pages'); setPages([]); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { fetchPages(); }, [fetchPages]);

  const generateSlug = (title: string) =>
    title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setShowForm(true); };

  const openEdit = (p: CMSPage) => {
    setEditingId(p.id);
    setForm({
      title: p.title || '', titleSwahili: p.titleSwahili || '', slug: p.slug || '',
      content: p.content || '', contentSwahili: p.contentSwahili || '', isPublished: p.isPublished,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.slug.trim()) { toast.error('Slug is required'); return; }
    setSaving(true);
    try {
      if (editingId) {
        const updated = await adminApi.updatePage(editingId, form);
        setPages((prev) => prev.map((p) => (p.id === editingId ? { ...p, ...updated } : p)));
        toast.success('Page updated');
      } else {
        const created = await adminApi.createPage(form);
        setPages((prev) => [created, ...prev]);
        toast.success('Page created');
      }
      setShowForm(false); setEditingId(null); setForm(emptyForm);
    } catch { toast.error('Failed to save page'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (p: CMSPage) => {
    const ok = await confirm({ title: 'Delete Page', message: `Move "${p.title}" to recycle bin?`, confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await adminApi.deletePage(p.id);
      setPages((prev) => prev.filter((x) => x.id !== p.id));
      toast.success('Page moved to recycle bin');
    } catch { toast.error('Failed to delete page'); }
  };

  const togglePublish = async (p: CMSPage) => {
    try {
      const updated = await adminApi.updatePage(p.id, { isPublished: !p.isPublished });
      setPages((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...updated } : x)));
      toast.success(p.isPublished ? 'Page unpublished' : 'Page published');
    } catch { toast.error('Failed to toggle page'); }
  };

  const inputClass = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';
  const labelClass = 'block text-sm font-medium text-[hsl(var(--foreground))] mb-1';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">CMS Pages</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Manage static pages for the storefront</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Create Page</Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4 sm:p-5 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">{editingId ? 'Edit Page' : 'New Page'}</h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"><X className="w-5 h-5" /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Title (English) *</label>
              <input type="text" required value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value, ...(editingId ? {} : { slug: generateSlug(e.target.value) }) })}
                className={inputClass} placeholder="Page title in English" />
            </div>
            <div>
              <label className={labelClass}>Title (Swahili)</label>
              <input type="text" value={form.titleSwahili} onChange={(e) => setForm({ ...form, titleSwahili: e.target.value })}
                className={inputClass} placeholder="Kichwa cha ukurasa kwa Kiswahili" />
            </div>
          </div>
          <div>
            <label className={labelClass}>Slug</label>
            <input type="text" required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className={`${inputClass} font-mono bg-[hsl(var(--muted))]`} />
          </div>
          <div>
            <label className={labelClass}>Content (English)</label>
            <RichTextEditor
              value={form.content}
              onChange={(val: string) => setForm({ ...form, content: val })}
              placeholder="Page content in English..."
              minHeight="250px"
              enableImageUpload
            />
          </div>
          <div>
            <label className={labelClass}>Content (Swahili)</label>
            <RichTextEditor
              value={form.contentSwahili}
              onChange={(val: string) => setForm({ ...form, contentSwahili: val })}
              placeholder="Maudhui ya ukurasa kwa Kiswahili..."
              minHeight="250px"
              enableImageUpload
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} className="sr-only peer" />
              <div className="w-11 h-6 bg-[hsl(var(--muted))] peer-focus:ring-2 peer-focus:ring-brand-gold/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-gold"></div>
            </label>
            <span className="text-sm text-[hsl(var(--foreground))]">Published</span>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} type="button">Cancel</Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : editingId ? 'Update Page' : 'Create Page'}
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-gold" /></div>
      ) : pages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <h3 className="font-semibold text-[hsl(var(--card-foreground))]">No pages yet</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-4">Create your first CMS page</p>
          <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4" /> Create Page</Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {pages.map((page) => (
            <div key={page.id} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="p-2 bg-[hsl(var(--muted))] rounded-lg shrink-0"><FileText className="w-5 h-5 text-brand-gold" /></div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[hsl(var(--foreground))] truncate">{page.title}</h3>
                    {page.titleSwahili && <span className="text-xs text-[hsl(var(--muted-foreground))]">/ {page.titleSwahili}</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                    <span className="font-mono">/{page.slug}</span>
                    <span>Updated {formatDate(page.updatedAt)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => togglePublish(page)} className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors" title={page.isPublished ? 'Unpublish' : 'Publish'}>
                  {page.isPublished ? <Eye className="w-4 h-4 text-emerald-600" /> : <EyeOff className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />}
                </button>
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  page.isPublished ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                }`}>{page.isPublished ? 'Published' : 'Draft'}</span>
                <Button variant="outline" size="sm" onClick={() => openEdit(page)}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                <button onClick={() => handleDelete(page)} className="p-2 rounded-lg hover:bg-red-50 text-[hsl(var(--muted-foreground))] hover:text-red-600 dark:hover:bg-red-900/20 transition-colors" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
