"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface ModelViewerProps {
  src: string;
  poster?: string;
  alt: string;
}

export default function ModelViewer({ src, poster, alt }: ModelViewerProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Dynamically import the model-viewer web component library
    import("@google/model-viewer").catch(() => {
      // model-viewer package not installed — fail silently
      console.warn("@google/model-viewer could not be loaded.");
    });
  }, []);

  return (
    <div className="relative w-full h-full">
      {/* Loading spinner shown behind model-viewer until it reports loaded */}
      {!isLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted rounded-2xl z-0">
          <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
          <span className="text-sm text-muted-foreground">Loading 3D model...</span>
        </div>
      )}

      <model-viewer
        src={src}
        alt={alt}
        poster={poster}
        camera-controls=""
        auto-rotate=""
        ar=""
        ar-modes="webxr scene-viewer quick-look"
        loading="lazy"
        shadow-intensity="1"
        environment-image="neutral"
        exposure="1"
        style={{
          width: "100%",
          height: "100%",
          minHeight: "300px",
        }}
        onLoad={() => setIsLoaded(true)}
      />
    </div>
  );
}
