'use client';

export default function PosLayout({ children }: { children: React.ReactNode }) {
  // Full-screen layout - no sidebar/topbar
  return (
    <div className="fixed inset-0 z-50 bg-[hsl(var(--background))]">
      {children}
    </div>
  );
}
