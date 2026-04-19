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
        // Scale bar width down for longer codes so the SVG stays narrow enough
        // to fit inside the 50mm label without overflowing the preview card.
        const barWidth = barcode.length > 20 ? 0.9 : barcode.length > 12 ? 1.2 : 1.6;
        JsBarcode(svgRef.current, barcode, {
          format: 'CODE128',
          width: barWidth,
          height: 36,
          displayValue: true,
          fontSize: 9,
          margin: 2,
          textMargin: 1,
        });
      } catch {
        // Invalid barcode value — leave empty
      }
    }
  }, [barcode]);

  const details = [size, color].filter(Boolean).join(' / ');

  return (
    <div
      className="barcode-label inline-flex flex-col items-center justify-between border border-[hsl(var(--border))] rounded p-2 bg-white text-black text-center overflow-hidden"
      style={{ width: '50mm', minHeight: '30mm' }}
    >
      <div className="w-full">
        <p className="text-[9px] font-semibold truncate leading-tight">{productName}</p>
        {(variantName || details) && (
          <p className="text-[8px] text-gray-500 truncate leading-tight">{variantName || details}</p>
        )}
      </div>
      <div className="flex-1 w-full flex items-center justify-center my-1 overflow-hidden">
        <svg
          ref={svgRef}
          className="block max-w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
        />
      </div>
      <p className="text-xs font-bold w-full">{Number(price).toLocaleString()} TZS</p>
    </div>
  );
}
