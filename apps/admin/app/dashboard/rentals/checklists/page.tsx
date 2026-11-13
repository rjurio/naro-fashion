'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Plus, ClipboardList, CheckCircle2, Edit2, Trash2, Loader2, X, GripVertical, Power, ShieldCheck, Ban } from 'lucide-react';
import TemplateApprovalDialog from '@/components/rental-checklist/TemplateApprovalDialog';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';

interface ChecklistItem {
  id: string;
  label: string;
  labelSwahili?: string;
  itemType: string;
  sortOrder: number;
  quantity?: number;
  isMandatory?: boolean;
  requiresCondition?: boolean;
  instructions?: string | null;
}

interface ChecklistTemplate {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  isActive: boolean;
  items: ChecklistItem[];
  productId?: string | null;
  categoryId?: string | null;
  version?: number;
  /** Round 25F D: DRAFT | APPROVED | WITHDRAWN; only APPROVED (this version) is used for bookings. */
  approvalStatus?: string;
  approvedVersion?: number | null;
  contentHash?: string;
  createdAt: string;
  usageCount?: number;
}

interface FormItem {
  label: string;
  labelSwahili: string;
  /** DISPATCH = checked at hand-over AND return; RETURN = return only. */
  itemType: 'DISPATCH' | 'RETURN';
  quantity: string;
  isMandatory: boolean;
  requiresCondition: boolean;
  instructions: string;
}
const newItem = (): FormItem => ({ label: '', labelSwahili: '', itemType: 'DISPATCH', quantity: '1', isMandatory: true, requiresCondition: true, instructions: '' });

interface TemplateForm {
  name: string;
  description: string;
  type: 'DISPATCH' | 'RETURN';
  isDefault: boolean;
  items: FormItem[];
  /** R3: which bookings get this list (most specific wins: product → category → shop default). */
  scope: 'SHOP' | 'CATEGORY' | 'PRODUCT';
  productId: string;
  categoryId: string;
}

const emptyForm: TemplateForm = {
  name: '',
  description: '',
  type: 'DISPATCH',
  isDefault: false,
  items: [newItem()],
  scope: 'SHOP',
  productId: '',
  categoryId: '',
};

