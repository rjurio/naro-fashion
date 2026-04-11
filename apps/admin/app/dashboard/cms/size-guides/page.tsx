'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Star, Power, Loader2, Ruler, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { adminApi } from '@/lib/api';

interface SizeGuide {
  id: string;
  name: string;
  nameSwahili?: string;
  slug: string;
  isDefault: boolean;
  isActive: boolean;
  pdfUrl?: string;
  pdfUrlSwahili?: string;
  createdAt: string;
  updatedAt: string;
  _count?: { products: number };
}

export default function SizeGuidesPage() {
  const [guides, setGuides] = useState<SizeGuide[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const fetchGuides = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getSizeGuides();
      setGuides(Array.isArray(data) ? data : []);
    } catch { toast.error('Failed to load size guides'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { fetchGuides(); }, [fetchGuides]);

  const handleDelete = async (g: SizeGuide) => {
    const ok = await confirm({ title: 'Delete Size Guide', message: `Move "${g.name}" to recycle bin?`, confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await adminApi.deleteSizeGuide(g.id);
      setGuides((prev) => prev.filter((x) => x.id !== g.id));
      toast.success('Size guide deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const handleSetDefault = async (g: SizeGuide) => {
    setTogglingId(g.id);
    try {
      await adminApi.setDefaultSizeGuide(g.id);
      setGuides((prev) => prev.map((x) => ({ ...x, isDefault: x.id === g.id })));
      toast.success(`"${g.name}" set as default`);
    } catch { toast.error('Failed to set default'); }
    finally { setTogglingId(null); }
  };

  const handleToggleActive = async (g: SizeGuide) => {
    setTogglingId(g.id);
    try {
      const updated = await adminApi.toggleSizeGuideActive(g.id);
      setGuides((prev) => prev.map((x) => (x.id === g.id ? { ...x, isActive: updated.isActive } : x)));
      toast.success(updated.isActive ? 'Activated' : 'Deactivated');
    } catch { toast.error('Failed to toggle'); }
    finally { setTogglingId(null); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
            <Ruler className="w-6 h-6 text-brand-gold" />
            Size Guides
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Create and manage size guides for your products</p>
        </div>
        <Link href="/dashboard/cms/size-guides/new">
          <Button><Plus className="w-4 h-4" /> New Size Guide</Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-gold" /></div>
      ) : guides.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-12 text-center">
          <Ruler className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <h3 className="font-semibold text-[hsl(var(--card-foreground))]">No size guides yet</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-4">Create your first size guide to help customers find their perfect fit</p>
          <Link href="/dashboard/cms/size-guides/new">
            <Button size="sm"><Plus className="w-4 h-4" /> Create Size Guide</Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {guides.map((guide) => (
            <div key={guide.id} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`p-2 rounded-lg shrink-0 ${guide.isDefault ? 'bg-brand-gold/10' : 'bg-[hsl(var(--muted))]'}`}>
                  <Ruler className={`w-5 h-5 ${guide.isDefault ? 'text-brand-gold' : 'text-[hsl(var(--muted-foreground))]'}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[hsl(var(--foreground))] truncate">{guide.name}</h3>
                    {guide.nameSwahili && <span className="text-xs text-[hsl(var(--muted-foreground))]">/ {guide.nameSwahili}</span>}
                    {guide.isDefault && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand-gold/10 text-brand-gold">
                        <Star className="w-3 h-3" /> Default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                    <span>{guide._count?.products ?? 0} products</span>
                    {guide.pdfUrl && <span>PDF (EN)</span>}
                    {guide.pdfUrlSwahili && <span>PDF (SW)</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleToggleActive(guide)}
                  disabled={togglingId === guide.id}
                  className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={guide.isActive ? 'Deactivate' : 'Activate'}
                >
                  {togglingId === guide.id ? <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> : <Power className={`w-4 h-4 ${guide.isActive ? 'text-emerald-600' : 'text-[hsl(var(--muted-foreground))]'}`} />}
                </button>
                {!guide.isDefault && (
                  <button
                    onClick={() => handleSetDefault(guide)}
                    disabled={togglingId === guide.id}
                    className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Set as default"
                  >
                    {togglingId === guide.id ? <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> : <Star className="w-4 h-4 text-[hsl(var(--muted-foreground))] hover:text-brand-gold" />}
                  </button>
                )}
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  guide.isActive ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                }`}>{guide.isActive ? 'Active' : 'Inactive'}</span>
                <Link href={`/dashboard/cms/size-guides/${guide.id}`}>
                  <Button variant="outline" size="sm"><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                </Link>
                <button onClick={() => handleDelete(guide)} className="p-2 rounded-lg hover:bg-red-50 text-[hsl(var(--muted-foreground))] hover:text-red-600 dark:hover:bg-red-900/20 transition-colors" title="Delete">
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
