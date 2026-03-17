'use client';

import { useState, useEffect } from 'react';
import { Search, Download, Loader2, ChevronDown, ChevronRight, Package } from 'lucide-react';
import Image from 'next/image';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';

interface OrderItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  total: number;
  product?: { id: string; name: string; images?: string[] };
  variant?: { id: string; name: string; size?: string; color?: string } | null;
}

interface Order {
  id: string;
  customer: string;
  email: string;
  items: number;
  total: string;
  payment: string;
  status: string;
  type: string;
  date: string;
  rawItems: OrderItem[];
  shippingAddress?: string;
  notes?: string;
  [key: string]: unknown;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchOrders = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getOrders();
        const raw: any[] = Array.isArray(data) ? data : data?.data || data?.orders || [];
        setOrders(
          raw.map((o: any) => ({
            id: o.id || '',
            customer: o.user
              ? `${o.user.firstName || ''} ${o.user.lastName || ''}`.trim()
              : o.customer || 'Guest',
            email: o.user?.email || o.email || '',
            items: Array.isArray(o.items) ? o.items.length : o.items ?? 0,
            total: typeof o.total === 'number'
              ? `TZS ${o.total.toLocaleString()}`
              : o.total || 'TZS 0',
            payment: o.paymentMethod || o.payment || 'N/A',
            status: o.status || 'Processing',
            type: o.type || 'Purchase',
            date: o.createdAt
              ? new Date(o.createdAt).toLocaleDateString()
              : o.date || '',
            rawItems: Array.isArray(o.items) ? o.items : [],
            shippingAddress: o.address
              ? `${o.address.street || ''}, ${o.address.city || ''}`
              : '',
            notes: o.notes || '',
          }))
        );
      } catch (err) {
        console.error('Failed to fetch orders:', err);
        setOrders([]);
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, []);

  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    try {
      await adminApi.updateOrderStatus(orderId, newStatus);
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );
    } catch (err) {
      console.error('Failed to update order status:', err);
    }
  };

  const columns: Column<Order>[] = [
    { key: 'id', header: 'Order ID', sortable: true },
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
    { key: 'payment', header: 'Payment' },
    {
      key: 'type',
      header: 'Type',
      render: (order) => (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            order.type === 'Rental'
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
        const colors: Record<string, string> = {
          Processing: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
          Shipped: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
          Delivered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
          Confirmed: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
          Cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
        };
        return (
          <select
            value={order.status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border-none outline-none cursor-pointer ${colors[order.status] || ''}`}
          >
            <option value="Processing">Processing</option>
            <option value="Shipped">Shipped</option>
            <option value="Delivered">Delivered</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        );
      },
    },
    { key: 'date', header: 'Date', sortable: true },
  ];

  const filteredOrders = orders.filter((o) => {
    const matchesSearch =
      (o.customer || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (o.id || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || (o.status || '').toLowerCase() === statusFilter;
    return matchesSearch && matchesStatus;
  });

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

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-[hsl(var(--muted))] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            placeholder="Search orders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] w-full"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
        >
          <option value="all">All Statuses</option>
          <option value="processing">Processing</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredOrders}
          pageSize={10}
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
                              <td className="px-4 py-2.5 text-right">
                                TZS {(item.unitPrice ?? 0).toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5 text-right font-medium">
                                TZS {(item.total ?? 0).toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {order.shippingAddress && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    <span className="font-medium">Shipping:</span> {order.shippingAddress as string}
                  </p>
                )}
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
