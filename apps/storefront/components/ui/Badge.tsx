"use client";

import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "new" | "sale" | "rent";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-muted text-muted-foreground",
  new: "bg-gold-500 text-white",
  sale: "bg-red-500 text-white animate-flash-pulse",
  rent: "bg-gold-500 text-dark-500",
};

export default function Badge({
  variant = "default",
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
