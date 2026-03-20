'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, Power, Image as ImageIcon, Loader2, GripVertical, Key, Code } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import adminApi from '@/lib/api';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

function resolveImg(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

interface PaymentMethod {
  id: string;
  name: string;
  code: string;
  description?: string;
  iconUrl?: string;
  isActive: boolean;
  sortOrder: number;
  integrationKey?: string;
  integrationParams?: Record<string, string>;
}

const emptyForm = {
  name: '', code: '', description: '', iconUrl: '', isActive: true, sortOrder: 0,
  integrationKey: '', integrationParams: '{}',
};

export default function PaymentMethodsPage() {
  const { toast: showToast } = useToast();
  const confirm = useConfirm();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [jsonError, setJsonError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const data = await adminApi.getPaymentMethods();
      setMethods(Array.isArray(data) ? data : []);
    } catch { setMethods([]); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setJsonError('');
    setShowModal(true);
  };

  const openEdit = (m: PaymentMethod) => {
    setEditing(m);
    setForm({
      name: m.name,
      code: m.code,
      description: m.description || '',
      iconUrl: m.iconUrl || '',
      isActive: m.isActive,
      sortOrder: m.sortOrder,
      integrationKey: m.integrationKey || '',
      integrationParams: m.integrationParams ? JSON.stringify(m.integrationParams, null, 2) : '{}',
    });
    setJsonError('');
    setShowModal(true);
  };

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIcon(true);
    try {
      const res = await adminApi.uploadPaymentIcon(file);
      setForm((f) => ({ ...f, iconUrl: res.url }));
      showToast('Icon uploaded', 'success');
    } catch { showToast('Upload failed', 'error'); } finally {
      setUploadingIcon(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    let params: Record<string, string> | undefined;
    if (form.integrationParams.trim() && form.integrationParams.trim() !== '{}') {
      try { params = JSON.parse(form.integrationParams); }
      catch { setJsonError('Invalid JSON in Integration Parameters'); return; }
    }
    setSaving(true);
    setJsonError('');
    try {
      const payload = {
        name: form.name,
        code: form.code.toUpperCase().replace(/\s+/g, '_'),
        description: form.description || undefined,
        iconUrl: form.iconUrl || undefined,
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder),
        integrationKey: form.integrationKey || undefined,
        integrationParams: params,
      };
      if (editing) {
        await adminApi.updatePaymentMethod(editing.id, payload);
        showToast('Payment method updated', 'success');
      } else {
        await adminApi.createPaymentMethod(payload);
        showToast('Payment method created', 'success');
      }
      setShowModal(false);
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Failed to save', 'error');
    } finally { setSaving(false); }
  };

  const handleToggle = async (m: PaymentMethod) => {
    setTogglingId(m.id);
    try {
      await adminApi.togglePaymentMethod(m.id);
      showToast(`${m.name} ${m.isActive ? 'deactivated' : 'activated'}`, 'success');
      await load();
    } catch { showToast('Failed to toggle', 'error'); } finally { setTogglingId(null); }
  };

  const handleDelete = async (m: PaymentMethod) => {
    const ok = await confirm({ title: `Delete "${m.name}"?`, message: 'This will remove it from the storefront. You can restore it from the Recycle Bin.', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await adminApi.deletePaymentMethod(m.id);
      showToast('Payment method deleted', 'success');
      await load();
    } catch { showToast('Failed to delete', 'error'); }
  };

  const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all';

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Payment Methods"
        subtitle="Manage accepted payment methods and their integration settings"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings' }, { label: 'Payment Methods' }]}
        actions={
          <button type="button" onClick={openNew} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="h-4 w-4" /> Add Method
          </button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : methods.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground mb-4">No payment methods configured yet.</p>
          <button type="button" onClick={openNew} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Add First Method</button>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-8" aria-label="Drag handle"></th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Icon</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Code</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Integration Key</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Sort</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {methods.map((m) => (
                <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground"><GripVertical className="h-4 w-4" /></td>
                  <td className="px-4 py-3">
                    {m.iconUrl ? (
                      <img src={resolveImg(m.iconUrl)} alt={m.name} className="w-12 h-8 object-contain rounded border border-border bg-muted" />
                    ) : (
                      <div className="w-12 h-8 rounded border border-dashed border-border bg-muted flex items-center justify-center">
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{m.name}</td>
                  <td className="px-4 py-3"><span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{m.code}</span></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs font-mono truncate max-w-[120px]">{m.integrationKey ? '••••' + m.integrationKey.slice(-4) : <span className="text-muted-foreground/40">—</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${m.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                      {m.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{m.sortOrder}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button type="button" onClick={() => handleToggle(m)} disabled={togglingId === m.id} title={m.isActive ? 'Deactivate' : 'Activate'}
                        className={`p-1.5 rounded transition-colors ${m.isActive ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'text-muted-foreground hover:bg-muted'}`}>
                        {togglingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                      </button>
                      <button type="button" onClick={() => openEdit(m)} title="Edit" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => handleDelete(m)} title="Delete" className="p-1.5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
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

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Payment Method' : 'Add Payment Method'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          {/* Icon upload */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-2">Icon</label>
            <div className="flex items-center gap-4">
              {form.iconUrl ? (
                <img src={resolveImg(form.iconUrl)} alt="icon" className="w-16 h-11 object-contain rounded-lg border border-border bg-muted" />
              ) : (
                <div className="w-16 h-11 rounded-lg border border-dashed border-border bg-muted flex items-center justify-center">
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadingIcon}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50">
                  {uploadingIcon ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {uploadingIcon ? 'Uploading...' : 'Upload Icon'}
                </button>
                {form.iconUrl && (
                  <button type="button" onClick={() => setForm((f) => ({ ...f, iconUrl: '' }))} className="text-xs text-red-500 hover:underline text-left">Remove</button>
                )}
                <p className="text-[10px] text-muted-foreground">JPEG, PNG, WebP or SVG. Max 2MB.</p>
              </div>
              <input ref={fileRef} type="file" accept="image/*" aria-label="Upload payment method icon" title="Upload payment method icon" className="hidden" onChange={handleIconUpload} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Name *" hint="Display name, e.g. M-Pesa">
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} placeholder="M-Pesa" />
            </FormField>
            <FormField label="Code *" hint="Unique code, e.g. MPESA (auto-uppercased)">
              <input required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} className={inputClass} placeholder="MPESA" />
            </FormField>
          </div>

          <FormField label="Description" hint="Optional note shown to customers">
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={inputClass} placeholder="Pay with M-Pesa mobile money" />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Integration Key" hint="Merchant ID, API key, or shortcode">
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input value={form.integrationKey} onChange={(e) => setForm((f) => ({ ...f, integrationKey: e.target.value }))} className={inputClass + ' pl-8'} placeholder="e.g. 174379" />
              </div>
            </FormField>
            <FormField label="Sort Order" hint="Lower = shown first">
              <input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))} className={inputClass} min={0} placeholder="0" title="Sort order — lower numbers appear first" />
            </FormField>
          </div>

          <FormField label="Integration Parameters (JSON)" hint={'Additional config e.g. {"consumerKey": "...", "passkey": "..."}'} error={jsonError}>
            <div className="relative">
              <Code className="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" />
              <textarea rows={4} value={form.integrationParams} onChange={(e) => { setForm((f) => ({ ...f, integrationParams: e.target.value })); setJsonError(''); }}
                className={inputClass + ' pl-8 font-mono text-xs resize-none'} placeholder='{"key": "value"}' />
            </div>
          </FormField>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4 rounded border-border accent-primary" />
            <span className="text-sm text-foreground">Active (visible to customers)</span>
          </label>

          <div className="flex gap-3 pt-2 border-t border-border">
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Method'}
            </button>
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
