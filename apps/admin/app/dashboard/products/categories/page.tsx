'use client';

import { useState } from 'react';
import {
  Plus,
  ChevronRight,
  ChevronDown,
  Edit,
  Trash2,
  X,
  FolderOpen,
  ImageIcon,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface Category {
  id: string;
  nameEn: string;
  nameSw: string;
  slug: string;
  parentId: string | null;
  imageUrl: string;
  productCount: number;
  children: Category[];
}

const mockCategories: Category[] = [
  {
    id: 'cat-1',
    nameEn: 'Women',
    nameSw: 'Wanawake',
    slug: 'women',
    parentId: null,
    imageUrl: '/images/categories/women.jpg',
    productCount: 42,
    children: [
      {
        id: 'cat-1a',
        nameEn: 'Dresses',
        nameSw: 'Mavazi',
        slug: 'dresses',
        parentId: 'cat-1',
        imageUrl: '/images/categories/dresses.jpg',
        productCount: 18,
        children: [],
      },
      {
        id: 'cat-1b',
        nameEn: 'Gowns',
        nameSw: 'Gauni',
        slug: 'gowns',
        parentId: 'cat-1',
        imageUrl: '/images/categories/gowns.jpg',
        productCount: 12,
        children: [],
      },
    ],
  },
  {
    id: 'cat-2',
    nameEn: 'Men',
    nameSw: 'Wanaume',
    slug: 'men',
    parentId: null,
    imageUrl: '/images/categories/men.jpg',
    productCount: 35,
    children: [
      {
        id: 'cat-2a',
        nameEn: 'Shirts',
        nameSw: 'Mashati',
        slug: 'shirts',
        parentId: 'cat-2',
        imageUrl: '/images/categories/shirts.jpg',
        productCount: 20,
        children: [],
      },
      {
        id: 'cat-2b',
        nameEn: 'Suits',
        nameSw: 'Suti',
        slug: 'suits',
        parentId: 'cat-2',
        imageUrl: '/images/categories/suits.jpg',
        productCount: 8,
        children: [],
      },
    ],
  },
  {
    id: 'cat-3',
    nameEn: 'Accessories',
    nameSw: 'Vifaa',
    slug: 'accessories',
    parentId: null,
    imageUrl: '/images/categories/accessories.jpg',
    productCount: 23,
    children: [],
  },
];

const flatParentOptions = mockCategories.map((c) => ({ id: c.id, nameEn: c.nameEn }));

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>(mockCategories);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['cat-1', 'cat-2']));
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formNameEn, setFormNameEn] = useState('');
  const [formNameSw, setFormNameSw] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formParent, setFormParent] = useState('');
  const [formImage, setFormImage] = useState('');

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const resetForm = () => {
    setFormNameEn('');
    setFormNameSw('');
    setFormSlug('');
    setFormParent('');
    setFormImage('');
    setShowForm(false);
    setEditingId(null);
  };

  const startEdit = (cat: Category) => {
    setFormNameEn(cat.nameEn);
    setFormNameSw(cat.nameSw);
    setFormSlug(cat.slug);
    setFormParent(cat.parentId || '');
    setFormImage(cat.imageUrl);
    setEditingId(cat.id);
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    const removeById = (list: Category[]): Category[] =>
      list
        .filter((c) => c.id !== id)
        .map((c) => ({ ...c, children: removeById(c.children) }));
    setCategories(removeById(categories));
  };

  const handleSave = () => {
    if (!formNameEn.trim()) return;
    const slug = formSlug || formNameEn.toLowerCase().replace(/\s+/g, '-');
    const newCat: Category = {
      id: editingId || `cat-${Date.now()}`,
      nameEn: formNameEn,
      nameSw: formNameSw,
      slug,
      parentId: formParent || null,
      imageUrl: formImage || '/images/categories/default.jpg',
      productCount: 0,
      children: [],
    };

    if (editingId) {
      const updateById = (list: Category[]): Category[] =>
        list.map((c) => {
          if (c.id === editingId) return { ...c, ...newCat, children: c.children, productCount: c.productCount };
          return { ...c, children: updateById(c.children) };
        });
      setCategories(updateById(categories));
    } else if (formParent) {
      setCategories(
        categories.map((c) =>
          c.id === formParent ? { ...c, children: [...c.children, newCat] } : c
        )
      );
      setExpanded(new Set([...expanded, formParent]));
    } else {
      setCategories([...categories, newCat]);
    }
    resetForm();
  };

  const inputClass =
    'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';

  const renderCategory = (cat: Category, depth: number = 0) => {
    const hasChildren = cat.children.length > 0;
    const isExpanded = expanded.has(cat.id);

    return (
      <div key={cat.id}>
        <div
          className={cn(
            'flex items-center gap-3 px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--accent))] transition-colors',
          )}
          style={{ paddingLeft: `${16 + depth * 24}px` }}
        >
          {/* Expand toggle */}
          <button
            onClick={() => hasChildren && toggleExpand(cat.id)}
            className={cn(
              'p-0.5 rounded transition-colors',
              hasChildren
                ? 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                : 'text-transparent cursor-default'
            )}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>

          {/* Icon */}
          <div className="w-8 h-8 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center flex-shrink-0">
            <FolderOpen className="w-4 h-4 text-brand-gold" />
          </div>

          {/* Name */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-[hsl(var(--foreground))] truncate">
              {cat.nameEn}
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{cat.nameSw}</p>
          </div>

          {/* Slug */}
          <span className="hidden sm:inline text-xs text-[hsl(var(--muted-foreground))] font-mono bg-[hsl(var(--muted))] px-2 py-0.5 rounded">
            /{cat.slug}
          </span>

          {/* Product count */}
          <span className="text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
            {cat.productCount} products
          </span>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => startEdit(cat)}
              className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-blue-600 transition-colors"
              title="Edit"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDelete(cat.id)}
              className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && cat.children.map((child) => renderCategory(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Categories</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Manage product categories and hierarchy
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
        >
          <Plus className="w-4 h-4" />
          Add Category
        </Button>
      </div>

      {/* Inline Form */}
      {showForm && (
        <div className="rounded-lg border border-brand-gold bg-[hsl(var(--card))] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
              {editingId ? 'Edit Category' : 'New Category'}
            </h3>
            <button
              onClick={resetForm}
              className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">
                Name (English) *
              </label>
              <input
                type="text"
                value={formNameEn}
                onChange={(e) => setFormNameEn(e.target.value)}
                placeholder="e.g. Shoes"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">
                Name (Swahili)
              </label>
              <input
                type="text"
                value={formNameSw}
                onChange={(e) => setFormNameSw(e.target.value)}
                placeholder="e.g. Viatu"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">
                Slug
              </label>
              <input
                type="text"
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value)}
                placeholder="auto-generated"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">
                Parent Category
              </label>
              <select
                value={formParent}
                onChange={(e) => setFormParent(e.target.value)}
                className={inputClass}
              >
                <option value="">None (Top Level)</option>
                {flatParentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground))] mb-1">
                Image URL
              </label>
              <input
                type="text"
                value={formImage}
                onChange={(e) => setFormImage(e.target.value)}
                placeholder="/images/categories/..."
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button size="sm" onClick={handleSave}>
              {editingId ? 'Update' : 'Save'} Category
            </Button>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Category Tree */}
      <div className="rounded-lg border border-[hsl(var(--border))] overflow-hidden">
        {/* Header row */}
        <div className="flex items-center px-4 py-2.5 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
          <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
            Category Tree
          </span>
        </div>
        {categories.map((cat) => renderCategory(cat))}
        {categories.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
            No categories yet. Add your first category above.
          </div>
        )}
      </div>
    </div>
  );
}
