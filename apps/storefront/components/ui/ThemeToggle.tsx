"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

const themes = ["light", "dark", "standard"] as const;
type Theme = (typeof themes)[number];

const themeIcons: Record<Theme, React.ReactNode> = {
  light: <Sun className="h-4 w-4" />,
  dark: <Moon className="h-4 w-4" />,
  standard: <Monitor className="h-4 w-4" />,
};

const themeLabels: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  standard: "Standard",
};

export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted",
          className,
        )}
        aria-label="Toggle theme"
      >
        <Sun className="h-4 w-4" />
      </button>
    );
  }

  const currentTheme = (theme as Theme) || "light";
  const currentIndex = themes.indexOf(currentTheme);
  const nextTheme = themes[(currentIndex + 1) % themes.length];

  return (
    <button
      onClick={() => setTheme(nextTheme)}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted",
        className,
      )}
      aria-label={`Switch to ${themeLabels[nextTheme]} theme`}
      title={`Current: ${themeLabels[currentTheme]}. Click for ${themeLabels[nextTheme]}`}
    >
      {themeIcons[currentTheme]}
      <span className="hidden sm:inline text-xs">{themeLabels[currentTheme]}</span>
    </button>
  );
}
