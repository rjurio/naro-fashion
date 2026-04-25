'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, Eye, EyeOff,
  Loader2, X, Layers, Sparkles, MousePointer2, ZoomIn,
  ArrowDownUp, ArrowLeftRight, FlipVertical, Lock, ImageIcon,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import PresetImageUploadField from '@/components/ui/PresetImageUploadField';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { adminApi } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const API_ORIGIN = API_URL.replace('/api/v1', '');

const SECTION_KEYS = [
  { key: 'HERO_AMBIENT', label: 'Hero Backdrop' },
  { key: 'CATEGORIES', label: 'Shop by Category' },
  { key: 'NEW_ARRIVALS', label: 'New Arrivals' },
  { key: 'RENTAL', label: 'Rental Showcase' },
  { key: 'WEDDINGS', label: 'Real Weddings' },
  { key: 'INSTAGRAM', label: 'Instagram Feed' },
  { key: 'FOOTER_BAND', label: 'Footer Band' },
] as const;

const EFFECT_TYPES = [
  { key: 'TRANSLATE_VERTICAL', label: 'Translate Vertical', icon: ArrowDownUp, description: 'Backdrop drifts up slower than content' },
  { key: 'TRANSLATE_HORIZONTAL', label: 'Translate Horizontal', icon: ArrowLeftRight, description: 'Pans sideways as you scroll vertically' },
  { key: 'FIXED', label: 'Fixed', icon: Lock, description: 'Image stays locked while content scrolls past' },
  { key: 'ZOOM_ON_SCROLL', label: 'Zoom on Scroll', icon: ZoomIn, description: 'Scales up as section enters viewport' },
  { key: 'MIRROR', label: 'Mirror', icon: FlipVertical, description: 'Moves opposite direction of scroll' },
  { key: 'MOUSE_TILT', label: 'Mouse Tilt', icon: MousePointer2, description: 'Shifts a few pixels with cursor (no scroll)' },
  { key: 'STATIC', label: 'Static', icon: ImageIcon, description: 'Background image with no animation' },
] as const;

type SectionKey = (typeof SECTION_KEYS)[number]['key'];
type EffectType = (typeof EFFECT_TYPES)[number]['key'];