export default function ChecklistsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [checklists, setChecklists] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<'ALL' | 'DISPATCH' | 'RETURN'>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>({ ...emptyForm, items: [newItem()] });
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [approval, setApproval] = useState<{ template: ChecklistTemplate; mode: 'approve' | 'withdraw' } | null>(null);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  // Scope pickers (loaded once, when the editor opens).
  const loadScopeOptions = async () => {
    if (products.length || categories.length) return;
    try {
      const [p, c] = await Promise.all([adminApi.getProducts({ limit: '200' }), adminApi.getCategories()]);
      const list = (p?.data ?? p?.items ?? p ?? []) as any[];
      setProducts(list.filter((x) => x.availabilityMode !== 'PURCHASE_ONLY').map((x) => ({ id: x.id, name: x.name })));
      setCategories(((c ?? []) as any[]).flatMap((x) => [x, ...(x.children ?? [])]).map((x) => ({ id: x.id, name: x.name ?? x.nameEn })));
    } catch {
      /* pickers stay empty; shop-default templates still work */
    }
  };

  useEffect(() => {
    const fetchChecklists = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getChecklistTemplates();
        setChecklists(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to fetch checklists:', err);
        setChecklists([]);
      } finally {
        setLoading(false);
      }
    };
    fetchChecklists();
  }, []);

  const handleDelete = async (id: string) => {
    const ok = await confirm({ title: 'Delete Template', message: 'Move this checklist template to recycle bin?', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await adminApi.deleteChecklistTemplate(id);
      setChecklists((prev) => prev.filter((c) => c.id !== id));
      toast.success('Template deleted');
    } catch {
      toast.error('Failed to delete template');
    }
  };

  const handleToggleActive = async (id: string) => {
    setTogglingId(id);
    try {
      const updated = await adminApi.toggleChecklistTemplate(id);
      setChecklists((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      console.error('Failed to toggle template:', err);
    } finally {
      setTogglingId(null);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, items: [newItem()] });
    setShowModal(true);
    loadScopeOptions();
  };

  const openEdit = (template: ChecklistTemplate) => {
    setEditingId(template.id);
    setForm({
      name: template.name,
      description: template.description || '',
      type: (template.items?.[0]?.itemType as 'DISPATCH' | 'RETURN') || 'DISPATCH',
      isDefault: template.isDefault,
      items: (template.items || []).length > 0
        ? template.items.map((i) => ({
          label: i.label, labelSwahili: i.labelSwahili || '', itemType: (i.itemType === 'RETURN' ? 'RETURN' : 'DISPATCH') as FormItem['itemType'],
          quantity: String(i.quantity ?? 1), isMandatory: i.isMandatory !== false, requiresCondition: i.requiresCondition !== false, instructions: i.instructions || '',
        }))
        : [newItem()],
      scope: template.productId ? 'PRODUCT' : template.categoryId ? 'CATEGORY' : 'SHOP',
      productId: template.productId || '',
      categoryId: template.categoryId || '',
    });
    setShowModal(true);
    loadScopeOptions();
  };

  const addItem = () => {
    setForm((f) => ({ ...f, items: [...f.items, newItem()] }));
  };

  const removeItem = (index: number) => {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  };

  const updateItem = (index: number, field: keyof FormItem, value: string | boolean) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.warning('Template name is required'); return; }
    const validItems = form.items.filter((i) => i.label.trim());
    if (validItems.length === 0) { toast.warning('Add at least one checklist item'); return; }
    if (form.scope === 'PRODUCT' && !form.productId) { toast.warning('Choose the product'); return; }
    if (form.scope === 'CATEGORY' && !form.categoryId) { toast.warning('Choose the category'); return; }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        isDefault: form.scope === 'SHOP' ? form.isDefault : false,
        productId: form.scope === 'PRODUCT' ? form.productId : null,
        categoryId: form.scope === 'CATEGORY' ? form.categoryId : null,
        items: validItems.map((item, index) => ({
          label: item.label.trim(),
          labelSwahili: item.labelSwahili.trim() || undefined,
          itemType: item.itemType,
          sortOrder: index,
          quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
          isMandatory: item.isMandatory,
          requiresCondition: item.requiresCondition,
          instructions: item.instructions.trim() || undefined,
        })),
      };

      if (editingId) {
        const updated = await adminApi.updateChecklistTemplate(editingId, payload);
        setChecklists((prev) => prev.map((c) => (c.id === editingId ? updated : c)));
      } else {
        const created = await adminApi.createChecklistTemplate(payload);
        setChecklists((prev) => [...prev, created]);
      }
      setShowModal(false);
    } catch (err) {
      console.error('Failed to save checklist:', err);
      toast.error('Failed to save template. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = checklists.filter(
    (c) => {
      if (selectedType === 'ALL') return true;
      const templateType = (c.items || [])[0]?.itemType || '';
      return templateType === selectedType;
    }
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Checklist Templates</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            What staff must check when an item is handed over and when it comes back. Each booking keeps the list it was confirmed with; edits apply to bookings confirmed afterwards.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4" />
          New Template
        </Button>
      </div>

      {/* Type Filter */}
      <div className="flex gap-2">
        {(['ALL', 'DISPATCH', 'RETURN'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedType === type
                ? 'bg-brand-gold text-white'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]'
            }`}
          >
            {type === 'ALL' ? 'All' : type === 'DISPATCH' ? 'Dispatch' : 'Return'}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <ClipboardList className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <p className="text-[hsl(var(--muted-foreground))]">No checklist templates found</p>
          <Button className="mt-4" onClick={openCreate}>
            <Plus className="w-4 h-4" />
            Create First Template
          </Button>
        </div>
      ) : (
        /* Checklist Cards */
        <div className="space-y-4">
          {filtered.map((checklist) => {
            const type = (checklist.items || [])[0]?.itemType || 'DISPATCH';
            return (
              <div
                key={checklist.id}
                className={`rounded-xl border overflow-hidden ${
                  checklist.isActive
                    ? 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 opacity-60'
                }`}
              >
                {/* Card Header */}
                <div
                  className="flex items-center justify-between p-5 cursor-pointer hover:bg-[hsl(var(--accent))] transition-colors"
                  onClick={() => setExpandedId(expandedId === checklist.id ? null : checklist.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                      type === 'DISPATCH'
                        ? 'bg-blue-100 dark:bg-blue-900/30'
                        : 'bg-purple-100 dark:bg-purple-900/30'
                    }`}>
                      <ClipboardList className={`w-5 h-5 ${
                        type === 'DISPATCH'
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-purple-600 dark:text-purple-400'
                      }`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[hsl(var(--foreground))]">
                        {checklist.name}
                        {checklist.isDefault && (
                          <span className="ml-2 text-xs bg-brand-gold/20 text-brand-gold px-2 py-0.5 rounded-full">
                            Default
                          </span>
                        )}
                        {(() => {
                          const st = checklist.approvalStatus ?? 'DRAFT';
                          const cls = st === 'APPROVED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : st === 'WITHDRAWN' ? 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
                          const label = st === 'APPROVED' ? 'Approved' : st === 'WITHDRAWN' ? 'Withdrawn' : 'Draft — needs a second person';
                          return <span data-testid="template-status" className={`ml-2 text-xs px-2 py-0.5 rounded-full ${cls}`}>{label} · v{checklist.version ?? 1}</span>;
                        })()}
                        {!checklist.isActive && (
                          <span className="ml-2 text-xs bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full">
                            Inactive
                          </span>
                        )}
                      </h3>
                      <div className="flex items-center gap-3 mt-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          type === 'DISPATCH'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                        }`}>
                          {type}
                        </span>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          {(checklist.items || []).length} items
                        </span>
                        {checklist.description && (
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">
                            {checklist.description}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {checklist.approvalStatus !== 'APPROVED' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setApproval({ template: checklist, mode: 'approve' }); }}
                        title="Approve (second person)"
                        aria-label={`Approve ${checklist.name}`}
                        className="p-2 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
                      >
                        <ShieldCheck className="w-4 h-4" />
                      </button>
                    )}
                    {checklist.approvalStatus !== 'WITHDRAWN' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setApproval({ template: checklist, mode: 'withdraw' }); }}
                        title="Withdraw (stop using for new bookings)"
                        aria-label={`Withdraw ${checklist.name}`}
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-[hsl(var(--muted-foreground))]"
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleActive(checklist.id); }}
                      disabled={togglingId === checklist.id}
                      title={checklist.isActive ? 'Deactivate' : 'Activate'}
                      className={`p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        checklist.isActive
                          ? 'hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-600'
                      }`}
                    >
                      {togglingId === checklist.id ? <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> : <Power className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(checklist); }}
                      className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(checklist.id); }}
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded Items */}
                {expandedId === checklist.id && (
                  <div className="border-t border-[hsl(var(--border))] p-5 bg-[hsl(var(--muted))]/50">
                    {(checklist.items || []).length === 0 ? (
                      <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-4">
                        No items yet. Click edit to add checklist items.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {(checklist.items || []).map((item, idx) => (
                          <li key={item.id} className="flex items-start gap-3">
                            <span className="text-xs text-[hsl(var(--muted-foreground))] mt-1 w-5 text-right">{idx + 1}.</span>
                            <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                              <span className="text-sm text-[hsl(var(--foreground))]">{item.label}{(item.quantity ?? 1) > 1 ? ` × ${item.quantity}` : ''}</span>
                              {item.isMandatory === false && <span className="ml-2 text-xs rounded bg-[hsl(var(--muted))] px-1">optional</span>}
                              {item.itemType === 'RETURN' && <span className="ml-2 text-xs rounded bg-purple-100 dark:bg-purple-900/40 px-1">return only</span>}
                              {item.instructions && <p className="text-xs text-[hsl(var(--muted-foreground))]">{item.instructions}</p>}
                              {item.labelSwahili && (
                                <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))] italic">
                                  ({item.labelSwahili})
                                </span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[hsl(var(--card))] rounded-2xl shadow-xl border border-[hsl(var(--border))]">
            {/* Modal Header */}
            <div className="sticky top-0 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] rounded-t-2xl z-10">
              <h2 className="text-xl font-bold text-[hsl(var(--foreground))]">
                {editingId ? 'Edit Template' : 'New Checklist Template'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 space-y-5">
              {/* Template Name */}
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
                  Template Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Standard Gown Dispatch Checklist"
                  className="w-full px-4 py-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
                  Description
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of when to use this checklist"
                  className="w-full px-4 py-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold"
                />
              </div>

              {/* Applies to (R3): product → category → shop default */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-[hsl(var(--foreground))]">Applies to <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {([['SHOP', 'Shop default'], ['CATEGORY', 'A category'], ['PRODUCT', 'One product']] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setForm((f) => ({ ...f, scope: k }))}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border ${form.scope === k ? 'bg-brand-gold/15 border-brand-gold text-[hsl(var(--foreground))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'}`}>{l}</button>
                  ))}
                </div>
                {form.scope === 'PRODUCT' && (
                  <select aria-label="Product" value={form.productId} onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm">
                    <option value="">Choose a rental product…</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                {form.scope === 'CATEGORY' && (
                  <select aria-label="Category" value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm">
                    <option value="">Choose a category…</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                {form.scope === 'SHOP' && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                      className="w-4 h-4 rounded border-[hsl(var(--border))] text-brand-gold focus:ring-brand-gold" />
                    <span className="text-sm text-[hsl(var(--foreground))]">Use for every rental product without its own or its category&apos;s list</span>
                  </label>
                )}
                <p className="text-xs text-[hsl(var(--muted-foreground))]">A product with no list at all can&apos;t be handed over without an approved exception.</p>
              </div>

              {/* Checklist Items */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-[hsl(var(--foreground))]">
                    Checklist Items <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={addItem}
                    className="flex items-center gap-1 text-sm text-brand-gold hover:text-brand-gold/80 font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Add Item
                  </button>
                </div>

                <div className="space-y-3">
                  {form.items.map((item, index) => (
                    <div
                      key={index}
                      className="flex gap-3 items-start p-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]"
                    >
                      <div className="flex items-center pt-2.5 text-[hsl(var(--muted-foreground))]">
                        <GripVertical className="w-4 h-4" />
                        <span className="text-xs w-5 text-center">{index + 1}</span>
                      </div>
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={item.label}
                          onChange={(e) => updateItem(index, 'label', e.target.value)}
                          placeholder="Item description (English)"
                          className="w-full px-3 py-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold"
                        />
                        <input
                          type="text"
                          value={item.labelSwahili}
                          onChange={(e) => updateItem(index, 'labelSwahili', e.target.value)}
                          placeholder="Maelezo (Swahili) - optional"
                          className="w-full px-3 py-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold"
                        />
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <select aria-label={`Item ${index + 1} stage`} value={item.itemType} onChange={(e) => updateItem(index, 'itemType', e.target.value)}
                            className="px-2 py-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
                            <option value="DISPATCH">Hand-over and return</option>
                            <option value="RETURN">Return only</option>
                          </select>
                          <label className="flex items-center gap-1">Qty
                            <input aria-label={`Item ${index + 1} quantity`} type="number" min={1} value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                              className="w-14 px-2 py-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]" />
                          </label>
                          <label className="flex items-center gap-1"><input type="checkbox" checked={item.isMandatory} onChange={(e) => updateItem(index, 'isMandatory', e.target.checked)} /> Mandatory</label>
                          <label className="flex items-center gap-1"><input type="checkbox" checked={item.requiresCondition} onChange={(e) => updateItem(index, 'requiresCondition', e.target.checked)} /> Record condition</label>
                        </div>
                        <input
                          type="text"
                          aria-label={`Item ${index + 1} instructions`}
                          value={item.instructions}
                          onChange={(e) => updateItem(index, 'instructions', e.target.value)}
                          placeholder="What to check (optional), e.g. hem, zip, beading"
                          className="w-full px-3 py-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] text-xs"
                        />
                      </div>
                      {form.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="p-2 mt-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Bulk Add */}
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">Add</span>
                  <select
                    title="Number of items to add"
                    onChange={(e) => {
                      const count = parseInt(e.target.value, 10);
                      if (count > 0) {
                        setForm((f) => ({
                          ...f,
                          items: [...f.items, ...Array.from({ length: count }, () => (newItem()))],
                        }));
                      }
                      e.target.value = '';
                    }}
                    defaultValue=""
                    className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-brand-gold"
                  >
                    <option value="" disabled>select...</option>
                    {[2, 3, 5, 8, 10, 15, 20].map((n) => (
                      <option key={n} value={n}>{n} items</option>
                    ))}
                  </select>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">at once</span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] rounded-b-2xl">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {form.items.filter((i) => i.label.trim()).length} item(s) will be saved
              </p>
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg border border-[hsl(var(--border))] text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] transition-colors"
                >
                  Cancel
                </button>
                <Button onClick={handleSubmit} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    editingId ? 'Update Template' : 'Create Template'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {approval && (
        <TemplateApprovalDialog
          template={approval.template as any}
          mode={approval.mode}
          scopeLabel={approval.template.productId ? `product ${products.find((p) => p.id === approval.template.productId)?.name ?? approval.template.productId}` : approval.template.categoryId ? `category ${categories.find((c) => c.id === approval.template.categoryId)?.name ?? approval.template.categoryId}` : approval.template.isDefault ? 'shop default (every rental item)' : 'not assigned'}
          onClose={() => setApproval(null)}
          onDone={(updated) => {
            setChecklists((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            setApproval(null);
            toast.success(approval.mode === 'approve' ? 'Checklist approved' : 'Checklist withdrawn');
          }}
        />
      )}
    </div>
  );
}
