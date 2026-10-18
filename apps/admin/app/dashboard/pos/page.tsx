'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/contexts/ToastContext';
import {
  ArrowLeft,
  Clock,
  Pause,
  XCircle,
  RefreshCw,
  ArrowLeftRight,
  BookOpen,
  CloudOff,
} from 'lucide-react';
import adminApi from '../../../lib/api';
import { isQueuedResult } from '@/lib/offline/outbox';
import { useSyncStatus } from '@/contexts/SyncContext';
import { usePosCatalog } from './hooks/usePosCatalog';
import OfflineReceiptModal, { type OfflineReceiptData } from './components/OfflineReceiptModal';
import ProductSearch from './components/ProductSearch';
import PosCart, { CartItem } from './components/PosCart';
import PaymentPanel from './components/PaymentPanel';
import CustomerLookup from './components/CustomerLookup';
import OpenShiftModal from './components/OpenShiftModal';
import CloseShiftModal from './components/CloseShiftModal';
import ReceiptModal from './components/ReceiptModal';
import HeldSalesModal from './components/HeldSalesModal';
import LayawayModal from './components/LayawayModal';
import ExchangeModal from './components/ExchangeModal';
import SyncStatusBadge from '@/components/offline/SyncStatusBadge';

const NEEDS_INTERNET = 'Needs internet';
const NO_OFFLINE_SHIFT = 'Open a shift while online before selling offline.';

interface Customer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export default function PosPage() {
  const toast = useToast();
  const router = useRouter();
  const { online } = useSyncStatus();
  const offline = !online;
  const catalog = usePosCatalog(online);

  // Session
  const [session, setSession] = useState<any>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [showCloseShift, setShowCloseShift] = useState(false);

  // Cart
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<'PERCENTAGE' | 'FIXED'>('PERCENTAGE');

  // Customer
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  // Categories (for filter chips)
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  // Modals
  const [showReceipt, setShowReceipt] = useState<string | null>(null);
  const [offlineReceipt, setOfflineReceipt] = useState<OfflineReceiptData | null>(null);
  const [showHeldSales, setShowHeldSales] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [note, setNote] = useState('');
  const [showLayaway, setShowLayaway] = useState(false);
  const [showExchange, setShowExchange] = useState(false);

  // Load session on mount
  useEffect(() => {
    const init = async () => {
      try {
        const [currentSession, cats, held] = await Promise.all([
          adminApi.posGetCurrentSession(),
          adminApi.getCategories().catch(() => []),
          adminApi.posGetHeldSales().catch(() => []),
        ]);
        setSession(currentSession);
        setCategories(Array.isArray(cats) ? cats : []);
        setHeldCount(Array.isArray(held) ? held.length : 0);
      } catch {
        setSession(null);
      } finally {
        setSessionLoading(false);
      }
    };
    init();
  }, []);

