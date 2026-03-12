'use client';

// Sales history page breaks out of the POS full-screen layout
export default function PosSalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] bg-[hsl(var(--background))] overflow-auto">
      {children}
    </div>
  );
}
