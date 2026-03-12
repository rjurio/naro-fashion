'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import adminApi from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import ImageUploader from './ImageUploader';
import InfoLabel from '@/components/ui/InfoLabel';

interface VariantRow {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  colorHex: string;
  price: number;
  stock: number;
}

export interface ProductFormData {
  name: string;
  nameSwahili: string;
  slug: string;
  description: string;
  descriptionSwahili: string;
  price: number;
  compareAtPrice: number | null;
  categoryId: string;
  sku: string;
  availabilityMode: string;
  isFeatured: boolean;
  rentalPricePerDay: number | null;
  rentalDepositAmount: number | null;
  minRentalDays: number | null;
  maxRentalDays: number | null;
  bufferDaysOverride: number | null;
  images: string[];
  variants: VariantRow[];
  published: boolean;
}

interface Props {
  initialData?: any;
  onSubmit: (data: ProductFormData) => Promise<void>;
  submitLabel: string;
}

const emptyVariant = (): VariantRow => ({
  name: '', sku: '', barcode: '', size: '', color: '', colorHex: '', price: 0, stock: 0,
});

export default function ProductForm({ initialData, onSubmit, submitLabel }: Props) {
  const { toast } = useToast();
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showRental, setShowRental] = useState(false);
  const [showVariants, setShowVariants] = useState(true);

  // Form state
  const [name, setName] = useState('');
  const [nameSwahili, setNameSwahili] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionSwahili, setDescriptionSwahili] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [compareAtPrice, setCompareAtPrice] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [sku, setSku] = useState('');
  const [availabilityMode, setAvailabilityMode] = useState('PURCHASE_ONLY');
  const [isFeatured, setIsFeatured] = useState(false);
  const [rentalPricePerDay, setRentalPricePerDay] = useState<number | null>(null);
  const [rentalDepositAmount, setRentalDepositAmount] = useState<number | null>(null);
  const [minRentalDays, setMinRentalDays] = useState<number | null>(null);
  const [maxRentalDays, setMaxRentalDays] = useState<number | null>(null);
  const [bufferDaysOverride, setBufferDaysOverride] = useState<number | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariant()]);

  // Load categories
  useEffect(() => {
    adminApi.getCategories().then((cats) => {
      setCategories(Array.isArray(cats) ? cats : []);
    }).catch(() => {});
  }, []);

  // Populate from initialData
  useEffect(() => {
    if (!initialData) return;
    setName(initialData.name || '');
    setNameSwahili(initialData.nameSwahili || '');
    setSlug(initialData.slug || '');
    setDescription(initialData.description || '');
    setDescriptionSwahili(initialData.descriptionSwahili || '');
    setPrice(Number(initialData.basePrice) || 0);
    setCompareAtPrice(initialData.compareAtPrice ? Number(initialData.compareAtPrice) : null);
    setCategoryId(initialData.categoryId || '');
    setSku(initialData.sku || '');
    setAvailabilityMode(initialData.availabilityMode || 'PURCHASE_ONLY');
    setIsFeatured(initialData.isFeatured || false);
    setRentalPricePerDay(initialData.rentalPricePerDay ? Number(initialData.rentalPricePerDay) : null);
    setRentalDepositAmount(initialData.rentalDepositAmount ? Number(initialData.rentalDepositAmount) : null);
    setMinRentalDays(initialData.minRentalDays || null);
    setMaxRentalDays(initialData.maxRentalDays || null);
    setBufferDaysOverride(initialData.bufferDaysOverride ?? null);

    if (initialData.images?.length) {
      setImages(initialData.images.map((img: any) => typeof img === 'string' ? img : img.url));
    }
    if (initialData.variants?.length) {
      setVariants(initialData.variants.map((v: any) => ({
        id: v.id,
        name: v.name || '',
        sku: v.sku || '',
        barcode: v.barcode || '',
        size: v.size || '',
        color: v.color || '',
        colorHex: v.colorHex || '',
        price: Number(v.price) || 0,
        stock: v.stock || 0,
      })));
    }

    const mode = initialData.availabilityMode || '';
    if (mode === 'RENTAL_ONLY' || mode === 'BOTH') setShowRental(true);
  }, [initialData]);

  // Auto-generate slug from name
  useEffect(() => {
    if (name) {
      setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
  }, [name]);

  // Auto-generate SKU: category prefix (3 chars) + name prefix (3 chars) + random 3 digits
  useEffect(() => {
    if (!initialData && name && categoryId) {
      const cat = categories.find((c) => c.id === categoryId);
      const catPrefix = (cat?.name || 'GEN').substring(0, 3).toUpperCase();
      const namePrefix = name.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
      const num = String(Math.floor(Math.random() * 900) + 100);
      setSku(`${catPrefix}-${namePrefix}-${num}`);
    }
  }, [name, categoryId, categories, initialData]);

  // Toggle rental section based on availability
  useEffect(() => {
    setShowRental(availabilityMode === 'RENTAL_ONLY' || availabilityMode === 'BOTH');
  }, [availabilityMode]);

  const updateVariant = (index: number, field: keyof VariantRow, value: any) => {
    setVariants((prev) => prev.map((v, i) => i === index ? { ...v, [field]: value } : v));
  };

  const addVariant = () => setVariants((prev) => [...prev, emptyVariant()]);

  const removeVariant = (index: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (asDraft: boolean) => {
    if (!name.trim()) { toast('Product name is required', 'error'); return; }
    if (!categoryId) { toast('Category is required', 'error'); return; }
    if (price <= 0) { toast('Price must be greater than 0', 'error'); return; }

    const validVariants = variants.filter((v) => v.name.trim());

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        nameSwahili: nameSwahili.trim(),
        slug: slug.trim(),
        description: description.trim(),
        descriptionSwahili: descriptionSwahili.trim(),
        price,
        compareAtPrice,
        categoryId,
        sku: sku.trim(),
        availabilityMode,
        isFeatured,
        rentalPricePerDay: showRental ? rentalPricePerDay : null,
        rentalDepositAmount: showRental ? rentalDepositAmount : null,
        minRentalDays: showRental ? minRentalDays : null,
        maxRentalDays: showRental ? maxRentalDays : null,
        bufferDaysOverride: showRental ? bufferDaysOverride : null,
        images,
        variants: validVariants,
        published: !asDraft,
      });
    } catch (err: any) {
      toast(err.message || 'Failed to save product', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold';

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Basic Info */}
      <section className="bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Basic Information</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <InfoLabel label="Product Name (English)" tooltip="The main product name displayed to customers on the storefront." required />
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Elegant Evening Gown" />
          </div>
          <div>
            <InfoLabel label="Product Name (Swahili)" tooltip="Swahili translation of the product name, shown when customers switch to Swahili language." />
            <input value={nameSwahili} onChange={(e) => setNameSwahili(e.target.value)} className={inputCls} placeholder="Jina la bidhaa..." />
          </div>
        </div>
        <div>
          <InfoLabel label="URL Slug" tooltip="The URL-friendly version of the product name used in the web address (e.g. /products/elegant-evening-gown). Auto-generated from the English name." />
          <input value={slug} readOnly className={`${inputCls} bg-[hsl(var(--muted))] cursor-not-allowed`} placeholder="Auto-generated from name" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <InfoLabel label="Description (English)" tooltip="Detailed product description shown on the product page. Include materials, features, and care instructions." />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} placeholder="Product description..." />
          </div>
          <div>
            <InfoLabel label="Description (Swahili)" tooltip="Swahili translation of the product description for customers using the Swahili language option." />
            <textarea value={descriptionSwahili} onChange={(e) => setDescriptionSwahili(e.target.value)} rows={3} className={inputCls} placeholder="Maelezo ya bidhaa..." />
          </div>
        </div>
      </section>

      {/* Pricing & Organization */}
      <section className="bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Pricing & Organization</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <InfoLabel label="Base Price (TZS)" tooltip="The selling price of this product in Tanzanian Shillings. This is the price customers will pay." required />
            <input type="number" min={0} value={price || ''} onChange={(e) => setPrice(Number(e.target.value))} className={inputCls} />
          </div>
          <div>
            <InfoLabel label="Compare-at Price (TZS)" tooltip="The original or higher price shown with a strikethrough to indicate a discount. Leave empty if there is no discount." />
            <input type="number" min={0} value={compareAtPrice ?? ''} onChange={(e) => setCompareAtPrice(e.target.value ? Number(e.target.value) : null)} className={inputCls} />
          </div>
          <div>
            <InfoLabel label="SKU (Stock Keeping Unit)" tooltip="Auto-generated as CATEGORY-NAME-NUMBER (e.g. GOW-ELE-427). You can edit it manually if needed. Must be unique across all products." />
            <input value={sku} onChange={(e) => setSku(e.target.value)} className={inputCls} placeholder="Auto-generated" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <InfoLabel label="Category" tooltip="The product category this item belongs to (e.g. Gowns, Suits, Accessories). Helps customers find products." required />
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
              <option value="">Select category...</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div>
            <InfoLabel label="Availability" tooltip="Controls how customers can acquire this product: purchase only, rental only, or both options." />
            <select value={availabilityMode} onChange={(e) => setAvailabilityMode(e.target.value)} className={inputCls}>
              <option value="PURCHASE_ONLY">Purchase Only</option>
              <option value="RENTAL_ONLY">Rental Only</option>
              <option value="BOTH">Purchase & Rental</option>
            </select>
          </div>
          <div>
            <InfoLabel label="Featured" tooltip="Featured products are highlighted on the storefront homepage in special carousels and promotional sections, giving them priority visibility over regular products." />
            <label className="flex items-center gap-2 cursor-pointer mt-1.5">
              <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} className="rounded accent-brand-gold" />
              <span className="text-sm text-[hsl(var(--foreground))]">Mark as Featured</span>
            </label>
          </div>
        </div>
      </section>

      {/* Rental Settings */}
      {showRental && (
        <section className="bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))] p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Rental Settings</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <InfoLabel label="Price per Day (TZS)" tooltip="The daily rental fee charged to the customer for borrowing this product." />
              <input type="number" min={0} value={rentalPricePerDay ?? ''} onChange={(e) => setRentalPricePerDay(e.target.value ? Number(e.target.value) : null)} className={inputCls} />
            </div>
            <div>
              <InfoLabel label="Deposit Amount (TZS)" tooltip="Refundable security deposit collected before the rental begins (typically 25% of product value)." />
              <input type="number" min={0} value={rentalDepositAmount ?? ''} onChange={(e) => setRentalDepositAmount(e.target.value ? Number(e.target.value) : null)} className={inputCls} />
            </div>
            <div>
              <InfoLabel label="Buffer Days Override" tooltip="Number of days blocked between rentals for cleaning and inspection. Overrides the global rental policy buffer (default 7 days)." />
              <input type="number" min={0} value={bufferDaysOverride ?? ''} onChange={(e) => setBufferDaysOverride(e.target.value ? Number(e.target.value) : null)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <InfoLabel label="Min Rental Days" tooltip="The minimum number of days a customer must rent this product." />
              <input type="number" min={1} value={minRentalDays ?? ''} onChange={(e) => setMinRentalDays(e.target.value ? Number(e.target.value) : null)} className={inputCls} />
            </div>
            <div>
              <InfoLabel label="Max Rental Days" tooltip="The maximum number of days a customer can rent this product in a single booking." />
              <input type="number" min={1} value={maxRentalDays ?? ''} onChange={(e) => setMaxRentalDays(e.target.value ? Number(e.target.value) : null)} className={inputCls} />
            </div>
          </div>
        </section>
      )}

      {/* Images */}
      <section className="bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Product Images</h3>
        <ImageUploader images={images} onChange={setImages} />
      </section>

      {/* Variants */}
      <section className="bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
            Variants ({variants.length})
          </h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={addVariant} className="flex items-center gap-1 text-xs text-brand-gold hover:underline">
              <Plus className="w-3.5 h-3.5" /> Add Variant
            </button>
            <button type="button" onClick={() => setShowVariants(!showVariants)} className="text-[hsl(var(--muted-foreground))]">
              {showVariants ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {showVariants && variants.map((v, i) => (
          <div key={i} className="p-3 rounded-lg border border-[hsl(var(--border))] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Variant {i + 1}</span>
              {variants.length > 1 && (
                <button type="button" onClick={() => removeVariant(i)} className="text-red-500 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <InfoLabel label="Name" tooltip="A descriptive name for this variant, e.g. 'Red / Large' or 'Size M - Black'." required />
                <input value={v.name} onChange={(e) => updateVariant(i, 'name', e.target.value)} className={inputCls} placeholder="e.g. Red / Large" />
              </div>
              <div>
                <InfoLabel label="SKU (Stock Keeping Unit)" tooltip="Unique inventory code for this specific variant. Used for tracking stock of each size/color combination." />
                <input value={v.sku} onChange={(e) => updateVariant(i, 'sku', e.target.value)} className={inputCls} placeholder="Auto-generated" />
              </div>
              <div>
                <InfoLabel label="Barcode" tooltip="Barcode number for this variant (e.g. EAN-13 or UPC). Used for scanning at POS and printing barcode labels." />
                <input value={v.barcode} onChange={(e) => updateVariant(i, 'barcode', e.target.value)} className={inputCls} placeholder="Optional" />
              </div>
              <div>
                <InfoLabel label="Price (TZS)" tooltip="Selling price for this specific variant. Can differ from the base price (e.g. larger sizes may cost more)." required />
                <input type="number" min={0} value={v.price || ''} onChange={(e) => updateVariant(i, 'price', Number(e.target.value))} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <InfoLabel label="Size" tooltip="Size of this variant (e.g. S, M, L, XL, or numeric sizes like 38, 40, 42)." />
                <input value={v.size} onChange={(e) => updateVariant(i, 'size', e.target.value)} className={inputCls} placeholder="S, M, L, XL" />
              </div>
              <div>
                <InfoLabel label="Color" tooltip="Color name for this variant (e.g. Red, Navy Blue, Ivory). Displayed to customers on the storefront." />
                <input value={v.color} onChange={(e) => updateVariant(i, 'color', e.target.value)} className={inputCls} placeholder="Red" />
              </div>
              <div>
                <InfoLabel label="Color Hex Code" tooltip="The hex color code (e.g. #FF0000 for red) used to display a color swatch on the storefront." />
                <div className="flex gap-1.5">
                  <input type="color" value={v.colorHex || '#000000'} onChange={(e) => updateVariant(i, 'colorHex', e.target.value)} className="w-9 h-9 rounded border border-[hsl(var(--border))] cursor-pointer" />
                  <input value={v.colorHex} onChange={(e) => updateVariant(i, 'colorHex', e.target.value)} className={inputCls} placeholder="#FF0000" />
                </div>
              </div>
              <div>
                <InfoLabel label="Stock" tooltip="Number of units available in inventory for this variant. Updated automatically when orders are placed." />
                <input type="number" min={0} value={v.stock || ''} onChange={(e) => updateVariant(i, 'stock', Number(e.target.value))} className={inputCls} />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pb-8">
        <button
          type="button"
          onClick={() => window.history.back()}
          disabled={submitting}
          className="px-5 py-2.5 rounded-lg border border-[hsl(var(--border))] text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => handleSubmit(true)}
          disabled={submitting}
          className="px-5 py-2.5 rounded-lg border border-amber-500 text-sm text-amber-500 hover:bg-amber-500/10 disabled:opacity-50"
        >
          {submitting ? 'Saving...' : 'Save as Draft'}
        </button>
        <button
          type="button"
          onClick={() => handleSubmit(false)}
          disabled={submitting}
          className="px-5 py-2.5 rounded-lg bg-brand-gold text-black text-sm font-medium hover:bg-brand-gold/90 disabled:opacity-50"
        >
          {submitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </div>
  );
}