  // Cart operations
  const addToCart = useCallback((item: CartItem) => {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.variantId === item.variantId);
      if (existing) {
        if (existing.quantity >= existing.stock) return prev;
        return prev.map((i) =>
          i.variantId === item.variantId
            ? { ...i, quantity: i.quantity + 1 }
            : i,
        );
      }
      return [...prev, item];
    });
  }, []);

  const updateQuantity = (variantId: string, quantity: number) => {
    if (quantity <= 0) {
      setCartItems((prev) => prev.filter((i) => i.variantId !== variantId));
    } else {
      setCartItems((prev) =>
        prev.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)),
      );
    }
  };

  const removeItem = (variantId: string) => {
    setCartItems((prev) => prev.filter((i) => i.variantId !== variantId));
  };

  const updateItemDiscount = (variantId: string, itemDiscount: number) => {
    setCartItems((prev) =>
      prev.map((i) => (i.variantId === variantId ? { ...i, itemDiscount } : i)),
    );
  };

  const clearCart = () => {
    setCartItems([]);
    setDiscount(0);
    setDiscountType('PERCENTAGE');
    setSelectedCustomer(null);
    setCustomerName('');
    setCustomerPhone('');
    setNote('');
  };

  // Calculate total for payment panel
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity - (item.itemDiscount ?? 0),
    0,
  );
  const discountAmount =
    discountType === 'PERCENTAGE' ? subtotal * (discount / 100) : discount;
  const total = subtotal - discountAmount;

  // Open shift
  const handleOpenShift = async (openingCash: number) => {
    try {
      const newSession = await adminApi.posOpenSession({ openingCash });
      setSession(newSession);
      // Refresh the device copy of "current shift" so offline sales can use it.
      void adminApi.posGetCurrentSession().catch(() => undefined);
    } catch (err: any) {
      toast.error(err.message || 'Failed to open shift');
    }
  };

  // Complete sale
  const handleCompleteSale = async (
    payments: { method: string; amount: number; transactionRef?: string }[],
    meta?: { cashReceived?: number },
  ) => {
    if (cartItems.length === 0 || processing) return;
    if (offline && !session?.id) {
      toast.error(NO_OFFLINE_SHIFT);
      return;
    }
    setProcessing(true);
    const saleAt = Date.now();
    try {
      // sessionId + clientCreatedAt are always sent: the server ignores them
      // for online sales, and they let a sale that fails mid-flight be replayed
      // as an offline sale. `offline: true` only when we know we're offline.
      const result = await adminApi.posCreateSale({
        items: cartItems.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          itemDiscount: i.itemDiscount,
        })),
        payments,
        customerId: selectedCustomer?.id,
        customerName: selectedCustomer ? undefined : customerName || undefined,
        customerPhone: selectedCustomer ? undefined : customerPhone || undefined,
        discount: discount > 0 ? discount : undefined,
        discountType: discount > 0 ? discountType : undefined,
        note: note || undefined,
        sessionId: session?.id,
        clientCreatedAt: new Date(saleAt).toISOString(),
        ...(offline ? { offline: true } : {}),
      });

      if (isQueuedResult(result)) {
        const custName = selectedCustomer
          ? [selectedCustomer.firstName, selectedCustomer.lastName].filter(Boolean).join(' ') || 'Customer'
          : customerName || 'Walk-in';
        setOfflineReceipt({
          outboxId: result.__outboxId,
          createdAt: saleAt,
          customer: custName,
          customerPhone: (selectedCustomer ? selectedCustomer.phone : customerPhone) || undefined,
          items: cartItems.map((i) => ({
            name: i.productName,
            variant: i.size || i.color ? `${i.size ?? ''} ${i.color ?? ''}`.trim() : i.variantName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            total: i.unitPrice * i.quantity - (i.itemDiscount ?? 0),
          })),
          subtotal,
          discount: discountAmount,
          total,
          payments,
          changeDue: meta?.cashReceived ? Math.max(0, meta.cashReceived - total) : 0,
        });
        toast.info('Offline sale saved on this device — it will sync automatically.');
      } else {
        setShowReceipt(result.order?.id);
        if (result?.oversold) toast.warning('Sale recorded, but stock was short — review stock for these items.');
      }
      clearCart();
    } catch (err: any) {
      toast.error(err.message || 'Sale failed');
    } finally {
      setProcessing(false);
    }
  };

  // Hold sale
  const handleHoldSale = async () => {
    if (cartItems.length === 0 || offline) return;
    try {
      await adminApi.posHoldSale({
        items: cartItems.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          productName: i.productName,
          variantName: i.variantName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          itemDiscount: i.itemDiscount,
        })),
        customerId: selectedCustomer?.id,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        discount: discount > 0 ? discount : undefined,
        discountType: discount > 0 ? discountType : undefined,
        note: note || undefined,
      });
      setHeldCount((c) => c + 1);
      clearCart();
    } catch (err: any) {
      toast.error(err.message || 'Failed to hold sale');
    }
  };

  // Resume held sale
  const handleResumeHeldSale = (held: any) => {
    const items = Array.isArray(held.items) ? held.items : [];
    setCartItems(
      items.map((i: any) => ({
        productId: i.productId,
        variantId: i.variantId,
        productName: i.productName,
        variantName: i.variantName,
        size: null,
        color: null,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        stock: 999,
        itemDiscount: i.itemDiscount,
      })),
    );
    setDiscount(Number(held.discount) || 0);
    setDiscountType(held.discountType || 'PERCENTAGE');
    setCustomerName(held.customerName || '');
    setCustomerPhone(held.customerPhone || '');
    setNote(held.note || '');
    setHeldCount((c) => Math.max(0, c - 1));
    setShowHeldSales(false);
  };

  // Loading state
  if (sessionLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-brand-gold mx-auto mb-3" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading POS...</p>
        </div>
      </div>
    );
  }

  // No session offline: a shift can only be opened online.
  if (!session && offline) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="max-w-sm text-center space-y-3">
          <CloudOff className="w-10 h-10 mx-auto text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">You&apos;re offline</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{NO_OFFLINE_SHIFT}</p>
          <div className="flex justify-center gap-2">
            <SyncStatusBadge compact align="left" />
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]"
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No session - show open shift modal
  if (!session) {
    return <OpenShiftModal onOpen={handleOpenShift} onCancel={() => router.push('/dashboard')} />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="h-5 w-px bg-[hsl(var(--border))]" />
          <h1 className="text-base font-bold text-brand-gold">NARO FASHION POS</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Online / offline + sync status (POS has no TopBar) */}
          <SyncStatusBadge compact />

          <button
            onClick={() => setShowHeldSales(true)}
            disabled={offline}
            title={offline ? NEEDS_INTERNET : undefined}
            className="relative flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Clock className="w-3.5 h-3.5" />
            Held Sales
            {heldCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
                {heldCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setShowLayaway(true)}
            disabled={offline}
            title={offline ? NEEDS_INTERNET : undefined}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Clock className="w-3.5 h-3.5" />
            Layaways
          </button>

          <button
            onClick={() => setShowExchange(true)}
            disabled={offline}
            title={offline ? NEEDS_INTERNET : undefined}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Exchange
          </button>

          <button
            onClick={() => router.push('/dashboard/pos/sales')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]"
          >
            <BookOpen className="w-3.5 h-3.5" />
            History
          </button>

          <div className="h-5 w-px bg-[hsl(var(--border))]" />

          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            Session #{session.id?.substring(0, 6)}
          </span>

          <button
            onClick={() => setShowCloseShift(true)}
            disabled={offline}
            title={offline ? NEEDS_INTERNET : undefined}
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Close Shift
          </button>
        </div>
      </div>

      {/* Main Content - Two Panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Product Search */}
        <div className="w-1/2 border-r border-[hsl(var(--border))] flex flex-col">
          <ProductSearch onAddToCart={addToCart} categories={categories} catalog={catalog} offline={offline} />
        </div>

        {/* Right Panel - Cart + Payment */}
        <div className="w-1/2 flex flex-col">
          {/* Cart */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <PosCart
              items={cartItems}
              onUpdateQuantity={updateQuantity}
              onRemoveItem={removeItem}
              onUpdateItemDiscount={updateItemDiscount}
              discount={discount}
              discountType={discountType}
              onDiscountChange={setDiscount}
              onDiscountTypeChange={setDiscountType}
            />
          </div>

          {/* Customer + Note + Payment */}
          <div className="border-t border-[hsl(var(--border))] px-4 py-3 space-y-3 bg-[hsl(var(--card))]">
            {/* Customer */}
            <CustomerLookup
              selectedCustomer={selectedCustomer}
              customerName={customerName}
              customerPhone={customerPhone}
              onSelectCustomer={setSelectedCustomer}
              onCustomerNameChange={setCustomerName}
              onCustomerPhoneChange={setCustomerPhone}
              offline={offline}
            />

            {/* Note */}
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Sale note (optional)..."
              className="w-full px-2.5 py-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs"
            />

            {/* Payment */}
            <PaymentPanel
              total={total}
              onPaymentsConfirmed={handleCompleteSale}
              disabled={cartItems.length === 0 || processing}
              offline={offline}
            />

            {/* Hold Sale Button */}
            <button
              onClick={handleHoldSale}
              disabled={cartItems.length === 0 || offline}
              title={offline ? NEEDS_INTERNET : undefined}
              className="w-full py-2 rounded-lg border border-amber-500 text-amber-500 text-xs font-medium disabled:opacity-30 hover:bg-amber-500/10 flex items-center justify-center gap-1.5"
            >
              <Pause className="w-3.5 h-3.5" />
              Hold Sale{offline ? ` · ${NEEDS_INTERNET}` : ''}
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showReceipt && (
        <ReceiptModal orderId={showReceipt} onClose={() => setShowReceipt(null)} />
      )}

      {offlineReceipt && (
        <OfflineReceiptModal receipt={offlineReceipt} onClose={() => setOfflineReceipt(null)} />
      )}

      {showHeldSales && (
        <HeldSalesModal
          onClose={() => setShowHeldSales(false)}
          onResume={handleResumeHeldSale}
        />
      )}

      {showCloseShift && (
        <CloseShiftModal
          sessionId={session.id}
          onClose={() => setShowCloseShift(false)}
          onShiftClosed={() => {
            setSession(null);
            setShowCloseShift(false);
            // Refresh the device copy so a closed shift is never used for offline sales.
            void adminApi.posGetCurrentSession().catch(() => undefined);
            router.push('/dashboard');
          }}
        />
      )}

      {showLayaway && (
        <LayawayModal onClose={() => setShowLayaway(false)} />
      )}

      {showExchange && (
        <ExchangeModal
          onClose={() => setShowExchange(false)}
          onComplete={() => {}}
        />
      )}
    </div>
  );
}
