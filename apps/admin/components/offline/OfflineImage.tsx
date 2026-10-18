'use client';

import type { ImgHTMLAttributes } from 'react';
import { ImageIcon } from 'lucide-react';
import { isOfflineBlobUrl } from '@/lib/offline/blobs';
import { useResolvedImageSrc } from '@/lib/offline/use-offline-blob';

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** Server URL, `/uploads/...` path, or `offline-blob://<id>` (photo kept on this device). */
  src: string | null | undefined;
  /** Small "on this device" marker on offline photos (default true). */
  showOfflineMark?: boolean;
}

/**
 * <img> that can also show photos picked offline (kept in IndexedDB until the
 * sync engine uploads them). Server-relative paths get the API origin.
 */
export default function OfflineImage({ src, showOfflineMark = true, className, alt, ...rest }: Props) {
  const resolved = useResolvedImageSrc(src);
  const offline = isOfflineBlobUrl(src);

  if (!resolved) {
    return (
      <span
        className={`flex items-center justify-center bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] ${className ?? ''}`}
        title={offline ? 'Photo saved on this device' : undefined}
      >
        <ImageIcon className="w-4 h-4" />
      </span>
    );
  }

  if (!offline || !showOfflineMark) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={resolved} alt={alt ?? ''} className={className} {...rest} />;
  }

  return (
    <span className={`relative block overflow-hidden ${className ?? ''}`} title="Photo saved on this device — uploads when you're back online">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={resolved} alt={alt ?? ''} className="w-full h-full object-cover" {...rest} />
      <span className="absolute bottom-0.5 left-0.5 rounded bg-amber-500/90 px-1 text-[8px] font-semibold uppercase leading-4 text-black">
        Local
      </span>
    </span>
  );
}
