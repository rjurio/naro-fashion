'use client';

import { useState, useRef, useCallback } from 'react';
import { Download, Printer } from 'lucide-react';
import Modal from '../ui/Modal';
import BarcodeLabel from './BarcodeLabel';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';

interface Variant {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  price: number;
  size?: string | null;
  color?: string | null;
}

interface Props {
  productName: string;
  productSku?: string | null;
  variants: Variant[];
  onClose: () => void;
}

export default function BarcodeModal({ productName, productSku, variants, onClose }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>(
    () => Object.fromEntries(variants.map((v) => [v.id, 1]))
  );

  const getBarcodeValue = (v: Variant) => v.barcode || v.sku || productSku || v.id.substring(0, 12);

  const generatePdf = useCallback(() => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const labelW = 50;
    const labelH = 30;
    const cols = 3;
    const rows = 9;
    const marginX = (210 - cols * labelW) / 2;
    const marginY = (297 - rows * labelH) / 2;

    let col = 0;
    let row = 0;

    const addLabel = (v: Variant) => {
      const x = marginX + col * labelW;
      const y = marginY + row * labelH;

      // Border
      doc.setDrawColor(200);
      doc.rect(x, y, labelW, labelH);

      // Product name
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      const truncName = productName.length > 25 ? productName.substring(0, 25) + '...' : productName;
      doc.text(truncName, x + labelW / 2, y + 4, { align: 'center' });

      // Variant info
      const details = [v.size, v.color].filter(Boolean).join(' / ');
      if (details || v.name) {
        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.text(v.name || details, x + labelW / 2, y + 7, { align: 'center' });
      }

      // Barcode as SVG → canvas → image
      const barcodeValue = getBarcodeValue(v);
      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      try {
        JsBarcode(svgEl, barcodeValue, {
          format: 'CODE128',
          width: 1.2,
          height: 30,
          displayValue: true,
          fontSize: 8,
          margin: 0,
          textMargin: 1,
        });

        const svgStr = new XMLSerializer().serializeToString(svgEl);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + btoa(svgStr);

        // Sync draw — works because SVG is data URI
        canvas.width = parseInt(svgEl.getAttribute('width') || '200');
        canvas.height = parseInt(svgEl.getAttribute('height') || '50');
        ctx?.drawImage(img, 0, 0);

        const barcodeImg = canvas.toDataURL('image/png');
        const barcodeW = 40;
        const barcodeH = 14;
        doc.addImage(barcodeImg, 'PNG', x + (labelW - barcodeW) / 2, y + 9, barcodeW, barcodeH);
      } catch {
        doc.setFontSize(6);
        doc.text(barcodeValue, x + labelW / 2, y + 16, { align: 'center' });
      }

      // Price
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`${Number(v.price).toLocaleString()} TZS`, x + labelW / 2, y + 27, { align: 'center' });

      col++;
      if (col >= cols) {
        col = 0;
        row++;
        if (row >= rows) {
          doc.addPage();
          row = 0;
        }
      }
    };

    variants.forEach((v) => {
      const qty = quantities[v.id] || 1;
      for (let i = 0; i < qty; i++) {
        addLabel(v);
      }
    });

    return doc;
  }, [variants, quantities, productName, productSku]);

  const handleDownload = () => {
    const doc = generatePdf();
    doc.save(`${productName.replace(/\s+/g, '_')}_barcodes.pdf`);
  };

  const handlePrint = () => {
    const doc = generatePdf();
    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const win = window.open(pdfUrl);
    if (win) {
      win.addEventListener('load', () => {
        win.print();
      });
    }
  };

  return (
    <Modal title="Barcode Labels" size="lg" onClose={onClose}>
      <div className="space-y-4">
        {/* Variant list with quantity selector */}
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {variants.map((v) => (
            <div key={v.id} className="flex items-center justify-between p-3 rounded-lg border border-[hsl(var(--border))]">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[hsl(var(--foreground))] truncate">{v.name}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {getBarcodeValue(v)} • {Number(v.price).toLocaleString()} TZS
                </p>
              </div>
              <div className="flex items-center gap-2 ml-3">
                <label className="text-xs text-[hsl(var(--muted-foreground))]">Qty:</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={quantities[v.id] || 1}
                  onChange={(e) => setQuantities({ ...quantities, [v.id]: Math.max(1, Number(e.target.value)) })}
                  className="w-14 px-2 py-1 text-xs text-center rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Preview */}
        <div className="p-4 rounded-lg bg-[hsl(var(--accent))] overflow-x-auto">
          <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">Preview (first variant):</p>
          {variants[0] && (
            <BarcodeLabel
              productName={productName}
              variantName={variants[0].name}
              barcode={getBarcodeValue(variants[0])}
              price={Number(variants[0].price)}
              size={variants[0].size || undefined}
              color={variants[0].color || undefined}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]"
          >
            Close
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-brand-gold text-brand-gold hover:bg-brand-gold/10"
          >
            <Download className="w-4 h-4" />
            Download PDF
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-brand-gold text-black font-medium hover:bg-brand-gold/90"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>
      </div>
    </Modal>
  );
}
