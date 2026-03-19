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
  Camera,
  Heart,
} from 'lucide-react';
import { eventsApi } from '@/lib/api';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

function resolveUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

interface MediaItem {
  id: string;
  url: string;
  mediaType: string;
  caption?: string;
  altText?: string;
  sortOrder: number;
}

interface EventDetail {
  id: string;
  title: string;
  slug: string;
  description?: string;
  coverImageUrl?: string;
  eventDate: string;
  location?: string;
  customerName?: string;
  socialLinks?: { instagram?: string; facebook?: string; tiktok?: string };
  media: MediaItem[];
  product?: { id: string; name: string; slug: string; images?: { url: string }[] };
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
    <div className="min-h-screen bg-background">
      <div className="relative h-[50vh] bg-muted animate-pulse" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-4">
        <div className="h-4 bg-muted animate-pulse rounded w-24" />
        <div className="h-6 bg-muted animate-pulse rounded w-2/3" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-muted animate-pulse"
              style={{ height: `${220 + (i % 3) * 60}px` }}
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
      const images = event.media.filter((m) => m.mediaType === 'IMAGE');
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowRight') setLightboxIndex((prev) => (prev !== null ? (prev + 1) % images.length : null));
      if (e.key === 'ArrowLeft') setLightboxIndex((prev) => (prev !== null ? (prev - 1 + images.length) % images.length : null));
    },
    [lightboxIndex, event],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Lock body scroll when lightbox is open
  useEffect(() => {
    if (lightboxIndex !== null) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [lightboxIndex]);

  if (loading) return <Skeleton />;

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Camera className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <h1 className="text-2xl font-heading font-bold mb-2">Event not found</h1>
          <Link href="/events" className="text-gold-500 hover:underline text-sm">
            Back to galleries
          </Link>
        </div>
      </div>
    );
  }

  const coverImage = resolveUrl(event.coverImageUrl) || (event.media?.[0] ? resolveUrl(event.media[0].url) : '');
  const imageMedia = (event.media || []).filter((m) => m.mediaType === 'IMAGE');
  const allMedia = event.media || [];
  const socialLinks = event.socialLinks || {};
  const hasSocials = socialLinks.instagram || socialLinks.facebook || socialLinks.tiktok;

  return (
    <div className="min-h-screen bg-background">
      {/* Hero banner */}
      <section className="relative h-[40vh] sm:h-[50vh] lg:h-[55vh] min-h-[300px] max-h-[600px] overflow-hidden bg-[#1A1A1A]">
        {coverImage ? (
          <Image
            src={coverImage}
            alt={event.title}
            fill
            className="object-cover"
            priority
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A]">
            <Camera className="h-20 w-20 text-white/10" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10" />

        {/* Back button */}
        <Link
          href="/events"
          className="absolute top-4 left-4 sm:top-6 sm:left-6 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm text-white/80 text-sm hover:bg-black/60 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All Galleries
        </Link>

        {/* Title overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-10 lg:p-14">
          <div className="max-w-7xl mx-auto">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-bold text-white mb-3">
              {event.title}
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-white/70 text-sm sm:text-base">
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
              {event.customerName && (
                <span className="flex items-center gap-1.5">
                  <Heart className="h-4 w-4 text-gold-500" />
                  {event.customerName}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Meta row: description + social + product */}
        <div className="flex flex-col lg:flex-row lg:items-start gap-6 mb-10">
          <div className="flex-1 space-y-4">
            {event.description && (
              <p className="text-foreground/80 text-base sm:text-lg leading-relaxed max-w-3xl">
                {event.description}
              </p>
            )}
            {event.product && (
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gold-500/10 border border-gold-500/20">
                <span className="text-sm text-foreground/70">Wearing our</span>
                <Link
                  href={`/products/${event.product.slug}`}
                  className="text-sm font-semibold text-gold-500 hover:underline"
                >
                  {event.product.name}
                </Link>
              </div>
            )}
          </div>
          {hasSocials && (
            <div className="flex items-center gap-2">
              {socialLinks.instagram && (
                <a
                  href={socialLinks.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center h-10 w-10 rounded-full border border-border hover:border-gold-500 hover:text-gold-500 transition-colors"
                  aria-label="Instagram"
                >
                  <Instagram className="h-4 w-4" />
                </a>
              )}
              {socialLinks.facebook && (
                <a
                  href={socialLinks.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center h-10 w-10 rounded-full border border-border hover:border-gold-500 hover:text-gold-500 transition-colors"
                  aria-label="Facebook"
                >
                  <Facebook className="h-4 w-4" />
                </a>
              )}
              {socialLinks.tiktok && (
                <a
                  href={socialLinks.tiktok}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center h-10 w-10 rounded-full border border-border hover:border-gold-500 hover:text-gold-500 transition-colors"
                  aria-label="TikTok"
                >
                  <TikTokIcon className="h-4 w-4" />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Photo count */}
        {allMedia.length > 0 && (
          <div className="flex items-center gap-2 mb-6">
            <Camera className="h-4 w-4 text-gold-500" />
            <span className="text-sm text-muted-foreground">
              {imageMedia.length} photo{imageMedia.length !== 1 ? 's' : ''}
              {allMedia.length > imageMedia.length && ` + ${allMedia.length - imageMedia.length} video${allMedia.length - imageMedia.length !== 1 ? 's' : ''}`}
            </span>
          </div>
        )}

        {/* Masonry Gallery */}
        {allMedia.length > 0 ? (
          <div className="columns-2 lg:columns-3 gap-3 sm:gap-4">
            {allMedia.map((media) => {
              const mediaUrl = resolveUrl(media.url);

              if (media.mediaType === 'VIDEO') {
                return (
                  <div
                    key={media.id}
                    className="break-inside-avoid mb-3 sm:mb-4 rounded-xl overflow-hidden bg-black"
                  >
                    <video
                      src={mediaUrl}
                      controls
                      className="w-full"
                      preload="metadata"
                    />
                  </div>
                );
              }

              const imageIndex = imageMedia.findIndex((m) => m.id === media.id);

              return (
                <div
                  key={media.id}
                  className="break-inside-avoid mb-3 sm:mb-4 rounded-xl overflow-hidden cursor-pointer group relative"
                  onClick={() => setLightboxIndex(imageIndex)}
                >
                  <img
                    src={mediaUrl}
                    alt={media.altText || media.caption || event.title}
                    className="w-full transition-transform duration-500 group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 rounded-xl" />
                  {media.caption && (
                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <p className="text-xs text-white">{media.caption}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Camera className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-muted-foreground">Photos coming soon for this event.</p>
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
            aria-label="Close lightbox"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Prev */}
          {imageMedia.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((prev) =>
                  prev !== null ? (prev - 1 + imageMedia.length) % imageMedia.length : null,
                );
              }}
              className="absolute left-2 sm:left-6 z-50 flex items-center justify-center h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {/* Image */}
          <div
            className="relative max-w-[90vw] max-h-[85vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={resolveUrl(imageMedia[lightboxIndex].url)}
              alt={imageMedia[lightboxIndex].caption || event.title}
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
          </div>

          {/* Next */}
          {imageMedia.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((prev) =>
                  prev !== null ? (prev + 1) % imageMedia.length : null,
                );
              }}
              className="absolute right-2 sm:right-6 z-50 flex items-center justify-center h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Next image"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          {/* Counter */}
          {imageMedia.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/70 text-sm font-medium bg-black/50 px-4 py-1.5 rounded-full">
              {lightboxIndex + 1} / {imageMedia.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
