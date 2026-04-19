'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, ChevronRight, ChevronDown, Pencil, Trash2, X, FolderOpen, Loader2,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { adminApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Category {
  id: string;
  // API returns name / nameSwahili; older admin code read nameEn / nameSw — support both
  name?: string;
  nameSwahili?: string;
  nameEn?: string;
  nameSw?: string;
  slug: string;
  parentId: string | null;
  image?: string;
  imageUrl?: string;
  productCount?: number;
  _count?: { products: number };
  children?: Category[];
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [formNameEn, setFormNameEn] = useState('');
  const [formNameSw, setFormNameSw] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formParent, setFormParent] = useState('');
  const [formImage, setFormImage] = useState('');
  const [formSizeGuideId, setFormSizeGuideId] = useState('');
  const [sizeGuides, setSizeGuides] = useState<{ id: string; name: string }[]>([]);

  const toast = useToast();
  const confirm = useConfirm();

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getCategories();
      setCategories(Array.isArray(data) ? data : []);
      // auto-expand top-level
      const topIds = (Array.isArray(data) ? data : []).map((c: Category) => c.id);
      setExpanded(new Set(topIds));
    } catch { toast.error('Failed to load categories'); setCategories([]); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  useEffect(() => {
    adminApi.getSizeGuides().then((guides) => {
      setSizeGuides((Array.isArray(guides) ? guides : []).filter((g: any) => g.isActive));
    }).catch(() => {});
  }, []);

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const resetForm = () => {
    setFormNameEn(''); setFormNameSw(''); setFormSlug(''); setFormParent(''); setFormImage(''); setFormSizeGuideId('');
    setShowForm(false); setEditingId(null);
  };

  const startEdit = (cat: Category) => {
    setFormNameEn(cat.name ?? cat.nameEn ?? '');
    setFormNameSw(cat.nameSwahili ?? cat.nameSw ?? '');
    setFormSlug(cat.slug);
    setFormParent(cat.parentId || '');
    setFormImage(cat.image ?? cat.imageUrl ?? '');
    setFormSizeGuideId((cat as any).sizeGuideId || '');
    setEditingId(cat.id);
    setShowForm(true);
  };

  const handleDelete = async (cat: Category) => {
    const displayName = cat.name ?? cat.nameEn ?? cat.slug;
    const ok = await confirm({ title: 'Delete Category', message: `Move "${displayName}" to recycle bin?`, confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await adminApi.deleteCategory(cat.id);
      toast.success('Category moved to recycle bin');
      fetchCategories();
    } catch { toast.error('Failed to delete category'); }
  };

  const handleSave = async () => {
    if (!formNameEn.trim()) { toast.error('Name is required'); return; }
    const slug = formSlug || formNameEn.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
    const payload: any = {
      nameEn: formNameEn, nameSw: formNameSw, slug,
      parentId: formParent || null, imageUrl: formImage || null,
      sizeGuideId: formSizeGuideId || null,
    };
    setSaving(true);
    try {
      if (editingId) {
        await adminApi.updateCategory(editingId, payload);
        toast.success('Category updated');
      } else {
        await adminApi.createCategory(payload);
        toast.success('Category created');
      }
      resetForm();
      fetchCategories();
    } catch { toast.error('Failed to save category'); }
    finally { setSaving(false); }
  };

  // Flatten top-level for parent dropdown
  const flatParents = categories.map((c) => ({ id: c.id, nameEn: c.name ?? c.nameEn ?? c.slug }));

  const inputClass = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';

  const renderCategory = (cat: Category, depth: number = 0) => {
    const children = cat.children || [];
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(cat.id);

    return (
      <div key={cat.id}>
        <div
          className="flex items-center gap-3 px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--accent))] transition-colors"
          style={{ paddingLeft: `${16 + depth * 24}px` }}
        >
          <button onClick={() => hasChildren && toggleExpand(cat.id)}
            className={cn('p-0.5 rounded transition-colors', hasChildren ? 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]' : 'text-transparent cursor-default')}>
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <div className="w-8 h-8 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center shrink-0">
            <FolderOpen className="w-4 h-4 text-brand-gold" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-[hsl(var(--foreground))] truncate">{cat.name ?? cat.nameEn ?? cat.slug}</p>
            {(cat.nameSwahili ?? cat.nameSw) && <p className="text-xs text-[hsl(var(--muted-foreground))]">{cat.nameSwahili ?? cat.nameSw}</p>}
          </div>
          <span className="hidden sm:inline text-xs text-[hsl(var(--muted-foreground))] font-mono bg-[hsl(var(--muted))] px-2 py-0.5 rounded">/{cat.slug}</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">{cat._count?.products ?? cat.productCount ?? 0} products</span>
          <div className="flex items-center gap-1">
            <button onClick={() => startEdit(cat)} className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-blue-600 transition-colors" title="Edit">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => handleDelete(cat)} className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors" title="Delete">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        {hasChildren && isExpanded && children.map((child) => renderCategory(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Categories</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Manage product categories and hierarchy</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> Add Category
        </Button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-brand-gold bg-[hsl(var(--card))] p-4 sm:p-5 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{editingId ? 'Edit Category' : 'New Category'}</h3>
            <button onClick={resetForm} className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">Name (English) *</label>
              <input type="text" value={formNameEn} onChange={(e) => setFormNameEn(e.target.value)} placeholder="e.g. Shoes" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">Name (Swahili)</label>
              <input type="text" value={formNameSw} onChange={(e) => setFormNameSw(e.target.value)} placeholder="e.g. Viatu" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">Slug</label>
              <input type="text" value={formSlug} onChange={(e) => setFormSlug(e.target.value)} placeholder="auto-generated" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">Parent Category</label>
              <select value={formParent} onChange={(e) => setFormParent(e.target.value)} className={inputClass}>
                <option value="">None (Top Level)</option>
                {flatParents.filter((p) => p.id !== editingId).map((p) => <option key={p.id} value={p.id}>{p.nameEn}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">Image URL</label>
              <input type="text" value={formImage} onChange={(e) => setFormImage(e.target.value)} placeholder="/uploads/categories/..." className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">Size Guide</label>
              <select value={formSizeGuideId} onChange={(e) => setFormSizeGuideId(e.target.value)} className={inputClass} title="Size Guide">
                <option value="">None</option>
                {sizeGuides.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:gap-3 pt-2">
            <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : editingId ? 'Update Category' : 'Save Category'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-gold" /></div>
      ) : categories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-12 text-center">
          <FolderOpen className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <h3 className="font-semibold text-[hsl(var(--card-foreground))]">No categories yet</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-4">Add your first category above</p>
          <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}><Plus className="w-4 h-4" /> Add Category</Button>
        </div>
      ) : (
        <div className="rounded-lg border border-[hsl(var(--border))] overflow-hidden">
          <div className="flex items-center px-4 py-2.5 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Category Tree</span>
          </div>
          {categories.map((cat) => renderCategory(cat))}
        </div>
      )}
    </div>
  );
}
