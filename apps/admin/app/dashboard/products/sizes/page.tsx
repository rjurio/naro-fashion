'use client';

import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Power, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import adminApi from '@/lib/api';

interface ProductSize {
  id: string;
  name: string;
  description?: string;
  category?: string;
  sortOrder: number;
  isActive: boolean;
}

const emptyForm = {
  name: '',
  description: '',
  category: '',
  sortOrder: 0,
  isActive: true,
};

export default function ProductSizesPage() {
  const { toast: showToast } = useToast();
  const confirm = useConfirm();
  const [sizes, setSizes] = useState<ProductSize[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ProductSize | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await adminApi.getProductSizes();
      setSizes(Array.isArray(data) ? data : []);
    } catch {
      setSizes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (s: ProductSize) => {
    setEditing(s);
    setForm({
      name: s.name,
      description: s.description || '',
      category: s.category || '',
      sortOrder: s.sortOrder ?? 0,
      isActive: s.isActive,
    });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast('Name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        category: form.category.trim() || undefined,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
      };
      if (editing) {
        await adminApi.updateProductSize(editing.id, payload);
        showToast('Size updated', 'success');
      } else {
        await adminApi.createProductSize(payload);
        showToast('Size created', 'success');
      }
      setShowModal(false);
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (s: ProductSize) => {
    setTogglingId(s.id);
    try {
      await adminApi.toggleProductSize(s.id);
      showToast(`${s.name} ${s.isActive ? 'deactivated' : 'activated'}`, 'success');
      await load();
    } catch {
      showToast('Failed to toggle', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (s: ProductSize) => {
    const ok = await confirm({
      title: `Delete "${s.name}"?`,
      message: 'This will hide the size from product variant pickers. You can restore it from the Recycle Bin.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await adminApi.deleteProductSize(s.id);
      showToast('Size deleted', 'success');
      await load();
    } catch {
      showToast('Failed to delete', 'error');
    }
  };

  const inputClass =
    'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all';

  return (
    <div className="p-4 sm:p-5 md:p-6 space-y-6">
      <PageHeader
        title="Product Sizes"
        subtitle="Manage the size options available for product variants (clothing, shoes, rings, etc.)"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Products', href: '/dashboard/products' },
          { label: 'Sizes' },
        ]}
        actions={
          <button
            type="button"
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-gold text-white text-sm font-medium hover:bg-brand-gold-dark hover:shadow-md transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4" /> Add Size
          </button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : sizes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground mb-4">No product sizes configured yet.</p>
          <button
            type="button"
            onClick={openNew}
            className="px-4 py-2 rounded-lg bg-brand-gold text-white text-sm font-medium hover:bg-brand-gold-dark hover:shadow-md transition-all cursor-pointer"
          >
            Add First Size
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Category</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Sort Order</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sizes.map((s) => (
                <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-semibold text-foreground">{s.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.description ? s.description : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {s.category ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground border border-border">
                        {s.category}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.sortOrder}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.isActive
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        type="button"
                        onClick={() => handleToggle(s)}
                        disabled={togglingId === s.id}
                        title={s.isActive ? 'Deactivate' : 'Activate'}
                        className={`p-1.5 rounded transition-colors ${
                          s.isActive
                            ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                            : 'text-muted-foreground hover:bg-muted'
                        } disabled:opacity-50`}
                      >
                        {togglingId === s.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Power className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(s)}
                        title="Edit"
                        className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(s)}
                        title="Delete"
                        className="p-1.5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Size' : 'Add Size'}
        size="md"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Name *" hint='Short label, e.g. "S", "M", "42"'>
              <input
                required
                maxLength={20}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={inputClass}
                placeholder="M"
              />
            </FormField>
            <FormField label="Category" hint='Optional grouping, e.g. "clothing", "shoe", "ring"'>
              <input
                maxLength={40}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className={inputClass}
                placeholder="clothing"
              />
            </FormField>
          </div>

          <FormField label="Description" hint='Optional helper text shown to admins, e.g. "Small / 36 EU"'>
            <input
              maxLength={100}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={inputClass}
              placeholder="Small / 36 EU"
            />
          </FormField>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Sort Order" hint="Lower = shown first in dropdowns">
              <input
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
                className={inputClass}
                placeholder="0"
                title="Sort order — lower numbers appear first"
              />
            </FormField>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-sm text-foreground">Active (selectable in product variants)</span>
              </label>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:border-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand-gold text-white text-sm font-medium hover:bg-brand-gold-dark hover:shadow-md disabled:opacity-50 transition-all cursor-pointer"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Size'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