interface ParallaxSection {
  id: string;
  sectionKey: SectionKey;
  title?: string | null;
  imageUrl: string;
  effectType: EffectType;
  scrollSpeed: number;
  overlayOpacity: number;
  overlayColor: string;
  blurPx: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

const DEFAULT_FORM = {
  sectionKey: '' as SectionKey | '',
  title: '',
  imageUrl: null as string | null,
  effectType: 'TRANSLATE_VERTICAL' as EffectType,
  scrollSpeed: 0.35,
  overlayOpacity: 0.45,
  overlayColor: '#000000',
  blurPx: 0,
  isActive: true,
  sortOrder: 0,
};

function resolveUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

export default function ParallaxSectionsPage() {
  const [sections, setSections] = useState<ParallaxSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [saving, setSaving] = useState(false);

  const toast = useToast();
  const confirm = useConfirm();

  const fetchSections = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getParallaxSections();
      setSections(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load parallax sections');
      setSections([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchSections(); }, [fetchSections]);

  const configuredKeys = new Set(sections.map((s) => s.sectionKey));
  const availableKeys = SECTION_KEYS.filter((k) => !configuredKeys.has(k.key));

  const openCreate = (preselectKey?: SectionKey) => {
    setEditingId(null);
    setForm({
      ...DEFAULT_FORM,
      sectionKey: preselectKey || availableKeys[0]?.key || '',
    });
    setShowForm(true);
  };

  const openEdit = (s: ParallaxSection) => {
    setEditingId(s.id);
    setForm({
      sectionKey: s.sectionKey,
      title: s.title || '',
      imageUrl: s.imageUrl,
      effectType: s.effectType,
      scrollSpeed: s.scrollSpeed,
      overlayOpacity: s.overlayOpacity,
      overlayColor: s.overlayColor || '#000000',
      blurPx: s.blurPx,
      isActive: s.isActive,
      sortOrder: s.sortOrder,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...DEFAULT_FORM });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.sectionKey) {
      toast.error('Pick a section');
      return;
    }
    if (!form.imageUrl) {
      toast.error('Upload a backdrop image');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        sectionKey: form.sectionKey,
        imageUrl: form.imageUrl,
        title: form.title || undefined,
        effectType: form.effectType,
        scrollSpeed: form.scrollSpeed,
        overlayOpacity: form.overlayOpacity,
        overlayColor: form.overlayColor,
        blurPx: form.blurPx,
        isActive: form.isActive,
        sortOrder: form.sortOrder,
      };

      if (editingId) {
        const updated = await adminApi.updateParallaxSection(editingId, payload);
        setSections((prev) => prev.map((s) => (s.id === editingId ? { ...s, ...updated } : s)));
        toast.success('Parallax section updated');
      } else {
        const created = await adminApi.createParallaxSection(payload);
        setSections((prev) => [...prev, created]);
        toast.success('Parallax section created');
      }
      closeForm();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save parallax section');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (s: ParallaxSection) => {
    try {
      const updated = await adminApi.toggleParallaxSection(s.id);
      setSections((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...updated } : x)));
      toast.success(s.isActive ? 'Section deactivated' : 'Section activated');
    } catch {
      toast.error('Failed to toggle section');
    }
  };

  const handleDelete = async (s: ParallaxSection) => {
    const ok = await confirm({
      title: 'Delete Parallax Section',
      message: `Move "${s.title || s.sectionKey}" to recycle bin?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await adminApi.deleteParallaxSection(s.id);
      setSections((prev) => prev.filter((x) => x.id !== s.id));
      toast.success('Section moved to recycle bin');
    } catch {
      toast.error('Failed to delete section');
    }
  };

  const inputClass = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50';
  const labelClass = 'block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6 text-brand-gold" />
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Parallax Sections</h1>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 max-w-2xl">
            Upload background images that scroll behind each homepage section. Each section can have its own effect type, speed, overlay, and blur.
            Make sure <strong>Enable Parallax Scroll Effects</strong> is on at <a href="/dashboard/cms/settings" className="text-brand-gold underline">CMS Settings</a> for these to render.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => openCreate()} disabled={availableKeys.length === 0}>
          <Plus className="w-4 h-4" />
          {availableKeys.length === 0 ? 'All sections configured' : 'Add Section'}
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5 md:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))]">
              {editingId ? 'Edit Parallax Section' : 'Add Parallax Section'}
            </h2>
            <button
              type="button"
              onClick={closeForm}
              aria-label="Close form"
              className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left column: form fields */}
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Section *</label>
                <select
                  value={form.sectionKey}
                  onChange={(e) => setForm({ ...form, sectionKey: e.target.value as SectionKey })}
                  className={inputClass}
                  disabled={!!editingId}
                  aria-label="Section"
                >
                  <option value="">Pick a section...</option>
                  {SECTION_KEYS.map((s) => (
                    <option key={s.key} value={s.key} disabled={!editingId && configuredKeys.has(s.key)}>
                      {s.label}{!editingId && configuredKeys.has(s.key) ? ' (already configured)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>Title (optional admin label)</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g., Bridal Hero Spring 2026"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Backdrop Image *</label>
                <PresetImageUploadField
                  presetKey="parallaxBackdrop"
                  value={form.imageUrl}
                  onChange={(u) => setForm({ ...form, imageUrl: u })}
                />
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                  16:9 landscape, 1920×1080 recommended. Will be cropped to cover the section.
                </p>
              </div>

              <div>
                <label className={labelClass}>Effect Type *</label>
                <div className="grid grid-cols-2 gap-2">
                  {EFFECT_TYPES.map((effect) => {
                    const Icon = effect.icon;
                    const selected = form.effectType === effect.key;
                    return (
                      <button
                        type="button"
                        key={effect.key}
                        onClick={() => setForm({ ...form, effectType: effect.key })}
                        className={`text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                          selected
                            ? 'border-brand-gold bg-brand-gold/5'
                            : 'border-[hsl(var(--border))] hover:border-brand-gold/50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${selected ? 'text-brand-gold' : 'text-[hsl(var(--muted-foreground))]'}`} />
                          <span className={`text-sm font-medium ${selected ? 'text-brand-gold' : 'text-[hsl(var(--foreground))]'}`}>{effect.label}</span>
                        </div>
                        <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">{effect.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>
                    Scroll Speed: <span className="text-brand-gold">{form.scrollSpeed.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min="0.05"
                    max="0.8"
                    step="0.05"
                    value={form.scrollSpeed}
                    onChange={(e) => setForm({ ...form, scrollSpeed: Number(e.target.value) })}
                    className="w-full"
                    aria-label="Scroll speed"
                    disabled={!['TRANSLATE_VERTICAL', 'TRANSLATE_HORIZONTAL', 'MIRROR'].includes(form.effectType)}
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    Overlay Opacity: <span className="text-brand-gold">{form.overlayOpacity.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="0.9"
                    step="0.05"
                    value={form.overlayOpacity}
                    onChange={(e) => setForm({ ...form, overlayOpacity: Number(e.target.value) })}
                    className="w-full"
                    aria-label="Overlay opacity"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Overlay Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.overlayColor}
                      onChange={(e) => setForm({ ...form, overlayColor: e.target.value })}
                      className="h-9 w-12 rounded border border-[hsl(var(--border))] cursor-pointer"
                      aria-label="Overlay color"
                    />
                    <input
                      type="text"
                      value={form.overlayColor}
                      onChange={(e) => setForm({ ...form, overlayColor: e.target.value })}
                      placeholder="#000000"
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>
                    Blur: <span className="text-brand-gold">{form.blurPx}px</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="2"
                    value={form.blurPx}
                    onChange={(e) => setForm({ ...form, blurPx: Number(e.target.value) })}
                    className="w-full"
                    aria-label="Blur"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Sort Order</label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                    className={inputClass}
                    aria-label="Sort order"
                  />
                </div>
                <div>
                  <label className={labelClass}>Active</label>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                      className="rounded border-[hsl(var(--border))]"
                    />
                    <span className="text-sm text-[hsl(var(--foreground))]">Visible on storefront</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Right column: live preview */}
            <div>
              <label className={labelClass}>Live Preview</label>
              <ParallaxPreview form={form} />
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
                Preview shows your image with the chosen overlay, blur, and effect type.{' '}
                {form.effectType === 'MOUSE_TILT' && 'Move your cursor over the preview.'}
                {form.effectType.startsWith('TRANSLATE') && ' Scroll inside the preview.'}
                {form.effectType === 'MIRROR' && ' Scroll inside the preview.'}
                {form.effectType === 'ZOOM_ON_SCROLL' && ' Scroll inside the preview.'}
              </p>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:gap-3 mt-5">
            <Button variant="ghost" size="sm" onClick={closeForm} type="button">Cancel</Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : editingId ? 'Update Section' : 'Create Section'}
            </Button>
          </div>
        </form>
      )}

      {/* Sections grid: configured + placeholders */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : (
        <div className="grid gap-4">
          {SECTION_KEYS.map((sk) => {
            const section = sections.find((s) => s.sectionKey === sk.key);
            if (section) {
              const effect = EFFECT_TYPES.find((e) => e.key === section.effectType);
              const EffectIcon = effect?.icon || Sparkles;
              return (
                <div
                  key={sk.key}
                  className={`rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden transition-opacity ${
                    section.isActive ? 'border-[hsl(var(--border))]' : 'border-dashed border-[hsl(var(--border))] opacity-60'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row">
                    <div className="sm:w-72 h-44 sm:h-auto bg-[hsl(var(--muted))] shrink-0 relative">
                      <img
                        src={resolveUrl(section.imageUrl)}
                        alt={section.title || sk.label}
                        className="w-full h-full object-cover"
                      />
                      <div
                        className="absolute inset-0"
                        style={{
                          backgroundColor: section.overlayColor,
                          opacity: section.overlayOpacity,
                        }}
                      />
                    </div>
                    <div className="flex-1 p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-[hsl(var(--card-foreground))]">{sk.label}</h3>
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              section.isActive
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                            }`}>
                              {section.isActive ? 'Active' : 'Inactive'}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-brand-gold/10 text-brand-gold px-2 py-0.5 text-[10px] font-medium">
                              <EffectIcon className="w-3 h-3" />
                              {effect?.label || section.effectType}
                            </span>
                          </div>
                          {section.title && (
                            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">{section.title}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                            <span>Speed: {section.scrollSpeed.toFixed(2)}</span>
                            <span>Overlay: {Math.round(section.overlayOpacity * 100)}%</span>
                            <span>Blur: {section.blurPx}px</span>
                            <span>Order: #{section.sortOrder}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleActive(section)}
                            className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer"
                            title={section.isActive ? 'Deactivate' : 'Activate'}
                          >
                            {section.isActive ? <Eye className="w-4 h-4 text-emerald-600" /> : <EyeOff className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(section)}
                            className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors cursor-pointer"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(section)}
                            className="p-2 rounded-lg hover:bg-red-50 text-[hsl(var(--muted-foreground))] hover:text-red-600 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            // Not yet configured — placeholder card
            return (
              <div
                key={sk.key}
                className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="sm:w-72 h-32 sm:h-24 bg-gradient-to-br from-brand-gold/10 to-brand-gold/5 rounded-lg flex items-center justify-center">
                  <ImageIcon className="w-8 h-8 text-brand-gold/40" />
                </div>
                <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[hsl(var(--card-foreground))]">{sk.label}</h3>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                      Currently uses the default fallback. Upload an image to use a custom backdrop.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openCreate(sk.key)}>
                    <Plus className="w-4 h-4" /> Add Backdrop
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Live Preview component
// ============================================================

function ParallaxPreview({ form }: { form: typeof DEFAULT_FORM }) {
  const [scrollPct, setScrollPct] = useState(0);
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const max = el.scrollHeight - el.clientHeight;
    setScrollPct(max > 0 ? el.scrollTop / max : 0);
  };

  const handleMouse = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setMouseX(x);
    setMouseY(y);
  };

  const transformStyle = (() => {
    const speed = form.scrollSpeed;
    switch (form.effectType) {
      case 'TRANSLATE_VERTICAL':
        return `translate3d(0, ${scrollPct * 80 * speed}px, 0) scale(1.1)`;
      case 'TRANSLATE_HORIZONTAL':
        return `translate3d(${scrollPct * 80 * speed}px, 0, 0) scale(1.1)`;
      case 'MIRROR':
        return `translate3d(0, ${-scrollPct * 80 * speed}px, 0) scale(1.1)`;
      case 'ZOOM_ON_SCROLL':
        return `scale(${1 + scrollPct * 0.3})`;
      case 'MOUSE_TILT':
        return `translate3d(${mouseX * 16}px, ${mouseY * 16}px, 0) scale(1.05)`;
      case 'FIXED':
      case 'STATIC':
      default:
        return 'scale(1)';
    }
  })();

  if (!form.imageUrl) {
    return (
      <div className="aspect-video rounded-xl border border-dashed border-[hsl(var(--border))] flex items-center justify-center bg-[hsl(var(--muted))]/30">
        <div className="text-center">
          <ImageIcon className="w-10 h-10 mx-auto text-[hsl(var(--muted-foreground))] mb-2" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Upload an image to see the live preview</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative aspect-video rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-black"
      onScroll={handleScroll}
      onMouseMove={handleMouse}
      style={{ overflowY: form.effectType === 'MOUSE_TILT' ? 'hidden' : 'auto' }}
    >
      {/* Backdrop layer */}
      <div className="absolute inset-0">
        <img
          src={resolveUrl(form.imageUrl)}
          alt="Preview"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-150 ease-out"
          style={{
            transform: transformStyle,
            filter: form.blurPx > 0 ? `blur(${form.blurPx}px)` : undefined,
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: form.overlayColor,
            opacity: form.overlayOpacity,
          }}
        />
      </div>

      {/* Scroll filler so the preview has content to scroll over */}
      {form.effectType !== 'MOUSE_TILT' && (
        <div className="relative h-[200%] flex items-center justify-center text-white/80 text-sm font-medium pointer-events-none">
          <span className="px-4 py-2 rounded bg-black/50">Scroll inside this preview</span>
        </div>
      )}
      {form.effectType === 'MOUSE_TILT' && (
        <div className="relative h-full flex items-center justify-center text-white/80 text-sm font-medium pointer-events-none">
          <span className="px-4 py-2 rounded bg-black/50">Move your cursor here</span>
        </div>
      )}
    </div>
  );
}
