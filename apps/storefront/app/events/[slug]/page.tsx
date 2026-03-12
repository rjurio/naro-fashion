'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  X,
  ChevronLeft,
  ChevronRight,
  Instagram,
  Facebook,
  Play,
} from 'lucide-react';
import { eventsApi } from '@/lib/api';

interface MediaItem {
  id: string;
  url: string;
  type: string; // IMAGE or VIDEO
  caption?: string;
  sortOrder: number;
}

interface EventDetail {
  id: string;
  title: string;
  slug: string;
  description?: string;
  coverImage: string;
  eventDate: string;
  location?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  tiktokUrl?: string;
  media: MediaItem[];
  product?: { id: string; name: string; slug: string };
  user?: { firstName: string; lastName: string };
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.18 8.18 0 004.76 1.52V6.82a4.83 4.83 0 01-1-.13z" />
    </svg>
  );
}

function Skeleton() {
  return (
    <div className="min-h-screen">
      <div className="relative aspect-[21/9] bg-muted animate-pulse" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-4">
        <div className="h-4 bg-muted animate-pulse rounded w-24" />
        <div className="h-8 bg-muted animate-pulse rounded w-1/2" />
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="break-inside-avoid mb-4 rounded-lg bg-muted animate-pulse"
              style={{ height: `${200 + (i % 3) * 80}px` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function EventDetailPage() {
  const params = useParams();
  const slug = params?.slug as string;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const data = await eventsApi.getBySlug(slug);
        setEvent(data);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  // Lightbox keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (lightboxIndex === null || !event) return;
      const imageMedia = event.media.filter((m) => m.type !== 'VIDEO');
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowRight') setLightboxIndex((prev) => (prev !== null ? (prev + 1) % imageMedia.length : null));
      if (e.key === 'ArrowLeft') setLightboxIndex((prev) => (prev !== null ? (prev - 1 + imageMedia.length) % imageMedia.length : null));
    },
    [lightboxIndex, event],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (loading) return <Skeleton />;

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-heading font-bold mb-2">Event not found</h1>
          <Link href="/events" className="text-gold-500 hover:underline">
            Back to galleries
          </Link>
        </div>
      </div>
    );
  }

  const imageMedia = event.media?.filter((m) => m.type !== 'VIDEO') || [];
  const allMedia = event.media || [];

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative aspect-[21/9] min-h-[280px] max-h-[520px] overflow-hidden">
        <Image
          src={event.coverImage || '/placeholder-event.jpg'}
          alt={event.title}
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10" />
        <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-10 lg:p-14">
          <div className="max-w-7xl mx-auto">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-bold text-white mb-3">
              {event.title}
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-white/80 text-sm sm:text-base">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-gold-500" />
                {new Date(event.eventDate).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              {event.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-gold-500" />
                  {event.location}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Back + Meta row */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <Link
            href="/events"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-gold-500 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            All Galleries
          </Link>

          <div className="flex items-center gap-2">
            {event.instagramUrl && (
              <a
                href={event.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-9 w-9 rounded-full border border-border hover:border-gold-500 hover:text-gold-500 transition-colors"
              >
                <Instagram className="h-4 w-4" />
              </a>
            )}
            {event.facebookUrl && (
              <a
                href={event.facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-9 w-9 rounded-full border border-border hover:border-gold-500 hover:text-gold-500 transition-colors"
              >
                <Facebook className="h-4 w-4" />
              </a>
            )}
            {event.tiktokUrl && (
              <a
                href={event.tiktokUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-9 w-9 rounded-full border border-border hover:border-gold-500 hover:text-gold-500 transition-colors"
              >
                <TikTokIcon className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>

        {/* Description */}
        {event.description && (
          <p className="text-foreground/80 text-base sm:text-lg leading-relaxed mb-8 max-w-3xl">
            {event.description}
          </p>
        )}

        {/* Product attribution */}
        {event.product && (
          <div className="mb-8 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gold-500/10 border border-gold-500/20">
            <span className="text-sm text-foreground/70">Wearing our</span>
            <Link
              href={`/products/${event.product.slug}`}
              className="text-sm font-semibold text-gold-500 hover:underline"
            >
              {event.product.name}
            </Link>
          </div>
        )}

        {/* Masonry Gallery */}
        {allMedia.length > 0 && (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
            {allMedia.map((media, index) => {
              if (media.type === 'VIDEO') {
                return (
                  <div
                    key={media.id}
                    className="break-inside-avoid mb-4 rounded-lg overflow-hidden bg-black"
                  >
                    <video
                      src={media.url}
                      controls
                      className="w-full"
                      preload="metadata"
                    />
                    {media.caption && (
                      <p className="px-3 py-2 text-xs text-white/60 bg-black">
                        {media.caption}
                      </p>
                    )}
                  </div>
                );
              }

              const imageIndex = imageMedia.findIndex((m) => m.id === media.id);

              return (
                <div
                  key={media.id}
                  className="break-inside-avoid mb-4 rounded-lg overflow-hidden cursor-pointer group relative"
                  onClick={() => setLightboxIndex(imageIndex)}
                >
                  <img
                    src={media.url}
                    alt={media.caption || event.title}
                    className="w-full transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
                  {media.caption && (
                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <p className="text-xs text-white">{media.caption}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {allMedia.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground">No photos available yet.</p>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && imageMedia.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Close */}
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 z-50 flex items-center justify-center h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Prev */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex((prev) =>
                prev !== null ? (prev - 1 + imageMedia.length) % imageMedia.length : null,
              );
            }}
            className="absolute left-2 sm:left-6 z-50 flex items-center justify-center h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          {/* Image */}
          <div
            className="relative max-w-[90vw] max-h-[85vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={imageMedia[lightboxIndex].url}
              alt={imageMedia[lightboxIndex].caption || event.title}
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
          </div>

          {/* Next */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex((prev) =>
                prev !== null ? (prev + 1) % imageMedia.length : null,
              );
            }}
            className="absolute right-2 sm:right-6 z-50 flex items-center justify-center h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          {/* Counter */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/70 text-sm font-medium bg-black/50 px-4 py-1.5 rounded-full">
            {lightboxIndex + 1} / {imageMedia.length}
          </div>
        </div>
      )}
    </div>
  );
}
