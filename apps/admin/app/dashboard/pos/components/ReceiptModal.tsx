'use client';

import { useEffect, useState, useRef } from 'react';
import { X, Printer } from 'lucide-react';
import adminApi from '../../../../lib/api';
import { PAYMENT_METHOD_LABELS } from '@naro/shared';

interface Props {
  orderId: string;
  onClose: () => void;
}

export default function ReceiptModal({ orderId, onClose }: Props) {
  const [receipt, setReceipt] = useState<any>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    adminApi.posGetReceipt(orderId).then(setReceipt).catch(() => {});
  }, [orderId]);

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
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .line { border-top: 1px dashed #000; margin: 4px 0; }
            .flex { display: flex; justify-content: space-between; }
            .mt { margin-top: 8px; }
          </style>
        </head>
        <body>${receiptRef.current.innerHTML}</body>
        <script>window.print(); window.close();</script>
      </html>
    `);
    printWindow.document.close();
  };

  if (!receipt) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-[hsl(var(--card))] rounded-xl p-6 text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading receipt...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[hsl(var(--card))] rounded-xl w-full max-w-sm shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="font-semibold text-[hsl(var(--foreground))]">Receipt</h3>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-brand-gold text-black text-xs font-medium"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button onClick={onClose} className="text-[hsl(var(--muted-foreground))]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Receipt Content */}
        <div className="p-4 max-h-[70vh] overflow-y-auto">
          <div ref={receiptRef}>
            <div className="center bold" style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '16px', marginBottom: '4px' }}>
              NARO FASHION
            </div>
            <div style={{ textAlign: 'center', fontSize: '11px', color: '#666', marginBottom: '8px' }}>
              Dar es Salaam, Tanzania
            </div>
            <div style={{ borderTop: '1px dashed #ccc', margin: '8px 0' }} />

            <div style={{ fontSize: '11px', marginBottom: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Order:</span>
                <span style={{ fontWeight: 'bold' }}>{receipt.orderNumber}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Date:</span>
                <span>{new Date(receipt.date).toLocaleString()}</span>
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

            {/* Items */}
            <div style={{ fontSize: '11px' }}>
              {receipt.items.map((item: any, i: number) => (
                <div key={i} style={{ marginBottom: '4px' }}>
                  <div>{item.name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666' }}>
                    <span>
                      {item.size || item.color ? `${item.size ?? ''} ${item.color ?? ''}`.trim() : item.variant}
                      {' '} x{item.quantity} @ {item.unitPrice.toLocaleString()}
                    </span>
                    <span style={{ fontWeight: 'bold' }}>{item.total.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px dashed #ccc', margin: '8px 0' }} />

            <div style={{ fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Subtotal</span>
                <span>{receipt.subtotal.toLocaleString()} TZS</span>
              </div>
              {receipt.discount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
                  <span>Discount</span>
                  <span>-{receipt.discount.toLocaleString()} TZS</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', marginTop: '4px' }}>
                <span>TOTAL</span>
                <span>{receipt.total.toLocaleString()} TZS</span>
              </div>
            </div>

            <div style={{ borderTop: '1px dashed #ccc', margin: '8px 0' }} />

            <div style={{ fontSize: '11px' }}>
              {receipt.payments.map((p: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</span>
                  <span>{p.amount.toLocaleString()} TZS</span>
                </div>
              ))}
              {receipt.changeDue > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginTop: '4px' }}>
                  <span>Change</span>
                  <span>{receipt.changeDue.toLocaleString()} TZS</span>
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px dashed #ccc', margin: '12px 0 8px' }} />

            <div style={{ textAlign: 'center', fontSize: '11px', color: '#666' }}>
              Thank you for shopping at Naro Fashion!
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
