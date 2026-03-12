'use client';

import { useState } from 'react';
import { X, ArrowLeftRight, Search, Plus, Minus, Trash2 } from 'lucide-react';
import adminApi from '../../../../lib/api';
import { PAYMENT_METHOD_LABELS } from '@naro/shared';

interface ReturnItem {
  orderItemId: string;
  productName: string;
  variantName: string;
  quantity: number;
  maxQuantity: number;
  unitPrice: number;
}

interface NewItem {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  stock: number;
}

interface Props {
  onClose: () => void;
  onComplete: () => void;
}

const PAYMENT_METHODS = ['CASH', 'MPESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'MIX_BY_YAS', 'CARD'];

export default function ExchangeModal({ onClose, onComplete }: Props) {
  const [step, setStep] = useState<'search' | 'select' | 'new_items' | 'settle'>('search');
  const [orderSearch, setOrderSearch] = useState('');
  const [originalOrder, setOriginalOrder] = useState<any>(null);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [newItems, setNewItems] = useState<NewItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [settlementMethod, setSettlementMethod] = useState('CASH');
  const [reason, setReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const returnTotal = returnItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const newTotal = newItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const priceDifference = newTotal - returnTotal;

  const handleSearchOrder = async () => {
    if (!orderSearch) return;
    try {
      // Search by order ID directly
      const order = await adminApi.posGetSale(orderSearch);
      if (order) {
        setOriginalOrder(order);
        setStep('select');
      }
    } catch {
      // Try searching by order number
      try {
        const result = await adminApi.posGetSales({ search: orderSearch, limit: '1' });
        const sales = result?.data || [];
        if (sales.length > 0) {
          const order = await adminApi.posGetSale(sales[0].id);
          setOriginalOrder(order);
          setStep('select');
        } else {
          alert('Order not found');
        }
      } catch {
        alert('Order not found');
      }
    }
  };

  const toggleReturnItem = (orderItem: any) => {
    const existing = returnItems.find((i) => i.orderItemId === orderItem.id);
    if (existing) {
      setReturnItems(returnItems.filter((i) => i.orderItemId !== orderItem.id));
    } else {
      setReturnItems([
        ...returnItems,
        {
          orderItemId: orderItem.id,
          productName: orderItem.product?.name ?? '',
          variantName: orderItem.variant?.name ?? '',
          quantity: orderItem.quantity,
          maxQuantity: orderItem.quantity,
          unitPrice: Number(orderItem.unitPrice),
        },
      ]);
    }
  };

  const searchNewProducts = async (q: string) => {
    setProductSearch(q);
    if (q.length < 2) { setSearchResults([]); return; }
    try {
      const results = await adminApi.posSearchProducts(q);
      setSearchResults(Array.isArray(results) ? results : []);
    } catch {
      setSearchResults([]);
    }
  };

  const addNewItem = (product: any, variant: any) => {
    const existing = newItems.find((i) => i.variantId === variant.id);
    if (existing) {
      setNewItems(newItems.map((i) =>
        i.variantId === variant.id ? { ...i, quantity: i.quantity + 1 } : i
      ));
    } else {
      setNewItems([
        ...newItems,
        {
          productId: product.id,
          variantId: variant.id,
          productName: product.name,
          variantName: variant.name,
          quantity: 1,
          unitPrice: Number(variant.price),
          stock: variant.stock,
        },
      ]);
    }
  };

  const handleExchange = async () => {
    if (returnItems.length === 0 || processing) return;
    setProcessing(true);
    try {
      await adminApi.posCreateExchange({
        originalOrderId: originalOrder.id,
        returnedItems: returnItems.map((i) => ({
          orderItemId: i.orderItemId,
          quantity: i.quantity,
        })),
        newItems: newItems.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
        settlementMethod: priceDifference !== 0 ? settlementMethod : undefined,
        reason: reason || undefined,
      });
      onComplete();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Exchange failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[hsl(var(--card))] rounded-xl w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-brand-gold" />
            Product Exchange
          </h3>
          <button onClick={onClose} className="text-[hsl(var(--muted-foreground))]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Step 1: Search Original Order */}
          {step === 'search' && (
            <div className="space-y-3">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Enter the original sale order number or ID
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchOrder()}
                  placeholder="Order # or ID..."
                  className="flex-1 px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm"
                  autoFocus
                />
                <button
                  onClick={handleSearchOrder}
                  className="px-4 py-2 rounded-lg bg-brand-gold text-black text-sm font-medium"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Select Items to Return */}
          {step === 'select' && originalOrder && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                    {originalOrder.orderNumber}
                  </p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    {new Date(originalOrder.createdAt).toLocaleDateString()} •{' '}
                    {Number(originalOrder.total).toLocaleString()} TZS
                  </p>
                </div>
              </div>

              <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                Select items to return:
              </p>

              {originalOrder.items?.map((item: any) => {
                const selected = returnItems.find((r) => r.orderItemId === item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleReturnItem(item)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                      selected
                        ? 'border-brand-gold bg-brand-gold/5'
                        : 'border-[hsl(var(--border))] hover:border-brand-gold/50'
                    }`}
                  >
                    <div>
                      <p className="text-sm text-[hsl(var(--foreground))]">{item.product?.name}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {item.variant?.name} • Qty: {item.quantity} • {Number(item.unitPrice).toLocaleString()} TZS
                      </p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      selected ? 'border-brand-gold bg-brand-gold' : 'border-[hsl(var(--border))]'
                    }`}>
                      {selected && <span className="text-black text-xs">✓</span>}
                    </div>
                  </button>
                );
              })}

              <button
                onClick={() => setStep('new_items')}
                disabled={returnItems.length === 0}
                className="w-full py-2.5 rounded-lg bg-brand-gold text-black text-sm font-medium disabled:opacity-40"
              >
                Next: Select Replacement Items ({returnItems.length} selected)
              </button>
            </div>
          )}

          {/* Step 3: Add New Items */}
          {step === 'new_items' && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                Return credit: {returnTotal.toLocaleString()} TZS — Search for replacement items:
              </p>

              <input
                type="text"
                value={productSearch}
                onChange={(e) => searchNewProducts(e.target.value)}
                placeholder="Search products..."
                className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm"
              />

              {/* Search Results */}
              {searchResults.map((product) => (
                <div key={product.id} className="border border-[hsl(var(--border))] rounded-lg p-2">
                  <p className="text-sm font-medium text-[hsl(var(--foreground))] mb-1">{product.name}</p>
                  {product.variants?.map((v: any) => (
                    <button
                      key={v.id}
                      onClick={() => addNewItem(product, v)}
                      disabled={v.stock <= 0}
                      className="w-full flex items-center justify-between px-2 py-1 text-xs hover:bg-[hsl(var(--accent))] rounded disabled:opacity-30"
                    >
                      <span>{v.name} ({v.stock})</span>
                      <span className="flex items-center gap-1">
                        {Number(v.price).toLocaleString()} TZS
                        {v.stock > 0 && <Plus className="w-3 h-3 text-brand-gold" />}
                      </span>
                    </button>
                  ))}
                </div>
              ))}

              {/* Selected New Items */}
              {newItems.length > 0 && (
                <div className="space-y-1 p-3 border border-[hsl(var(--border))] rounded-lg">
                  <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">Replacement items:</p>
                  {newItems.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-[hsl(var(--foreground))]">
                        {item.productName} ({item.variantName}) x{item.quantity}
                      </span>
                      <div className="flex items-center gap-2">
                        <span>{(item.unitPrice * item.quantity).toLocaleString()} TZS</span>
                        <button onClick={() => setNewItems(newItems.filter((_, j) => j !== i))} className="text-red-500">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Summary */}
              <div className="p-3 bg-[hsl(var(--accent))] rounded-lg text-sm space-y-1">
                <div className="flex justify-between">
                  <span>Return Credit</span>
                  <span className="text-green-600">+{returnTotal.toLocaleString()} TZS</span>
                </div>
                <div className="flex justify-between">
                  <span>New Items</span>
                  <span>{newTotal.toLocaleString()} TZS</span>
                </div>
                <div className="flex justify-between font-bold border-t border-[hsl(var(--border))] pt-1">
                  <span>{priceDifference > 0 ? 'Customer Owes' : priceDifference < 0 ? 'Refund Due' : 'Even Exchange'}</span>
                  <span className={priceDifference > 0 ? 'text-amber-500' : priceDifference < 0 ? 'text-green-600' : ''}>
                    {Math.abs(priceDifference).toLocaleString()} TZS
                  </span>
                </div>
              </div>

              <button
                onClick={() => setStep('settle')}
                className="w-full py-2.5 rounded-lg bg-brand-gold text-black text-sm font-medium"
              >
                {priceDifference === 0 ? 'Process Exchange' : 'Next: Settlement'}
              </button>
            </div>
          )}

          {/* Step 4: Settle */}
          {step === 'settle' && (
            <div className="space-y-3">
              <p className="text-sm text-[hsl(var(--foreground))]">
                {priceDifference > 0
                  ? `Customer owes ${priceDifference.toLocaleString()} TZS`
                  : `Refund ${Math.abs(priceDifference).toLocaleString()} TZS to customer`}
              </p>

              <select
                value={settlementMethod}
                onChange={(e) => setSettlementMethod(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m] ?? m}</option>
                ))}
              </select>

              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for exchange (optional)..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm resize-none"
              />

              <button
                onClick={handleExchange}
                disabled={processing}
                className="w-full py-2.5 rounded-lg bg-brand-gold text-black text-sm font-bold disabled:opacity-40"
              >
                {processing ? 'Processing...' : 'Complete Exchange'}
              </button>
            </div>
          )}
        </div>

        {/* Step Navigation */}
        {step !== 'search' && (
          <div className="px-4 py-2 border-t border-[hsl(var(--border))]">
            <button
              onClick={() => {
                if (step === 'settle') setStep('new_items');
                else if (step === 'new_items') setStep('select');
                else setStep('search');
              }}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
