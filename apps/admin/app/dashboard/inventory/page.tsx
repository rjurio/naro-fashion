'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  Warehouse,
  AlertTriangle,
  Package,
  TrendingUp,
  DollarSign,
  Box,
  RefreshCw,
  Settings2,
  PlusCircle,
} from 'lucide-react';
import adminApi from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { FormField } from '@/components/ui/FormField';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';

function formatTZS(v: number) {
  return `TZS ${v.toLocaleString('en')}`;
}

function stockBadge(status: string) {
  const map: Record<string, any> = { OK: 'success', LOW: 'warning', OUT: 'error' };
  return <Badge variant={map[status] ?? 'neutral'}>{status}</Badge>;
}

type Tab = 'stock' | 'low-stock' | 'transactions' | 'valuation';

export default function InventoryPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<Tab>('stock');
  const [inventory, setInventory] = useState<any[]>([]);
  const [valuation, setValuation] = useState<any>(null);
  const [transactions, setTransactions] = useState<any>(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals
  const [editModal, setEditModal] = useState<{ open: boolean; product: any | null }>({
    open: false,
    product: null,
  });
  const [adjustModal, setAdjustModal] = useState(false);
  const [editForm, setEditForm] = useState({
    purchasePrice: '',
    minimumStock: '',
    supplierName: '',
    supplierContact: '',
  });
  const [adjustForm, setAdjustForm] = useState({
    productId: '',
    variantId: '',
    type: 'RESTOCK',
    quantity: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const data = await adminApi.getInventoryList(params);
      setInventory(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    if (activeTab === 'valuation' && !valuation) {
      adminApi
        .getInventoryValuation()
        .then(setValuation)
        .catch(() => toast.error('Failed to load valuation'));
    }
  }, [activeTab, valuation]);

  const loadTransactions = async (productId: string) => {
    if (!productId) return;
    setTxLoading(true);
    try {
      const data = await adminApi.getInventoryTransactions(productId);
      setTransactions(data);
    } catch {
      toast.error('Failed to load transactions');
    } finally {
      setTxLoading(false);
    }
  };

  const openEdit = (product: any) => {
    setEditForm({
      purchasePrice: product.purchasePrice ?? '',
      minimumStock: product.minimumStock ?? '5',
      supplierName: product.supplierName ?? '',
      supplierContact: product.supplierContact ?? '',
    });
    setEditModal({ open: true, product });
  };

  const saveSettings = async () => {
    if (!editModal.product) return;
    setSaving(true);
    try {
      await adminApi.updateInventorySettings(editModal.product.id, {
        purchasePrice: editForm.purchasePrice ? Number(editForm.purchasePrice) : undefined,
        minimumStock: editForm.minimumStock ? Number(editForm.minimumStock) : undefined,
        supplierName: editForm.supplierName || undefined,
        supplierContact: editForm.supplierContact || undefined,
      });
      toast.success('Inventory settings saved');
      setEditModal({ open: false, product: null });
      loadInventory();
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const submitAdjust = async () => {
    if (!adjustForm.productId || !adjustForm.quantity) return;
    if (adjustForm.type === 'DAMAGE') {
      const ok = await confirm({
        title: 'Record Damage',
        message: 'This will reduce stock. Confirm?',
        confirmLabel: 'Record Damage',
        variant: 'warning',
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await adminApi.adjustStock({ ...adjustForm, quantity: Number(adjustForm.quantity) });
      toast.success('Stock adjusted successfully');
      setAdjustModal(false);
      setAdjustForm({ productId: '', variantId: '', type: 'RESTOCK', quantity: '', note: '' });
      loadInventory();
    } catch {
      toast.error('Failed to adjust stock');
    } finally {
      setSaving(false);
    }
  };

  const lowStockCount = inventory.filter((p) => p.stockStatus !== 'OK').length;
  const displayInventory =
    activeTab === 'low-stock' ? inventory.filter((p) => p.stockStatus !== 'OK') : inventory;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'stock', label: 'Stock Levels' },
    {
      key: 'low-stock',
      label: `Low Stock Alerts${lowStockCount > 0 ? ` (${lowStockCount})` : ''}`,
    },
    { key: 'transactions', label: 'Transaction History' },
    { key: 'valuation', label: 'Valuation' },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Inventory"
        subtitle="Manage stock levels, costs, and movements"
        actions={
          <button
            onClick={() => setAdjustModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors"
          >
            <PlusCircle className="w-4 h-4" /> Adjust Stock
          </button>
        }
      />

      {/* Low stock alert banner */}
      {lowStockCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 dark:bg-amber-950 dark:border-amber-800 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-amber-600 w-5 h-5" />
            <span className="font-medium text-amber-800 dark:text-amber-300">
              {lowStockCount} product{lowStockCount > 1 ? 's' : ''} below minimum stock threshold
            </span>
          </div>
          <button
            onClick={() => setActiveTab('low-stock')}
            className="text-sm px-3 py-1.5 border border-amber-300 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors text-amber-800 dark:text-amber-300"
          >
            View Items
          </button>
        </div>
      )}

      {/* Valuation summary */}
      {valuation && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { title: 'Cost Value', value: formatTZS(valuation.costValue ?? 0), icon: Package },
            { title: 'Retail Value', value: formatTZS(valuation.retailValue ?? 0), icon: TrendingUp },
            {
              title: 'Unrealized Profit',
              value: formatTZS(valuation.unrealizedProfit ?? 0),
              icon: DollarSign,
            },
            { title: 'Total SKUs', value: inventory.length, icon: Box },
            {
              title: 'Out of Stock',
              value: inventory.filter((p) => p.stockStatus === 'OUT').length,
              icon: AlertTriangle,
            },
          ].map((c) => (
            <div
              key={c.title}
              className="bg-card border border-border rounded-xl p-4 flex items-start justify-between"
            >
              <div>
                <p className="text-xs text-muted-foreground">{c.title}</p>
                <p className="text-lg font-bold mt-1">{c.value}</p>
              </div>
              <c.icon className="w-5 h-5 text-muted-foreground mt-0.5" />
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex border-b border-border overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === t.key
                  ? 'text-brand-gold border-b-2 border-brand-gold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Stock Levels & Low Stock tabs */}
        {(activeTab === 'stock' || activeTab === 'low-stock') && (
          <div>
            {activeTab === 'stock' && (
              <div className="flex gap-3 p-4 border-b border-border">
                <input
                  type="text"
                  placeholder="Search products..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 text-sm bg-background border border-border rounded-lg"
                >
                  <option value="">All Status</option>
                  <option value="OK">In Stock</option>
                  <option value="LOW">Low Stock</option>
                  <option value="OUT">Out of Stock</option>
                </select>
              </div>
            )}
            {loading ? (
              <SkeletonTable rows={6} cols={8} />
            ) : displayInventory.length === 0 ? (
              <EmptyState
                icon={Warehouse}
                title={activeTab === 'low-stock' ? 'No low stock items' : 'No products found'}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/30">
                    <tr>
                      {[
                        'Product',
                        'Category',
                        'Purchase Cost',
                        'Selling Price',
                        'Margin %',
                        'Stock',
                        'Min Stock',
                        'Status',
                        'Actions',
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayInventory.map((p: any) => (
                      <tr
                        key={p.id}
                        className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.category?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {p.purchasePrice ? formatTZS(Number(p.purchasePrice)) : '—'}
                        </td>
                        <td className="px-4 py-3">{formatTZS(Number(p.basePrice))}</td>
                        <td className="px-4 py-3">{p.profitMargin ? `${p.profitMargin}%` : '—'}</td>
                        <td className="px-4 py-3 font-medium">{p.totalStock}</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.minimumStock}</td>
                        <td className="px-4 py-3">{stockBadge(p.stockStatus)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => openEdit(p)}
                              className="p-1.5 rounded hover:bg-muted transition-colors"
                              title="Edit settings"
                            >
                              <Settings2 className="w-4 h-4 text-muted-foreground" />
                            </button>
                            <button
                              onClick={() => {
                                setAdjustForm((f) => ({ ...f, productId: p.id }));
                                setAdjustModal(true);
                              }}
                              className="p-1.5 rounded hover:bg-muted transition-colors"
                              title="Adjust stock"
                            >
                              <RefreshCw className="w-4 h-4 text-muted-foreground" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Transaction History */}
        {activeTab === 'transactions' && (
          <div>
            <div className="flex gap-3 p-4 border-b border-border">
              <select
                value={selectedProductId}
                onChange={(e) => {
                  setSelectedProductId(e.target.value);
                  loadTransactions(e.target.value);
                }}
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg"
              >
                <option value="">Select a product...</option>
                {inventory.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {!selectedProductId ? (
              <EmptyState
                title="Select a product to view transaction history"
                description="Choose a product from the dropdown above."
              />
            ) : txLoading ? (
              <SkeletonTable rows={5} cols={8} />
            ) : !transactions || (transactions.data ?? []).length === 0 ? (
              <EmptyState title="No transactions for this product" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/30">
                    <tr>
                      {['Date', 'Type', 'Qty Before', 'Change', 'Qty After', 'Unit Cost', 'Note', 'By'].map(
                        (h) => (
                          <th
                            key={h}
                            className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(transactions.data ?? []).map((t: any) => (
                      <tr key={t.id} className="border-b border-border/50">
                        <td className="px-4 py-2 text-muted-foreground">
                          {new Date(t.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant={t.quantityChange > 0 ? 'success' : 'error'}>{t.type}</Badge>
                        </td>
                        <td className="px-4 py-2">{t.quantityBefore}</td>
                        <td
                          className={`px-4 py-2 font-medium ${
                            t.quantityChange > 0 ? 'text-green-600' : 'text-red-500'
                          }`}
                        >
                          {t.quantityChange > 0 ? '+' : ''}
                          {t.quantityChange}
                        </td>
                        <td className="px-4 py-2">{t.quantityAfter}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {t.unitCost ? formatTZS(Number(t.unitCost)) : '—'}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground max-w-[200px] truncate">
                          {t.note ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{t.performedBy ?? 'System'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Valuation */}
        {activeTab === 'valuation' && (
          <div>
            {!valuation ? (
              <SkeletonTable rows={5} cols={7} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/30">
                    <tr>
                      {[
                        'Product',
                        'Stock',
                        'Purchase Cost',
                        'Retail Price',
                        'Total Cost',
                        'Total Retail',
                        'Margin %',
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(valuation.products ?? []).map((p: any) => (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium">{p.name}</td>
                        <td className="px-4 py-3">{p.totalStock}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {p.purchasePrice ? formatTZS(p.purchasePrice) : '—'}
                        </td>
                        <td className="px-4 py-3">{formatTZS(p.retailPrice)}</td>
                        <td className="px-4 py-3">
                          {p.purchasePrice ? formatTZS(p.totalCost) : '—'}
                        </td>
                        <td className="px-4 py-3">{formatTZS(p.totalRetail)}</td>
                        <td className="px-4 py-3">{p.profitMargin ? `${p.profitMargin}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 font-semibold">
                    <tr>
                      <td className="px-4 py-3" colSpan={4}>
                        TOTALS
                      </td>
                      <td className="px-4 py-3">{formatTZS(valuation.costValue ?? 0)}</td>
                      <td className="px-4 py-3">{formatTZS(valuation.retailValue ?? 0)}</td>
                      <td className="px-4 py-3 text-green-600">
                        {formatTZS(valuation.unrealizedProfit ?? 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Inventory Modal */}
      <Modal
        isOpen={editModal.open}
        onClose={() => setEditModal({ open: false, product: null })}
        title="Update Inventory Settings"
        size="md"
        footer={
          <>
            <button
              onClick={() => setEditModal({ open: false, product: null })}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveSettings}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Purchase Cost (TZS)" hint="Cost price used for profit margin calculations">
            <input
              type="number"
              value={editForm.purchasePrice}
              onChange={(e) => setEditForm((f) => ({ ...f, purchasePrice: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
            />
          </FormField>
          <FormField
            label="Minimum Stock Threshold"
            hint="Alert will trigger when stock falls below this number"
          >
            <input
              type="number"
              value={editForm.minimumStock}
              onChange={(e) => setEditForm((f) => ({ ...f, minimumStock: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
            />
          </FormField>
          <FormField label="Supplier Name">
            <input
              type="text"
              value={editForm.supplierName}
              onChange={(e) => setEditForm((f) => ({ ...f, supplierName: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
            />
          </FormField>
          <FormField label="Supplier Contact">
            <input
              type="text"
              value={editForm.supplierContact}
              onChange={(e) => setEditForm((f) => ({ ...f, supplierContact: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
            />
          </FormField>
        </div>
      </Modal>

      {/* Adjust Stock Modal */}
      <Modal
        isOpen={adjustModal}
        onClose={() => {
          setAdjustModal(false);
          setAdjustForm({ productId: '', variantId: '', type: 'RESTOCK', quantity: '', note: '' });
        }}
        title="Adjust Stock"
        size="md"
        footer={
          <>
            <button
              onClick={() => setAdjustModal(false)}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submitAdjust}
              disabled={saving || !adjustForm.productId || !adjustForm.quantity}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-[#c9a832] text-black transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Confirm Adjustment'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Product" required>
            <select
              value={adjustForm.productId}
              onChange={(e) =>
                setAdjustForm((f) => ({ ...f, productId: e.target.value, variantId: '' }))
              }
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
            >
              <option value="">Select product...</option>
              {inventory.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </FormField>
          {adjustForm.productId &&
            (() => {
              const product = inventory.find((p: any) => p.id === adjustForm.productId);
              if (!product?.variants?.length) return null;
              return (
                <FormField label="Variant" hint="Select specific size/color (optional)">
                  <select
                    value={adjustForm.variantId}
                    onChange={(e) => setAdjustForm((f) => ({ ...f, variantId: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
                  >
                    <option value="">All variants</option>
                    {product.variants.map((v: any) => (
                      <option key={v.id} value={v.id}>
                        {v.name} (stock: {v.stock})
                      </option>
                    ))}
                  </select>
                </FormField>
              );
            })()}
          <FormField label="Adjustment Type" required>
            <select
              value={adjustForm.type}
              onChange={(e) => setAdjustForm((f) => ({ ...f, type: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
            >
              <option value="RESTOCK">Restock (+)</option>
              <option value="ADJUSTMENT">Manual Adjustment</option>
              <option value="DAMAGE">Damage (-)</option>
            </select>
          </FormField>
          <FormField label="Quantity" required>
            <input
              type="number"
              min="1"
              value={adjustForm.quantity}
              onChange={(e) => setAdjustForm((f) => ({ ...f, quantity: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
            />
          </FormField>
          <FormField label="Note / Reference">
            <textarea
              value={adjustForm.note}
              onChange={(e) => setAdjustForm((f) => ({ ...f, note: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold/50 resize-none"
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
