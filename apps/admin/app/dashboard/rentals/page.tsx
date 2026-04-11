'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRef } from 'react';
import {
  Search, CalendarClock, AlertTriangle, ClipboardCheck, Loader2,
  ChevronDown, ChevronUp, CheckCircle2, Circle, ClipboardList, Plus,
  MapPin, Truck, Calendar, Clock, Upload, FileText, Package,
  ShieldCheck, CreditCard, Wallet, PackageCheck, Send, RotateCcw, Eye, Lock,
  ArrowRight,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

interface Rental {
  id: string;
  rentalNumber?: string;
  customer: string;
  item: string;
  startDate: string;
  endDate: string;
  total: string;
  deposit: string;
  status: string;
  idVerified: boolean;
  pickupTime?: string;
  weddingDate?: string;
  weddingLocation?: string;
  weddingRegion?: string;
  deliveryModality?: string;
  shippingDate?: string;
  shippingAddress?: string;
  transportMode?: string;
  transportReceiptUrl?: string;
  notes?: string;
  [key: string]: unknown;
}

interface ChecklistEntry {
  id: string;
  label: string;
  itemType: string;
  isChecked: boolean;
  checkedAt: string | null;
  checkedBy: { id: string; firstName: string; lastName: string } | null;
  notes: string | null;
  sortOrder: number;
}

interface Template {
  id: string;
  name: string;
  isActive: boolean;
  items: { itemType: string }[];
}

type TabKey = 'active' | 'requests' | 'overdue';

const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'active', label: 'Active Rentals', icon: CalendarClock },
  { key: 'requests', label: 'Requests', icon: ClipboardCheck },
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle },
];

const TRANSPORT_MODES = ['AIR', 'BUS', 'TRAIN', 'COURIER', 'OTHER'];
const REGIONS = [
  'Arusha', 'Dar es Salaam', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Katavi',
  'Kigoma', 'Kilimanjaro', 'Lindi', 'Manyara', 'Mara', 'Mbeya', 'Morogoro',
  'Mtwara', 'Mwanza', 'Njombe', 'Pemba North', 'Pemba South', 'Pwani',
  'Rukwa', 'Ruvuma', 'Shinyanga', 'Simiyu', 'Singida', 'Songwe', 'Tabora',
  'Tanga', 'Unguja North', 'Unguja South', 'Zanzibar Central/South',
];

