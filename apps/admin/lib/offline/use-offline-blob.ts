'use client';

/**
 * Previews for photos kept on the device (`offline-blob://<id>`, see
 * lib/offline/blobs.ts). Browsers can't load that scheme, so the blob is read
 * from IndexedDB and shown through an object URL (revoked on unmount / change).
 * Once the photo has been uploaded by the sync engine the blob record carries
 * `uploadedUrl`, which is used instead.
 */
import { useEffect, useState } from 'react';
import { blobIdFromUrl, getBlobRecord, isOfflineBlobUrl } from './blobs';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

/** Server-relative upload paths (`/uploads/...`) → absolute URL on the API origin. */
export function resolveServerImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('/')) return `${API_ORIGIN}${url}`;
  return url;
}

/**
 * `src` usable in an <img>: offline blobs become object URLs, server paths get
 * the API origin. Returns '' while an offline blob is still loading (or gone).
 */
export function useResolvedImageSrc(url: string | null | undefined): string {
  const isBlob = isOfflineBlobUrl(url);
  const [blobSrc, setBlobSrc] = useState('');

  useEffect(() => {
    if (!isBlob || !url) {
      setBlobSrc('');
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    const id = blobIdFromUrl(url);
    if (!id) return;
    void getBlobRecord(id).then((rec) => {
      if (cancelled || !rec) return;
      if (rec.uploadedUrl) {
        setBlobSrc(resolveServerImageUrl(rec.uploadedUrl));
        return;
      }
      try {
        objectUrl = URL.createObjectURL(rec.blob);
        setBlobSrc(objectUrl);
      } catch {
        setBlobSrc('');
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isBlob, url]);

  if (!url) return '';
  return isBlob ? blobSrc : resolveServerImageUrl(url);
}
