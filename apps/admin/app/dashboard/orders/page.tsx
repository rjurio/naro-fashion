'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Download, Loader2, ChevronDown, ChevronRight, Package } from 'lucide-react';
import Image from 'next/image';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import ServerPager from '@/components/ui/ServerPager';
import { adminApi } from '@/lib/api';
import { ADMIN_PAGE_SIZE, normalizePaginated } from '@/lib/pagination';
import { useToast } from '@/contexts/ToastContext';

interface OrderItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number | string;
  total: number | string;
  product?: { id: string; name: string; images?: string[] };
  variant?: { id: string; name: string; size?: string; color?: string } | null;
}

interface Order {
  id: string;
  orderNumber: string;
  customer: string;
  email: string;
  items: number;
  total: string;
  payment: string;
  paymentStatus: string;
  status: string;
  type: string;
  date: string;
  rawItems: OrderItem[];
  shippingAddress?: string;
  notes?: string;
  [key: string]: unknown;
}

// Mirrors OrdersService.updateStatus validTransitions on the API.
const STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};
const ALL_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  CONFIRMED: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  PROCESSING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  SHIPPED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  DELIVERED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

// Payment status badges. REFUND_PENDING = an admin cancelled a paid order and
// the money still has to go back to the customer.
const PAYMENT_STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Unpaid', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  PROCESSING: { label: 'Processing', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  PARTIAL: { label: 'Partially paid', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  PAID: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' },
  COMPLETED: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' },
  REFUND_PENDING: { label: 'Refund pending', cls: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-700' },
  REFUNDED: { label: 'Refunded', cls: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
  FAILED: { label: 'Failed', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
};

function PaymentStatusBadge({ status }: { status: string }) {
  const s = String(status || 'PENDING').toUpperCase();
  const style = PAYMENT_STATUS_STYLES[s] ?? {
    label: s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' '),
    cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${style.cls}`}>
      {style.label}
    </span>
  );
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const tzs = (v: unknown) => `TZS ${(Number(v) || 0).toLocaleString()}`;

/** Build a one-line shipping address from the order's Address relation. */
function formatAddress(a: any): string {
  if (!a) return '';
  const recipient = [a.fullName, a.phone].filter(Boolean).join(', ');
  const place = [a.street, a.city, a.region ?? a.state, a.postalCode ?? a.zipCode, a.country]
    .filter((p) => p && String(p).trim())
    .join(', ');
  return [recipient, place].filter(Boolean).join(' — ');
}

function mapOrder(o: any): Order {
  return {
    id: o.id || '',
    orderNumber: o.orderNumber || o.id || '',
    customer: o.user
      ? `${o.user.firstName || ''} ${o.user.lastName || ''}`.trim() || o.user.email || 'Customer'
      : o.customerName || o.customer || 'Guest',
    email: o.user?.email || o.customerPhone || o.email || '',
    items: Array.isArray(o.items) ? o.items.length : o.items ?? 0,
    total: tzs(o.total),
    payment: o.paymentMethod || o.payment || 'N/A',
    paymentStatus: String(o.paymentStatus || 'PENDING').toUpperCase(),
    status: String(o.status || 'PENDING').toUpperCase(),
    type: o.channel === 'POS' ? 'POS' : 'Online',
    date: o.createdAt ? new Date(o.createdAt).toLocaleDateString() : o.date || '',
    rawItems: Array.isArray(o.items) ? o.items : [],
    shippingAddress: formatAddress(o.address),
    notes: o.notes || '',
  };
}

export default function OrdersPage() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  // Server-side pagination
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Debounce search; any filter change resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const fetchOrders = useCallback(async () => {
    setFetching(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: String(ADMIN_PAGE_SIZE) };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter !== 'all') params.status = statusFilter;
      const data = await adminApi.getOrders(params);
      const result = normalizePaginated<any>(data, page, ADMIN_PAGE_SIZE, ['data', 'orders', 'items']);
      setOrders(result.items.map(mapOrder));
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      console.error('Failed to fetch orders:', err);
      setOrders([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
      setFetching(false);
    }
  }, [page, debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    setUpdatingId(orderId);
    try {
      await adminApi.updateOrderStatus(orderId, newStatus);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));
      toast(`Order marked ${titleCase(newStatus)}`, 'success');
    } catch (err: any) {
      toast(err?.message || 'Failed to update order status', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const columns: Column<Order>[] = [
    { key: 'orderNumber', header: 'Order #', sortable: true },
    {
      key: 'customer',
      header: 'Customer',
      sortable: true,
      render: (order) => (
        <div>
          <p className="font-medium text-[hsl(var(--foreground))]">{order.customer}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{order.email}</p>
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      sortable: true,
      render: (order) => (
        <span className="inline-flex items-center gap-1.5">
          {expandedOrderId === order.id ? (
            <ChevronDown className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
          )}
          {order.items} item{order.items !== 1 ? 's' : ''}
        </span>
      ),
    },
    { key: 'total', header: 'Total', sortable: true },
    {
      key: 'payment',
      header: 'Payment',
      render: (order) => (
        <div className="flex flex-col items-start gap-1">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{order.payment}</span>
          <PaymentStatusBadge status={order.paymentStatus} />
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Channel',
      render: (order) => (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            order.type === 'POS'
              ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
              : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
          }`}
        >
          {order.type}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (order) => {
        const next = STATUS_TRANSITIONS[order.status] || [];
        return (
          <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <select
              value={order.status}
              disabled={next.length === 0 || updatingId === order.id}
              onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border-none outline-none cursor-pointer disabled:cursor-default ${STATUS_COLORS[order.status] || ''}`}
            >
              <option value={order.status}>{titleCase(order.status)}</option>
              {next.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </select>
            {updatingId === order.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-gold" />}
          </span>
        );
      },
    },
    { key: 'date', header: 'Date', sortable: true },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Orders</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Manage and track all customer orders
          </p>
        </div>
        <Button variant="outline">
          <Download className="w-4 h-4" />
          Export
        </Button>
      </div>

      {/* Filters (applied server-side) */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-[hsl(var(--muted))] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            placeholder="Search order #, customer name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] w-full"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
        >
          <option value="all">All Statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={orders}
            pageSize={ADMIN_PAGE_SIZE}
            pageSizeOptions={[ADMIN_PAGE_SIZE]}
            onRowClick={(order) =>
              setExpandedOrderId(expandedOrderId === order.id ? null : order.id)
            }
            expandedRowId={expandedOrderId}
            renderExpandedRow={(order) => {
              const items = order.rawItems as OrderItem[];
              const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
              const baseUrl = apiUrl.replace('/api/v1', '');
              return (
                <div className="py-4 space-y-3">
                  <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    Order Items
                  </h4>
                  {items.length === 0 ? (
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">No item details available</p>
                  ) : (
                    <div className="rounded-lg border border-[hsl(var(--border))] overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
                            <th className="px-4 py-2 text-left text-xs font-medium text-[hsl(var(--muted-foreground))]">Product</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-[hsl(var(--muted-foreground))]">Variant</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-[hsl(var(--muted-foreground))]">Qty</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-[hsl(var(--muted-foreground))]">Unit Price</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-[hsl(var(--muted-foreground))]">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => {
                            const img = item.product?.images?.[0];
                            const imgSrc = img
                              ? img.startsWith('http') ? img : `${baseUrl}/${img}`
                              : null;
                            return (
                              <tr key={item.id} className="border-b border-[hsl(var(--border))] last:border-b-0">
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center gap-3">
                                    {imgSrc ? (
                                      <Image
                                        src={imgSrc}
                                        alt={item.product?.name || 'Product'}
                                        width={36}
                                        height={36}
                                        className="rounded object-cover"
                                      />
                                    ) : (
                                      <div className="w-9 h-9 rounded bg-[hsl(var(--border))] flex items-center justify-center">
                                        <Package className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                                      </div>
                                    )}
                                    <span className="font-medium text-[hsl(var(--foreground))]">
                                      {item.product?.name || 'Unknown Product'}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-[hsl(var(--muted-foreground))]">
                                  {item.variant
                                    ? [item.variant.size, item.variant.color, item.variant.name]
                                        .filter(Boolean)
                                        .join(' / ') || '-'
                                    : '-'}
                                </td>
                                <td className="px-4 py-2.5 text-right">{item.quantity}</td>
                                <td className="px-4 py-2.5 text-right">{tzs(item.unitPrice)}</td>
                                <td className="px-4 py-2.5 text-right font-medium">{tzs(item.total)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                    <span className="font-medium">Payment:</span>
                    <span>{order.payment}</span>
                    <PaymentStatusBadge status={order.paymentStatus} />
                    {order.paymentStatus === 'REFUND_PENDING' && (
                      <span className="text-amber-700 dark:text-amber-400">
                        Order was cancelled after payment — refund the customer.
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    <span className="font-medium">Shipping:</span>{' '}
                    {order.shippingAddress
                      ? (order.shippingAddress as string)
                      : order.type === 'POS'
                        ? 'In-store (POS)'
                        : 'No shipping address on file'}
                  </p>
                  {order.notes && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      <span className="font-medium">Notes:</span> {order.notes as string}
                    </p>
                  )}
                </div>
              );
            }}
          />
          <ServerPager
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={ADMIN_PAGE_SIZE}
            onPageChange={setPage}
            loading={fetching}
            itemLabel="orders"
          />
        </>
      )}
    </div>
  );
}
