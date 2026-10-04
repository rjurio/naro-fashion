'use client';

import { useEffect, useState } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';
import adminApi, { ApiError } from '@/lib/api';

const PRIVATE_PREFIX = 'private://id-documents/';
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

interface PrivateDocumentProps {
  /** `private://id-documents/...` ref, or a legacy public URL/path. */
  src: string | null | undefined;
  alt: string;
  className?: string;
}

/**
 * Renders an ID document. Private refs are fetched with the bearer token via
 * `adminApi.fetchPrivateIdDocument` and shown from a blob: URL (revoked on
 * unmount); PDFs render in an <iframe>. Legacy public URLs render directly.
 */
export default function PrivateDocument({ src, alt, className = '' }: PrivateDocumentProps) {
  const isPrivate = !!src && src.startsWith(PRIVATE_PREFIX);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [mime, setMime] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isPrivate);

  useEffect(() => {
    if (!src || !isPrivate) return;
    let cancelled = false;
    let url: string | null = null;
    setLoading(true);
    setError(null);
    adminApi
      .fetchPrivateIdDocument(src)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setMime(blob.type || '');
        setObjectUrl(url);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError && err.status === 404 ? 'Document unavailable' : err?.message || 'Failed to load document');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, isPrivate]);

  const box = `flex items-center justify-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] ${className}`;

  if (!src) {
    return <div className={box}><span className="text-xs text-[hsl(var(--muted-foreground))]">Not provided</span></div>;
  }

  if (!isPrivate) {
    // Legacy public URL — render as before.
    const legacy = src.startsWith('/') ? `${API_ORIGIN}${src}` : src;
    if (/\.pdf($|\?)/i.test(legacy)) {
      return <iframe src={legacy} title={alt} className={`rounded-lg border border-[hsl(var(--border))] ${className}`} />;
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={legacy} alt={alt} className={`rounded-lg border border-[hsl(var(--border))] object-contain ${className}`} />;
  }

  if (loading) {
    return <div className={box}><Loader2 className="w-5 h-5 animate-spin text-brand-gold" /></div>;
  }
  if (error || !objectUrl) {
    return (
      <div className={`${box} flex-col gap-1`}>
        <FileWarning className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{error || 'Document unavailable'}</span>
      </div>
    );
  }
  if (mime === 'application/pdf') {
    return <iframe src={objectUrl} title={alt} className={`rounded-lg border border-[hsl(var(--border))] ${className}`} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={objectUrl} alt={alt} className={`rounded-lg border border-[hsl(var(--border))] object-contain ${className}`} />;
}
