'use client';

import { useRef } from 'react';
import { CloudOff, Printer, X } from 'lucide-react';
import { PAYMENT_METHOD_LABELS } from '@naro/shared';
import { useSiteSettings } from '@/contexts/SiteSettingsContext';
import { offlineReceiptNumber } from '@/lib/offline/outbox';

export interface OfflineReceiptData {
  outboxId: string;
  /** Epoch ms of the sale on this device. */
  createdAt: number;
  customer: string;
  customerPhone?: string;
  items: { name: string; variant: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  discount: number;
  total: number;
  payments: { method: string; amount: number; transactionRef?: string }[];
  changeDue: number;
}

interface Props {
  receipt: OfflineReceiptData;
  onClose: () => void;
}

const money = (n: number) => Math.round(n).toLocaleString();

/**
 * Receipt for a POS sale queued offline. Shows a temporary number
 * (OFFLINE-xxxxxx); the real order number is assigned when the sale syncs.
 */
export default function OfflineReceiptModal({ receipt, onClose }: Props) {
  const { settings } = useSiteSettings();
  const receiptRef = useRef<HTMLDivElement>(null);
  const number = offlineReceiptNumber(receipt.outboxId);

  const handlePrint = () => {
    if (!receiptRef.current) return;
    const printWindow = window.open('', '_blank', 'width=300,height=600');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Receipt</title>
          <style>
            body { font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; margin: 0 auto; padding: 8px; }
          </style>
        </head>
        <body>${receiptRef.current.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    // No inline <script> in the popup (nonce CSP) — print from the opener.
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="offline-receipt-title">
      <div className="bg-[hsl(var(--card))] rounded-xl w-full max-w-sm shadow-2xl mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 id="offline-receipt-title" className="font-semibold text-[hsl(var(--foreground))]">
            Receipt
          </h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-brand-gold text-black text-xs font-medium"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button type="button" onClick={onClose} aria-label="Close receipt" className="text-[hsl(var(--muted-foreground))]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Offline sale — will sync.</span> Saved on this device and sent to the server
            automatically when the connection is back. The order number is assigned then.
          </p>
        </div>

        <div className="p-4 max-h-[65vh] overflow-y-auto">
          <div ref={receiptRef}>
            <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '16px', marginBottom: '4px' }}>
              {settings.businessName.toUpperCase()}
            </div>
            <div style={{ textAlign: 'center', fontSize: '11px', color: '#666', marginBottom: '8px' }}>{settings.contactAddress}</div>
            <div style={{ borderTop: '1px dashed #ccc', margin: '8px 0' }} />

            <div style={{ fontSize: '11px', marginBottom: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Receipt:</span>
                <span style={{ fontWeight: 'bold' }}>{number}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Date:</span>
                <span>{new Date(receipt.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Customer:</span>
                <span>{receipt.customer}</span>
              </div>
              {receipt.customerPhone && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Phone:</span>
                  <span>{receipt.customerPhone}</span>
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px dashed #ccc', margin: '8px 0' }} />

            <div style={{ fontSize: '11px' }}>
              {receipt.items.map((item, i) => (
                <div key={i} style={{ marginBottom: '4px' }}>
                  <div>{item.name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666' }}>
                    <span>
                      {item.variant} x{item.quantity} @ {money(item.unitPrice)}
                    </span>
                    <span style={{ fontWeight: 'bold' }}>{money(item.total)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px dashed #ccc', margin: '8px 0' }} />

            <div style={{ fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Subtotal</span>
                <span>{money(receipt.subtotal)} TZS</span>
              </div>
              {receipt.discount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
                  <span>Discount</span>
                  <span>-{money(receipt.discount)} TZS</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', marginTop: '4px' }}>
                <span>TOTAL</span>
                <span>{money(receipt.total)} TZS</span>
              </div>
            </div>

            <div style={{ borderTop: '1px dashed #ccc', margin: '8px 0' }} />

            <div style={{ fontSize: '11px' }}>
              {receipt.payments.map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                    {p.transactionRef ? ` (${p.transactionRef})` : ''}
                  </span>
                  <span>{money(p.amount)} TZS</span>
                </div>
              ))}
              {receipt.changeDue > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginTop: '4px' }}>
                  <span>Change</span>
                  <span>{money(receipt.changeDue)} TZS</span>
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px dashed #ccc', margin: '12px 0 8px' }} />
            <div style={{ textAlign: 'center', fontSize: '10px', color: '#666', marginBottom: '4px' }}>
              Offline sale — recorded on this device, pending sync.
            </div>
            <div style={{ textAlign: 'center', fontSize: '11px', color: '#666' }}>Thank you for shopping at {settings.businessName}!</div>
          </div>
        </div>
      </div>
    </div>
  );
}
