'use client';

import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface Props {
  productName: string;
  variantName?: string;
  barcode: string;
  price: number;
  size?: string;
  color?: string;
}

export default function BarcodeLabel({ productName, variantName, barcode, price, size, color }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && barcode) {
      try {
        JsBarcode(svgRef.current, barcode, {
          format: 'CODE128',
          width: 1.5,
          height: 40,
          displayValue: true,
          fontSize: 10,
          margin: 2,
          textMargin: 2,
        });
      } catch {
        // Invalid barcode value — leave empty
      }
    }
  }, [barcode]);

  const details = [size, color].filter(Boolean).join(' / ');

  return (
    <div className="barcode-label inline-block border border-[hsl(var(--border))] rounded p-2 bg-white text-black text-center" style={{ width: '50mm', minHeight: '30mm' }}>
      <p className="text-[9px] font-semibold truncate leading-tight">{productName}</p>
      {(variantName || details) && (
        <p className="text-[8px] text-gray-500 truncate">{variantName || details}</p>
      )}
      <svg ref={svgRef} className="mx-auto my-1" />
      <p className="text-xs font-bold">{Number(price).toLocaleString()} TZS</p>
    </div>
  );
}
