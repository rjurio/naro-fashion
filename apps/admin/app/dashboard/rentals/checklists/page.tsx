'use client';

import { useState, useEffect } from 'react';
import { Plus, ClipboardList, CheckCircle2, Edit2, Trash2, Loader2, X, GripVertical, Power } from 'lucide-react';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';

interface ChecklistItem {
  id: string;
  label: string;
  labelSwahili?: string;
  itemType: string;
  sortOrder: number;
}

interface ChecklistTemplate {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  isActive: boolean;
  items: ChecklistItem[];
  createdAt: string;
  usageCount?: number;
}

interface FormItem {
  label: string;
  labelSwahili: string;
}

interface TemplateForm {
  name: string;
  description: string;
  type: 'DISPATCH' | 'RETURN';
  isDefault: boolean;
  items: FormItem[];
}

const emptyForm: TemplateForm = {
  name: '',
  description: '',
  type: 'DISPATCH',
  isDefault: false,
  items: [{ label: '', labelSwahili: '' }],
};

export default function ChecklistsPage() {
  const [checklists, setChecklists] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<'ALL' | 'DISPATCH' | 'RETURN'>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>({ ...emptyForm, items: [{ label: '', labelSwahili: '' }] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

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
    if (!confirm('Are you sure you want to delete this checklist template?')) return;
    try {
      await adminApi.deleteChecklistTemplate(id);
      setChecklists((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error('Failed to delete checklist:', err);
    }
  };

  const handleToggleActive = async (id: string) => {
    try {
      const updated = await adminApi.toggleChecklistTemplate(id);
      setChecklists((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      console.error('Failed to toggle template:', err);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, items: [{ label: '', labelSwahili: '' }] });
    setShowModal(true);
  };

  const openEdit = (template: ChecklistTemplate) => {
    setEditingId(template.id);
    setForm({
      name: template.name,
      description: template.description || '',
      type: (template.items?.[0]?.itemType as 'DISPATCH' | 'RETURN') || 'DISPATCH',
      isDefault: template.isDefault,
      items: (template.items || []).length > 0
        ? template.items.map((i) => ({ label: i.label, labelSwahili: i.labelSwahili || '' }))
        : [{ label: '', labelSwahili: '' }],
    });
    setShowModal(true);
  };

  const addItem = () => {
    setForm((f) => ({ ...f, items: [...f.items, { label: '', labelSwahili: '' }] }));
  };

  const removeItem = (index: number) => {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  };

  const updateItem = (index: number, field: keyof FormItem, value: string) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return alert('Template name is required');
    const validItems = form.items.filter((i) => i.label.trim());
    if (validItems.length === 0) return alert('Add at least one checklist item');

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        isDefault: form.isDefault,
        items: validItems.map((item, index) => ({
          label: item.label.trim(),
          labelSwahili: item.labelSwahili.trim() || undefined,
          itemType: form.type,
          sortOrder: index,
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
      alert('Failed to save template. Please try again.');
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
            Manage dispatch and return checklists for rental items
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
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleActive(checklist.id); }}
                      title={checklist.isActive ? 'Deactivate' : 'Activate'}
                      className={`p-2 rounded-lg transition-colors ${
                        checklist.isActive
                          ? 'hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-600'
                      }`}
                    >
                      <Power className="w-4 h-4" />
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
                              <span className="text-sm text-[hsl(var(--foreground))]">{item.label}</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[hsl(var(--card))] rounded-2xl shadow-xl border border-[hsl(var(--border))] mx-4">
            {/* Modal Header */}
            <div className="sticky top-0 flex items-center justify-between p-6 pb-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] rounded-t-2xl z-10">
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
            <div className="p-6 space-y-5">
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

              {/* Type & Default */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
                    Type <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    {(['DISPATCH', 'RETURN'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, type: t }))}
                        className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                          form.type === t
                            ? t === 'DISPATCH'
                              ? 'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-400'
                              : 'bg-purple-100 border-purple-300 text-purple-800 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-400'
                            : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]'
                        }`}
                      >
                        {t === 'DISPATCH' ? 'Dispatch' : 'Return'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isDefault}
                      onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                      className="w-4 h-4 rounded border-[hsl(var(--border))] text-brand-gold focus:ring-brand-gold"
                    />
                    <span className="text-sm text-[hsl(var(--foreground))]">Set as default</span>
                  </label>
                </div>
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
                <button
                  type="button"
                  onClick={() => {
                    const count = parseInt(prompt('How many items to add?') || '0', 10);
                    if (count > 0 && count <= 20) {
                      setForm((f) => ({
                        ...f,
                        items: [...f.items, ...Array.from({ length: count }, () => ({ label: '', labelSwahili: '' }))],
                      }));
                    }
                  }}
                  className="mt-3 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] underline"
                >
                  Add multiple items at once
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 flex items-center justify-between p-6 pt-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] rounded-b-2xl">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {form.items.filter((i) => i.label.trim()).length} item(s) will be saved
              </p>
              <div className="flex gap-3">
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
    </div>
  );
}
