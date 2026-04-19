'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Pencil, Trash2, Eye, EyeOff,
  Loader2, X, Upload, GripVertical,
} from 'lucide-react';
import Cropper, { ReactCropperElement } from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import Button from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { adminApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const API_ORIGIN = API_URL.replace('/api/v1', '');

// Pre-defined hero size: 1920×700 (wide hero banner)
const HERO_WIDTH = 1920;
const HERO_HEIGHT = 700;
const HERO_ASPECT = HERO_WIDTH / HERO_HEIGHT;

interface HeroSlide {
  id: string;
  title?: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export default function HeroSlidesPage() {
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [saving, setSaving] = useState(false);

  // Crop state
  const [showCrop, setShowCrop] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropImageUrl, setCropImageUrl] = useState('');
  const [quality, setQuality] = useState(85);
  const [uploading, setUploading] = useState(false);
  const cropperRef = useRef<ReactCropperElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // For editing existing — preview URL
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploadedUrl, setUploadedUrl] = useState('');

  const toast = useToast();
  const confirm = useConfirm();

  const fetchSlides = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getHeroSlides();
      setSlides(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load hero slides');
      setSlides([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchSlides(); }, [fetchSlides]);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setSortOrder(0);
    setPreviewUrl('');
    setUploadedUrl('');
    setCropFile(null);
    setCropImageUrl('');
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (s: HeroSlide) => {
    setEditingId(s.id);
    setTitle(s.title || '');
    setSortOrder(s.sortOrder);
    setPreviewUrl(s.imageUrl.startsWith('/uploads') ? `${API_ORIGIN}${s.imageUrl}` : s.imageUrl);
    setUploadedUrl(s.imageUrl);
    setShowForm(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Only JPEG, PNG, and WebP images are allowed');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be under 5MB');
      return;
    }
    setCropFile(file);
    setCropImageUrl(URL.createObjectURL(file));
    setShowCrop(true);
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCropAndUpload = async () => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper) return;

    const canvas = cropper.getCroppedCanvas({
      width: HERO_WIDTH,
      height: HERO_HEIGHT,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });

    canvas.toBlob(
      async (blob) => {
        if (!blob) return;
        setUploading(true);
        try {
          const file = new File([blob], cropFile?.name || 'hero-slide.jpg', { type: 'image/jpeg' });
          const result = await adminApi.uploadHeroSlide(file);
          setUploadedUrl(result.url);
          setPreviewUrl(`${API_ORIGIN}${result.url}`);
          setShowCrop(false);
          toast.success('Image uploaded');
        } catch {
          toast.error('Failed to upload image');
        } finally {
          setUploading(false);
        }
      },
      'image/jpeg',
      quality / 100,
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadedUrl && !editingId) {
      toast.error('Please upload an image first');
      return;
    }
    setSaving(true);
    try {
      const payload: any = { title: title || undefined, sortOrder };
      if (uploadedUrl) payload.imageUrl = uploadedUrl;

      if (editingId) {
        const updated = await adminApi.updateHeroSlide(editingId, payload);
        setSlides((prev) => prev.map((s) => (s.id === editingId ? { ...s, ...updated } : s)));
        toast.success('Hero slide updated');
      } else {
        const created = await adminApi.createHeroSlide(payload);
        setSlides((prev) => [...prev, created]);
        toast.success('Hero slide created');
      }
      setShowForm(false);
      resetForm();
    } catch {
      toast.error('Failed to save hero slide');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (s: HeroSlide) => {
    try {
      const updated = await adminApi.updateHeroSlide(s.id, { isActive: !s.isActive });
      setSlides((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...updated } : x)));
      toast.success(s.isActive ? 'Slide deactivated' : 'Slide activated');
    } catch {
      toast.error('Failed to toggle slide');
    }
  };

  const handleDelete = async (s: HeroSlide) => {
    const ok = await confirm({
      title: 'Delete Hero Slide',
      message: `Move "${s.title || 'Untitled'}" to recycle bin?`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await adminApi.deleteHeroSlide(s.id);
      setSlides((prev) => prev.filter((x) => x.id !== s.id));
      toast.success('Hero slide moved to recycle bin');
    } catch {
      toast.error('Failed to delete hero slide');
    }
  };

  const inputClass = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50';
  const labelClass = 'block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Hero Slides</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Manage homepage hero background images ({HERO_WIDTH}x{HERO_HEIGHT}px)
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="w-4 h-4" />
          Add Hero Slide
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5 md:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))]">
              {editingId ? 'Edit Hero Slide' : 'Add New Hero Slide'}
            </h2>
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Title (optional)</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Summer Fashion 2026" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Sort Order</label>
              <input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} className={inputClass} />
            </div>
          </div>

          {/* Image Upload */}
          <div className="mt-4">
            <label className={labelClass}>Hero Image *</label>
            <div className="relative">
              {previewUrl ? (
                <div className="relative rounded-lg overflow-hidden border border-[hsl(var(--border))]">
                  <img src={previewUrl} alt="Preview" className="w-full aspect-[1920/700] object-cover" />
                  <button
                    type="button"
                    onClick={() => { setPreviewUrl(''); setUploadedUrl(''); }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-3 py-12 rounded-lg border-2 border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 cursor-pointer hover:bg-[hsl(var(--muted))]/50 transition-colors">
                  <Upload className="w-10 h-10 text-[hsl(var(--muted-foreground))]" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-[hsl(var(--foreground))]">Click to upload hero image</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                      Image will be cropped to {HERO_WIDTH}x{HERO_HEIGHT}px. JPEG, PNG, WebP (max 5MB)
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              )}
              {previewUrl && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-2 text-sm text-brand-gold hover:underline"
                >
                  Replace image
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:gap-3 mt-5">
            <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); resetForm(); }} type="button">Cancel</Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : editingId ? 'Update Slide' : 'Create Slide'}
            </Button>
          </div>
        </form>
      )}

      {/* Crop Modal */}
      {showCrop && cropImageUrl && (
        <Modal isOpen title="Crop Hero Image" size="xl" onClose={() => setShowCrop(false)}>
          <div className="space-y-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Crop to {HERO_WIDTH}x{HERO_HEIGHT}px (wide hero banner). Drag to reposition.
            </p>
            <div className="max-h-[55vh] overflow-hidden rounded-lg bg-black">
              <Cropper
                ref={cropperRef}
                src={cropImageUrl}
                style={{ height: '55vh', width: '100%' }}
                aspectRatio={HERO_ASPECT}
                guides
                viewMode={1}
                dragMode="move"
                autoCropArea={0.95}
                background={false}
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                Quality: {quality}%
              </label>
              <input
                type="range" min={40} max={100} step={5}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="flex-1 h-1.5 accent-brand-gold"
              />
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
              <button
                onClick={() => setShowCrop(false)}
                className="px-4 py-2 text-sm rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]"
              >
                Cancel
              </button>
              <button
                onClick={handleCropAndUpload}
                disabled={uploading}
                className="px-4 py-2 text-sm rounded-lg bg-brand-gold text-black font-medium hover:bg-brand-gold/90 disabled:opacity-50 flex items-center gap-2 justify-center"
              >
                {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : 'Crop & Upload'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Slides List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : slides.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-12 text-center">
          <Upload className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <h3 className="font-semibold text-[hsl(var(--card-foreground))]">No hero slides yet</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-4">
            Upload background images for the homepage hero section
          </p>
          <Button size="sm" className="gap-1.5" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Add Hero Slide
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {slides.map((slide) => (
            <div
              key={slide.id}
              className={`rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden transition-opacity ${
                slide.isActive ? 'border-[hsl(var(--border))]' : 'border-dashed border-[hsl(var(--border))] opacity-60'
              }`}
            >
              <div className="flex flex-col sm:flex-row">
                {/* Image preview */}
                <div className="sm:w-80 h-36 sm:h-auto bg-[hsl(var(--muted))] shrink-0">
                  <img
                    src={slide.imageUrl.startsWith('/uploads') ? `${API_ORIGIN}${slide.imageUrl}` : slide.imageUrl}
                    alt={slide.title || 'Hero slide'}
                    className="w-full h-full object-cover"
                  />
                </div>
                {/* Details */}
                <div className="flex-1 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <button className="mt-1 cursor-grab text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                        <GripVertical className="w-4 h-4" />
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-[hsl(var(--card-foreground))]">
                            {slide.title || 'Untitled Slide'}
                          </h3>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            slide.isActive
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                          }`}>
                            {slide.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                          <span>Order: #{slide.sortOrder}</span>
                          <span>Size: {HERO_WIDTH}x{HERO_HEIGHT}px</span>
                          <span>Created: {formatDate(slide.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => toggleActive(slide)}
                        className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
                        title={slide.isActive ? 'Deactivate' : 'Activate'}>
                        {slide.isActive ? <Eye className="w-4 h-4 text-emerald-600" /> : <EyeOff className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />}
                      </button>
                      <button onClick={() => openEdit(slide)}
                        className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(slide)}
                        className="p-2 rounded-lg hover:bg-red-50 text-[hsl(var(--muted-foreground))] hover:text-red-600 dark:hover:bg-red-900/20 transition-colors" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