function ChecklistSection({ rentalId }: { rentalId: string }) {
  const [entries, setEntries] = useState<ChecklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await adminApi.getRentalChecklist(rentalId);
        setEntries(Array.isArray(data) ? data : []);
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [rentalId]);

  const loadTemplates = async () => {
    if (templates.length > 0) { setShowAssign(true); return; }
    try {
      const data = await adminApi.getActiveChecklistTemplates();
      setTemplates(Array.isArray(data) ? data : []);
      setShowAssign(true);
    } catch { setTemplates([]); setShowAssign(true); }
  };

  const handleAssign = async (templateId: string) => {
    setAssigning(true);
    try {
      const newEntries = await adminApi.assignChecklist(rentalId, templateId);
      setEntries(Array.isArray(newEntries) ? newEntries : []);
      setShowAssign(false);
    } catch (err) {
      console.error('Failed to assign checklist:', err);
    } finally { setAssigning(false); }
  };

  const handleToggleItem = async (entry: ChecklistEntry) => {
    try {
      const updated = entry.isChecked
        ? await adminApi.uncheckItem(entry.id)
        : await adminApi.checkItem(entry.id);
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...updated } : e)));
    } catch (err) { console.error('Failed to toggle item:', err); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-brand-gold" /></div>;
  }

  const dispatchItems = entries.filter((e) => e.itemType === 'DISPATCH');
  const returnItems = entries.filter((e) => e.itemType === 'RETURN');

  const renderGroup = (title: string, items: ChecklistEntry[], color: string) => {
    if (items.length === 0) return null;
    const checked = items.filter((i) => i.isChecked).length;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className={`text-sm font-semibold ${color}`}>{title}</h4>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{checked}/{items.length} completed</span>
        </div>
        <div className="w-full bg-[hsl(var(--muted))] rounded-full h-1.5">
          <div className={`h-1.5 rounded-full transition-all ${title === 'Dispatch' ? 'bg-blue-500' : 'bg-purple-500'}`}
            style={{ width: `${items.length > 0 ? (checked / items.length) * 100 : 0}%` }} />
        </div>
        <ul className="space-y-1.5">
          {items.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 group">
              <button onClick={() => handleToggleItem(entry)} className="mt-0.5 flex-shrink-0">
                {entry.isChecked
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  : <Circle className="w-5 h-5 text-[hsl(var(--muted-foreground))] group-hover:text-brand-gold transition-colors" />}
              </button>
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${entry.isChecked ? 'line-through text-[hsl(var(--muted-foreground))]' : 'text-[hsl(var(--foreground))]'}`}>{entry.label}</span>
                {entry.isChecked && entry.checkedBy && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    by {entry.checkedBy.firstName} {entry.checkedBy.lastName}
                    {entry.checkedAt && ` · ${new Date(entry.checkedAt).toLocaleString()}`}
                  </p>
                )}
                {entry.notes && <p className="text-xs text-[hsl(var(--muted-foreground))] italic">{entry.notes}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <div className="text-center py-4">
          <ClipboardList className="w-8 h-8 mx-auto text-[hsl(var(--muted-foreground))] mb-2" />
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-3">No checklist assigned yet</p>
          <Button onClick={loadTemplates} className="text-sm"><Plus className="w-4 h-4" /> Assign Checklist Template</Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {renderGroup('Dispatch', dispatchItems, 'text-blue-600 dark:text-blue-400')}
            {renderGroup('Return', returnItems, 'text-purple-600 dark:text-purple-400')}
          </div>
          <div className="pt-2 border-t border-[hsl(var(--border))]">
            <button onClick={loadTemplates} className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] underline">
              Assign additional checklist template
            </button>
          </div>
        </>
      )}
      {showAssign && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">Select Active Template</h4>
            <button onClick={() => setShowAssign(false)} className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">Cancel</button>
          </div>
          {templates.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">No active templates available.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {templates.map((t) => {
                const dc = (t.items || []).filter((i) => i.itemType === 'DISPATCH').length;
                const rc = (t.items || []).filter((i) => i.itemType === 'RETURN').length;
                return (
                  <button key={t.id} onClick={() => handleAssign(t.id)} disabled={assigning}
                    className="flex items-center gap-3 p-3 rounded-lg border border-[hsl(var(--border))] hover:border-brand-gold hover:bg-brand-gold/5 transition-colors text-left">
                    <ClipboardList className="w-5 h-5 text-brand-gold flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[hsl(var(--foreground))] truncate">{t.name}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {dc > 0 && `${dc} dispatch`}{dc > 0 && rc > 0 && ' · '}{rc > 0 && `${rc} return`}{dc === 0 && rc === 0 && 'No items'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RentalDetailsSection({ rental, onUpdate }: { rental: Rental; onUpdate: (updated: Partial<Rental>) => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    pickupTime: rental.pickupTime || '',
    weddingDate: rental.weddingDate ? new Date(rental.weddingDate as string).toISOString().split('T')[0] : '',
    weddingLocation: rental.weddingLocation || '',
    weddingRegion: rental.weddingRegion || '',
    deliveryModality: rental.deliveryModality || '',
    shippingDate: rental.shippingDate ? new Date(rental.shippingDate as string).toISOString().split('T')[0] : '',
    shippingAddress: rental.shippingAddress || '',
    transportMode: rental.transportMode || '',
    notes: rental.notes || '',
  });
  const [uploading, setUploading] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: any = { ...form };
      if (data.weddingDate) data.weddingDate = new Date(data.weddingDate).toISOString();
      if (data.shippingDate) data.shippingDate = new Date(data.shippingDate).toISOString();
      // Remove empty strings
      Object.keys(data).forEach((k) => { if (data[k] === '') data[k] = undefined; });
      const updated = await adminApi.updateRental(rental.id, data);
      onUpdate(updated);
      setEditing(false);
    } catch (err) {
      console.error('Failed to update rental:', err);
    } finally { setSaving(false); }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const updated = await adminApi.uploadTransportReceipt(rental.id, file);
      onUpdate(updated);
    } catch (err) {
      console.error('Failed to upload receipt:', err);
    } finally { setUploading(false); }
  };

  const labelClass = 'text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide';
  const valueClass = 'text-sm text-[hsl(var(--foreground))]';
  const inputClass = 'w-full px-3 py-1.5 text-sm rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-brand-gold';

  if (!editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
            <Package className="w-4 h-4 text-brand-gold" /> Rental Details
          </h4>
          <button onClick={() => setEditing(true)} className="text-xs text-brand-gold hover:underline">Edit</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><p className={labelClass}>Pickup Time</p><p className={valueClass}>{rental.pickupTime || '—'}</p></div>
          <div><p className={labelClass}>Wedding Date</p><p className={valueClass}>{rental.weddingDate ? new Date(rental.weddingDate as string).toLocaleDateString() : '—'}</p></div>
          <div><p className={labelClass}>Location</p><p className={valueClass}>{rental.weddingLocation || '—'}</p></div>
          <div><p className={labelClass}>Region</p><p className={valueClass}>{rental.weddingRegion || '—'}</p></div>
          <div><p className={labelClass}>Delivery</p><p className={valueClass}>{rental.deliveryModality === 'SHIPPED' ? 'Shipped' : rental.deliveryModality === 'HAND_PICKED' ? 'Hand Picked' : '—'}</p></div>
          {rental.deliveryModality === 'SHIPPED' && (
            <>
              <div><p className={labelClass}>Shipping Date</p><p className={valueClass}>{rental.shippingDate ? new Date(rental.shippingDate as string).toLocaleDateString() : '—'}</p></div>
              <div><p className={labelClass}>Ship To</p><p className={valueClass}>{rental.shippingAddress || '—'}</p></div>
              <div><p className={labelClass}>Transport</p><p className={valueClass}>{rental.transportMode || '—'}</p></div>
            </>
          )}
        </div>
        {rental.transportReceiptUrl && (
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-brand-gold" />
            <a href={`${API_ORIGIN}${rental.transportReceiptUrl}`} target="_blank" rel="noreferrer"
              className="text-xs text-brand-gold hover:underline">View Transport Receipt</a>
          </div>
        )}
        {rental.notes && <div><p className={labelClass}>Notes</p><p className={`${valueClass} italic`}>{rental.notes}</p></div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
          <Package className="w-4 h-4 text-brand-gold" /> Edit Rental Details
        </h4>
        <div className="flex gap-2">
          <button onClick={() => setEditing(false)} className="text-xs text-[hsl(var(--muted-foreground))] hover:underline">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="text-xs text-brand-gold hover:underline font-medium">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>Pickup Time</label>
          <div className="relative mt-1">
            <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <input type="time" value={form.pickupTime} onChange={(e) => setForm({ ...form, pickupTime: e.target.value })} className={`${inputClass} pl-8`} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Wedding Date</label>
          <div className="relative mt-1">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <input type="date" value={form.weddingDate} onChange={(e) => setForm({ ...form, weddingDate: e.target.value })} className={`${inputClass} pl-8`} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Wedding Location</label>
          <div className="relative mt-1">
            <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
            <input type="text" value={form.weddingLocation} onChange={(e) => setForm({ ...form, weddingLocation: e.target.value })} placeholder="Venue name" className={`${inputClass} pl-8`} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Region</label>
          <select value={form.weddingRegion} onChange={(e) => setForm({ ...form, weddingRegion: e.target.value })} className={inputClass}>
            <option value="">Select region...</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Delivery Modality</label>
          <select value={form.deliveryModality} onChange={(e) => setForm({ ...form, deliveryModality: e.target.value })} className={inputClass}>
            <option value="">Select...</option>
            <option value="HAND_PICKED">Hand Picked</option>
            <option value="SHIPPED">Shipped</option>
          </select>
        </div>
        {form.deliveryModality === 'SHIPPED' && (
          <>
            <div>
              <label className={labelClass}>Shipping Date</label>
              <input type="date" value={form.shippingDate} onChange={(e) => setForm({ ...form, shippingDate: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Shipping Address</label>
              <input type="text" value={form.shippingAddress} onChange={(e) => setForm({ ...form, shippingAddress: e.target.value })} placeholder="Full address" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Transport Mode</label>
              <select value={form.transportMode} onChange={(e) => setForm({ ...form, transportMode: e.target.value })} className={inputClass}>
                <option value="">Select...</option>
                {TRANSPORT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Transport Receipt</label>
              <div className="mt-1 flex items-center gap-2">
                <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] cursor-pointer hover:border-brand-gold transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                  {uploading ? 'Uploading...' : 'Upload Receipt'}
                  <input type="file" accept="image/*,.pdf" onChange={handleReceiptUpload} className="hidden" disabled={uploading} />
                </label>
                {rental.transportReceiptUrl && (
                  <a href={`${API_ORIGIN}${rental.transportReceiptUrl}`} target="_blank" rel="noreferrer" className="text-xs text-brand-gold hover:underline">View</a>
                )}
              </div>
            </div>
          </>
        )}
        <div className="md:col-span-2 lg:col-span-3">
          <label className={labelClass}>Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Additional notes..." className={inputClass} />
        </div>
      </div>
    </div>
  );
}

const STATUS_META: Record<string, { icon: React.ElementType; color: string; bg: string; dot: string; label: string }> = {
  PENDING_ID_VERIFICATION: { icon: ShieldCheck, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', dot: 'bg-amber-500', label: 'Pending ID Verification' },
  ID_VERIFIED:             { icon: CheckCircle2, color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', dot: 'bg-blue-500', label: 'ID Verified' },
  DOWN_PAYMENT_PAID:       { icon: CreditCard, color: 'text-indigo-700 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20', dot: 'bg-indigo-500', label: 'Down Payment Paid' },
  FULLY_PAID:              { icon: Wallet, color: 'text-teal-700 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-900/20', dot: 'bg-teal-500', label: 'Fully Paid' },
  READY_FOR_PICKUP:        { icon: PackageCheck, color: 'text-cyan-700 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-900/20', dot: 'bg-cyan-500', label: 'Ready For Pickup' },
  ITEM_DISPATCHED:         { icon: Send, color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', dot: 'bg-orange-500', label: 'Item Dispatched' },
  ACTIVE:                  { icon: CalendarClock, color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', dot: 'bg-emerald-500', label: 'Active' },
  RETURNED:                { icon: RotateCcw, color: 'text-slate-700 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800/40', dot: 'bg-slate-500', label: 'Returned' },
  INSPECTION:              { icon: Eye, color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20', dot: 'bg-purple-500', label: 'Inspection' },
  CLOSED:                  { icon: Lock, color: 'text-gray-500 dark:text-gray-500', bg: 'bg-gray-100 dark:bg-gray-800/40', dot: 'bg-gray-400', label: 'Closed' },
};

const STATUS_WORKFLOW_ORDER = [
  'PENDING_ID_VERIFICATION', 'ID_VERIFIED', 'DOWN_PAYMENT_PAID', 'FULLY_PAID',
  'READY_FOR_PICKUP', 'ITEM_DISPATCHED', 'ACTIVE', 'RETURNED', 'INSPECTION', 'CLOSED',
];

function RentalStatusDropdown({ status, onStatusChange }: { status: string; onStatusChange: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const current = STATUS_META[status] || STATUS_META.CLOSED;
  const CurrentIcon = current.icon;
  const currentIdx = STATUS_WORKFLOW_ORDER.indexOf(status);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleSelect = async (s: string) => {
    if (s === status) { setOpen(false); return; }
    setUpdating(true);
    try {
      await onStatusChange(s);
    } finally {
      setUpdating(false);
      setOpen(false);
    }
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        disabled={updating}
        className={`inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full text-xs font-semibold border transition-all hover:shadow-md active:scale-[0.97] ${current.bg} ${current.color} border-current/20 disabled:opacity-60`}
      >
        {updating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CurrentIcon className="w-3.5 h-3.5" />}
        {current.label}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
          onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Update Status</p>
          </div>

          {/* Progress indicator */}
          <div className="px-3 py-2 border-b border-[hsl(var(--border))]">
            <div className="flex items-center gap-0.5">
              {STATUS_WORKFLOW_ORDER.map((s, i) => {
                const meta = STATUS_META[s];
                return (
                  <div key={s} className="flex-1 flex items-center">
                    <div className={`h-1.5 w-full rounded-full transition-colors ${i <= currentIdx ? meta.dot : 'bg-[hsl(var(--border))]'}`} />
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">Step {currentIdx + 1} of {STATUS_WORKFLOW_ORDER.length}</p>
          </div>

          {/* Options */}
          <div className="max-h-[320px] overflow-y-auto py-1">
            {STATUS_WORKFLOW_ORDER.map((s, i) => {
              const meta = STATUS_META[s];
              const Icon = meta.icon;
              const isActive = s === status;
              const isPast = i < currentIdx;
              const isDisabled = isPast || isActive;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => handleSelect(s)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors group
                    ${isActive
                      ? `${meta.bg} ${meta.color} font-semibold`
                      : isPast
                        ? 'opacity-40 cursor-not-allowed text-[hsl(var(--muted-foreground))]'
                        : 'hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]'
                    }
                  `}
                >
                  <div className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                    isActive ? meta.bg
                    : isPast ? 'bg-[hsl(var(--muted))]'
                    : 'bg-[hsl(var(--muted))] group-hover:bg-[hsl(var(--background))]'
                  }`}>
                    {isPast
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                      : <Icon className={`w-3.5 h-3.5 ${isActive ? meta.color : 'text-[hsl(var(--muted-foreground))]'}`} />
                    }
                  </div>
                  <span className={`flex-1 text-xs ${isActive ? 'font-semibold' : isPast ? 'line-through' : 'font-medium'}`}>{meta.label}</span>
                  {isActive && <span className={`w-2 h-2 rounded-full ${meta.dot} animate-pulse`} />}
                  {i === currentIdx + 1 && (
                    <span className="text-[10px] font-medium text-brand-gold opacity-60 group-hover:opacity-100 transition-opacity">Next</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RentalsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRentalId, setExpandedRentalId] = useState<string | null>(null);

  const fetchRentals = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getRentals();
      const list = Array.isArray(data) ? data : data?.data || data?.rentals || [];
      // Normalize API response to our Rental interface
      setRentals(list.map((r: any) => ({
        ...r,
        customer: r.customer || `${r.user?.firstName || ''} ${r.user?.lastName || ''}`.trim() || 'Unknown',
        item: r.item || r.product?.name || 'Unknown',
        startDate: r.startDate,
        endDate: r.endDate || r.returnDate,
        total: r.total || `TZS ${Number(r.totalRentalPrice || 0).toLocaleString()}`,
        deposit: r.deposit || `TZS ${Number(r.downPaymentAmount || 0).toLocaleString()}`,
        status: r.status || 'PENDING_ID_VERIFICATION',
        idVerified: r.idVerified ?? !['PENDING_ID_VERIFICATION'].includes(r.status),
      })));
    } catch (err) {
      console.error('Failed to fetch rentals:', err);
      setRentals([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);
    fetchRentals();
  }, [fetchRentals]);

  const handleStatusUpdate = async (rentalId: string, newStatus: string) => {
    try {
      await adminApi.updateRentalStatus(rentalId, newStatus);
      setRentals((prev) => prev.map((r) => (r.id === rentalId ? { ...r, status: newStatus } : r)));
    } catch (err) { console.error('Failed to update rental status:', err); }
  };

  const handleRentalUpdate = (rentalId: string, updated: Partial<Rental>) => {
    setRentals((prev) => prev.map((r) => (r.id === rentalId ? { ...r, ...updated } : r)));
  };

  const ACTIVE_STATUSES = ['DOWN_PAYMENT_PAID', 'FULLY_PAID', 'READY_FOR_PICKUP', 'ITEM_DISPATCHED', 'ACTIVE'];
  const REQUEST_STATUSES = ['PENDING_ID_VERIFICATION', 'ID_VERIFIED'];
  const OVERDUE_CHECK = (r: Rental) => r.status === 'ACTIVE' && new Date(r.endDate) < new Date();

  const filteredRentals = rentals.filter((r) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q ||
      (r.customer || '').toLowerCase().includes(q) ||
      (r.item || '').toLowerCase().includes(q) ||
      (r.id || '').toLowerCase().includes(q) ||
      (r.rentalNumber || '').toLowerCase().includes(q);

    if (activeTab === 'active') return matchesSearch && ACTIVE_STATUSES.includes(r.status) && !OVERDUE_CHECK(r);
    if (activeTab === 'requests') return matchesSearch && REQUEST_STATUSES.includes(r.status);
    if (activeTab === 'overdue') return matchesSearch && OVERDUE_CHECK(r);
    return matchesSearch;
  });

  const activeCounts = {
    active: rentals.filter((r) => ACTIVE_STATUSES.includes(r.status) && !OVERDUE_CHECK(r)).length,
    requests: rentals.filter((r) => REQUEST_STATUSES.includes(r.status)).length,
    overdue: rentals.filter((r) => OVERDUE_CHECK(r)).length,
  };


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Rentals</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
          Manage rental bookings, returns, and overdue items
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[hsl(var(--border))]">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-brand-gold text-brand-gold'
                : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border))]'
            }`}>
            <tab.icon className="w-4 h-4" />
            {tab.label}
            <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-medium ${
              activeTab === tab.key ? 'bg-brand-gold text-white'
                : tab.key === 'overdue' && activeCounts.overdue > 0 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
            }`}>{activeCounts[tab.key]}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-[hsl(var(--muted))] rounded-lg px-3 py-2 max-w-sm">
        <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
        <input type="text" placeholder="Search rentals..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-transparent border-none outline-none text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] w-full" />
      </div>

      {/* Rental Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-gold" /></div>
      ) : filteredRentals.length === 0 ? (
        <div className="text-center py-20">
          <CalendarClock className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <p className="text-[hsl(var(--muted-foreground))]">No rentals found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRentals.map((rental) => {
            const isOverdue = OVERDUE_CHECK(rental);
            return (
              <div key={rental.id} className={`rounded-xl border ${isOverdue ? 'border-red-300 dark:border-red-800' : 'border-[hsl(var(--border))]'} bg-[hsl(var(--card))] relative`}>
                <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-[hsl(var(--accent))] transition-colors"
                  onClick={() => setExpandedRentalId(expandedRentalId === rental.id ? null : rental.id)}>
                  <div className="flex items-center gap-4 flex-1 min-w-0 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">{rental.rentalNumber || rental.id}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">{rental.customer}</p>
                    </div>
                    <div className="hidden sm:block min-w-0">
                      <p className="text-sm text-[hsl(var(--foreground))] truncate">{rental.item}</p>
                    </div>
                    <div className="hidden md:block text-xs text-[hsl(var(--muted-foreground))]">
                      {new Date(rental.startDate).toLocaleDateString()} → {new Date(rental.endDate).toLocaleDateString()}
                    </div>
                    <div className="hidden lg:block text-sm font-medium text-[hsl(var(--foreground))]">{rental.total}</div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${rental.idVerified ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {rental.idVerified ? 'ID ✓' : 'ID ✗'}
                    </span>
                    {rental.deliveryModality && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        <Truck className="w-3 h-3" />
                        {rental.deliveryModality === 'SHIPPED' ? 'Ship' : 'Pickup'}
                      </span>
                    )}
                    <RentalStatusDropdown
                      status={rental.status}
                      onStatusChange={(newStatus) => handleStatusUpdate(rental.id, newStatus)}
                    />
                  </div>
                  <div className="ml-4 flex-shrink-0">
                    {expandedRentalId === rental.id ? <ChevronUp className="w-5 h-5 text-[hsl(var(--muted-foreground))]" /> : <ChevronDown className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />}
                  </div>
                </div>

                {expandedRentalId === rental.id && (
                  <div className="border-t border-[hsl(var(--border))] p-5 bg-[hsl(var(--muted))]/30 space-y-6 rounded-b-xl overflow-hidden">
                    {/* Rental Details */}
                    <RentalDetailsSection rental={rental} onUpdate={(updated) => handleRentalUpdate(rental.id, updated)} />

                    {/* Checklist */}
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <ClipboardList className="w-4 h-4 text-brand-gold" />
                        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Dispatch & Return Checklist</h3>
                      </div>
                      <ChecklistSection rentalId={rental.id} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
