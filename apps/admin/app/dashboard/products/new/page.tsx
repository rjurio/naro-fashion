'use client';

import { useState } from 'react';
import { ArrowLeft, Plus, Trash2, Upload, ImageIcon } from 'lucide-react';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';

type AvailabilityMode = 'PURCHASE_ONLY' | 'RENTAL_ONLY' | 'BOTH';

interface Variant {
  id: number;
  size: string;
  color: string;
  price: string;
  stock: string;
}

export default function NewProductPage() {
  const [nameEn, setNameEn] = useState('');
  const [nameSw, setNameSw] = useState('');
  const [slug, setSlug] = useState('');
  const [descEn, setDescEn] = useState('');
  const [descSw, setDescSw] = useState('');
  const [category, setCategory] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [comparePrice, setComparePrice] = useState('');
  const [sku, setSku] = useState('');
  const [availability, setAvailability] = useState<AvailabilityMode>('PURCHASE_ONLY');
  const [rentalPricePerDay, setRentalPricePerDay] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [minRentalDays, setMinRentalDays] = useState('1');
  const [maxRentalDays, setMaxRentalDays] = useState('14');
  const [bufferDays, setBufferDays] = useState('7');
  const [variants, setVariants] = useState<Variant[]>([]);
  const [nextVariantId, setNextVariantId] = useState(1);

  const isRentable = availability === 'RENTAL_ONLY' || availability === 'BOTH';

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  const handleNameChange = (value: string) => {
    setNameEn(value);
    setSlug(generateSlug(value));
  };

  const addVariant = () => {
    setVariants([...variants, { id: nextVariantId, size: '', color: '', price: '', stock: '' }]);
    setNextVariantId(nextVariantId + 1);
  };

  const updateVariant = (id: number, field: keyof Variant, value: string) => {
    setVariants(variants.map((v) => (v.id === id ? { ...v, [field]: value } : v)));
  };

  const removeVariant = (id: number) => {
    setVariants(variants.filter((v) => v.id !== id));
  };

  const inputClass =
    'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';

  const labelClass = 'block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5';

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => window.history.back()}
          className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Add New Product</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Create a new product listing
          </p>
        </div>
      </div>

      {/* Basic Information */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Basic Information</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Product Name (English) *</label>
            <input
              type="text"
              value={nameEn}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Elegant Silk Blouse"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Product Name (Swahili)</label>
            <input
              type="text"
              value={nameSw}
              onChange={(e) => setNameSw(e.target.value)}
              placeholder="e.g. Blauzi ya Hariri"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="auto-generated-from-name"
            className={inputClass}
          />
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
            Auto-generated from English name. Edit if needed.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Description (English)</label>
            <textarea
              value={descEn}
              onChange={(e) => setDescEn(e.target.value)}
              placeholder="Product description in English..."
              rows={4}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Description (Swahili)</label>
            <textarea
              value={descSw}
              onChange={(e) => setDescSw(e.target.value)}
              placeholder="Maelezo ya bidhaa kwa Kiswahili..."
              rows={4}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Pricing & Category */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Pricing & Category</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Category *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            >
              <option value="">Select category</option>
              <option value="women-dresses">Women - Dresses</option>
              <option value="women-gowns">Women - Gowns</option>
              <option value="men-shirts">Men - Shirts</option>
              <option value="men-suits">Men - Suits</option>
              <option value="accessories">Accessories</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Base Price (TZS) *</label>
            <input
              type="number"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              placeholder="85000"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Compare-at Price (TZS)</label>
            <input
              type="number"
              value={comparePrice}
              onChange={(e) => setComparePrice(e.target.value)}
              placeholder="120000"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>SKU</label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="NF-BLS-001"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Availability Mode *</label>
            <select
              value={availability}
              onChange={(e) => setAvailability(e.target.value as AvailabilityMode)}
              className={inputClass}
            >
              <option value="PURCHASE_ONLY">Purchase Only</option>
              <option value="RENTAL_ONLY">Rental Only</option>
              <option value="BOTH">Both (Purchase & Rental)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Rental Settings */}
      {isRentable && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-4">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
            Rental Settings
          </h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Configure rental-specific pricing and rules for this product.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Rental Price / Day (TZS) *</label>
              <input
                type="number"
                value={rentalPricePerDay}
                onChange={(e) => setRentalPricePerDay(e.target.value)}
                placeholder="50000"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Deposit Amount (TZS) *</label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="100000"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Buffer Days Override</label>
              <input
                type="number"
                value={bufferDays}
                onChange={(e) => setBufferDays(e.target.value)}
                placeholder="7"
                className={inputClass}
              />
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Default: 7 days</p>
            </div>
            <div>
              <label className={labelClass}>Min Rental Days</label>
              <input
                type="number"
                value={minRentalDays}
                onChange={(e) => setMinRentalDays(e.target.value)}
                placeholder="1"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Max Rental Days</label>
              <input
                type="number"
                value={maxRentalDays}
                onChange={(e) => setMaxRentalDays(e.target.value)}
                placeholder="14"
                className={inputClass}
              />
            </div>
          </div>
        </div>
      )}

      {/* Variants */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Variants</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Add size, color, and stock variations.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={addVariant} className="gap-1.5">
            <Plus className="w-4 h-4" />
            Add Variant
          </Button>
        </div>

        {variants.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[hsl(var(--border))] p-8 text-center">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No variants added yet. Click &quot;Add Variant&quot; to create size/color options.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Header row - hidden on mobile */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-3">
              <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Size</span>
              <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Color</span>
              <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                Price (TZS)
              </span>
              <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Stock</span>
              <span className="w-9" />
            </div>
            {variants.map((v) => (
              <div
                key={v.id}
                className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-3 items-center p-3 sm:p-0 rounded-lg sm:rounded-none border sm:border-0 border-[hsl(var(--border))] bg-[hsl(var(--muted))] sm:bg-transparent"
              >
                <input
                  type="text"
                  value={v.size}
                  onChange={(e) => updateVariant(v.id, 'size', e.target.value)}
                  placeholder="S, M, L..."
                  className={inputClass}
                />
                <input
                  type="text"
                  value={v.color}
                  onChange={(e) => updateVariant(v.id, 'color', e.target.value)}
                  placeholder="Pink, Black..."
                  className={inputClass}
                />
                <input
                  type="number"
                  value={v.price}
                  onChange={(e) => updateVariant(v.id, 'price', e.target.value)}
                  placeholder="85000"
                  className={inputClass}
                />
                <input
                  type="number"
                  value={v.stock}
                  onChange={(e) => updateVariant(v.id, 'stock', e.target.value)}
                  placeholder="10"
                  className={inputClass}
                />
                <button
                  onClick={() => removeVariant(v.id)}
                  className="p-2 rounded-lg hover:bg-red-100 text-red-500 hover:text-red-700 transition-colors col-span-2 sm:col-span-1 justify-self-end sm:justify-self-auto"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Images */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Images</h2>
        <div className="border-2 border-dashed border-[hsl(var(--border))] rounded-lg p-8 text-center hover:border-brand-gold transition-colors cursor-pointer">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
              <ImageIcon className="w-6 h-6 text-[hsl(var(--muted-foreground))]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                Click to upload or drag and drop
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                PNG, JPG, WEBP up to 5MB. Recommended: 1000x1000px
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Upload className="w-4 h-4" />
              Browse Files
            </Button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pb-8">
        <Button variant="ghost" size="md" onClick={() => window.history.back()}>
          Cancel
        </Button>
        <Button variant="outline" size="md">
          Save as Draft
        </Button>
        <Button size="md">Save Product</Button>
      </div>
    </div>
  );
}
