'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';

interface Props {
  label: string;
  tooltip: string;
  required?: boolean;
  className?: string;
}

export default function InfoLabel({ label, tooltip, required, className }: Props) {
  const [show, setShow] = useState(false);

  return (
    <div className={className || 'block text-xs font-medium text-[hsl(var(--foreground))] mb-1'}>
      <span className="inline-flex items-center gap-1">
        {label}{required ? ' *' : ''}
        <span
          className="relative inline-flex"
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
        >
          <Info className="w-3 h-3 text-[hsl(var(--muted-foreground))] cursor-help" />
          {show && (
            <span className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-1 w-56 px-2.5 py-1.5 text-[11px] font-normal leading-snug rounded-lg bg-[hsl(var(--foreground))] text-[hsl(var(--background))] shadow-lg whitespace-normal pointer-events-none">
              {tooltip}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}
