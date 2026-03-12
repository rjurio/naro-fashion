'use client';

import { Minus, Plus, Trash2, Percent, DollarSign } from 'lucide-react';

export interface CartItem {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  size: string | null;
  color: string | null;
  quantity: number;
  unitPrice: number;
  stock: number;
  imageUrl?: string;
  itemDiscount?: number;
}

interface Props {
  items: CartItem[];
  onUpdateQuantity: (variantId: string, quantity: number) => void;
  onRemoveItem: (variantId: string) => void;
  onUpdateItemDiscount: (variantId: string, discount: number) => void;
  discount: number;
  discountType: 'PERCENTAGE' | 'FIXED';
  onDiscountChange: (value: number) => void;
  onDiscountTypeChange: (type: 'PERCENTAGE' | 'FIXED') => void;
}

export default function PosCart({
  items,
  onUpdateQuantity,
  onRemoveItem,
  onUpdateItemDiscount,
  discount,
  discountType,
  onDiscountChange,
  onDiscountTypeChange,
}: Props) {
  const subtotal = items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity - (item.itemDiscount ?? 0),
    0,
  );

  const discountAmount =
    discountType === 'PERCENTAGE' ? subtotal * (discount / 100) : discount;

  const total = subtotal - discountAmount;

  return (
    <div className="flex flex-col h-full">
      {/* Cart Header */}
      <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
        <h3 className="font-semibold text-[hsl(var(--foreground))]">
          Cart ({items.length} {items.length === 1 ? 'item' : 'items'})
        </h3>
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto divide-y divide-[hsl(var(--border))]">
        {items.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No items in cart
            </p>
          </div>
        )}

        {items.map((item) => (
          <div key={item.variantId} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
                  {item.productName}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {item.size && item.color
                    ? `${item.size} / ${item.color}`
                    : item.variantName}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                  @ {item.unitPrice.toLocaleString()} TZS
                </p>
              </div>
              <button
                onClick={() => onRemoveItem(item.variantId)}
                className="p-1 text-red-500 hover:bg-red-500/10 rounded"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onUpdateQuantity(item.variantId, item.quantity - 1)}
                  disabled={item.quantity <= 1}
                  className="w-7 h-7 flex items-center justify-center rounded border border-[hsl(var(--border))] disabled:opacity-30 hover:bg-[hsl(var(--accent))]"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="w-8 text-center text-sm font-medium text-[hsl(var(--foreground))]">
                  {item.quantity}
                </span>
                <button
                  onClick={() => onUpdateQuantity(item.variantId, item.quantity + 1)}
                  disabled={item.quantity >= item.stock}
                  className="w-7 h-7 flex items-center justify-center rounded border border-[hsl(var(--border))] disabled:opacity-30 hover:bg-[hsl(var(--accent))]"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              <span className="text-sm font-semibold text-[hsl(var(--foreground))]">
                {(item.unitPrice * item.quantity - (item.itemDiscount ?? 0)).toLocaleString()} TZS
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="border-t border-[hsl(var(--border))] px-4 py-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-[hsl(var(--muted-foreground))]">Subtotal</span>
          <span className="text-[hsl(var(--foreground))]">
            {subtotal.toLocaleString()} TZS
          </span>
        </div>

        {/* Discount Row */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-[hsl(var(--muted-foreground))]">Discount</span>
          <div className="flex-1 flex items-center gap-1">
            <div className="flex rounded-md border border-[hsl(var(--border))] overflow-hidden">
              <button
                onClick={() => onDiscountTypeChange('PERCENTAGE')}
                className={`px-2 py-1 text-xs ${
                  discountType === 'PERCENTAGE'
                    ? 'bg-brand-gold text-black'
                    : 'text-[hsl(var(--muted-foreground))]'
                }`}
              >
                <Percent className="w-3 h-3" />
              </button>
              <button
                onClick={() => onDiscountTypeChange('FIXED')}
                className={`px-2 py-1 text-xs ${
                  discountType === 'FIXED'
                    ? 'bg-brand-gold text-black'
                    : 'text-[hsl(var(--muted-foreground))]'
                }`}
              >
                TZS
              </button>
            </div>
            <input
              type="number"
              min={0}
              max={discountType === 'PERCENTAGE' ? 100 : subtotal}
              value={discount || ''}
              onChange={(e) => onDiscountChange(Number(e.target.value))}
              className="w-20 px-2 py-1 text-xs rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-right"
              placeholder="0"
            />
          </div>
          {discountAmount > 0 && (
            <span className="text-sm text-red-500">
              -{discountAmount.toLocaleString()}
            </span>
          )}
        </div>

        <div className="flex justify-between text-lg font-bold pt-2 border-t border-[hsl(var(--border))]">
          <span className="text-[hsl(var(--foreground))]">TOTAL</span>
          <span className="text-brand-gold">{total.toLocaleString()} TZS</span>
        </div>
      </div>
    </div>
  );
}
