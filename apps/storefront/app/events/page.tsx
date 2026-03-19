'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Calendar, MapPin, Camera, ArrowRight, Heart, Loader2 } from 'lucide-react';
import { eventsApi } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

function resolveImageUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

interface EventItem {
  id: string;
  title: string;
  slug: string;
  coverImageUrl?: string;
  eventDate: string;
  location?: string;
  customerName?: string;
  media?: { url: string; mediaType: string }[];
}

interface EventsResponse {
  data: EventItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

function getEventImage(event: EventItem): string {
  // Priority: coverImageUrl → first media image → empty
  const cover = resolveImageUrl(event.coverImageUrl);
  if (cover) return cover;
  const firstMedia = event.media?.find((m) => m.mediaType === 'IMAGE');
  if (firstMedia) return resolveImageUrl(firstMedia.url);
  return '';
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl overflow-hidden bg-card border border-border">
      <div className="aspect-[3/4] bg-muted animate-pulse" />
    </div>
  );
}

export default function EventsPage() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsLoggedIn(!!localStorage.getItem('token'));
    }
    fetchEvents(1);
  }, []);

  async function fetchEvents(p: number) {
    try {
      if (p === 1) setLoading(true);
      else setLoadingMore(true);
      const res: EventsResponse = await eventsApi.getAll({ page: p, limit: 9 });
      if (p === 1) {
        setEvents(res.data || []);
      } else {
        setEvents((prev) => [...prev, ...(res.data || [])]);
      }
      setTotalPages(res.meta?.totalPages ?? 1);
      setPage(p);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative bg-[#1A1A1A] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A]" />
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-gold-500/5 blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-gold-500/5 blur-[120px]" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-gold-500/15 px-4 py-1.5 text-sm text-gold-500 border border-gold-500/20 mb-6">
            <Heart className="h-4 w-4" />
            Customer Gallery
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-heading font-bold text-white mb-4">
            Real <span className="text-gold-500">Weddings</span>
          </h1>
          <p className="text-lg text-white/60 max-w-xl mx-auto">
            Celebrating love stories featuring our gowns. See how our brides shined on their special day.
          </p>
        </div>
      </section>

      {/* Gallery Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Camera className="h-10 w-10 text-muted-foreground/50" />
            </div>
            <h2 className="text-xl font-heading font-semibold text-foreground mb-2">No galleries yet</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              We&apos;re collecting beautiful wedding stories. Check back soon or submit your own!
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {events.map((event) => {
                const imageUrl = getEventImage(event);
                return (
                  <Link
                    key={event.id}
                    href={`/events/${event.slug}`}
                    className="group relative rounded-2xl overflow-hidden bg-[#1A1A1A] border border-border hover:border-gold-500/40 transition-all duration-300 hover:shadow-xl hover:shadow-gold-500/5"
                  >
                    {/* Image */}
                    <div className="relative aspect-[3/4] overflow-hidden">
                      {imageUrl ? (
                        <Image
                          src={imageUrl}
                          alt={event.title}
                          fill
                          className="object-cover transition-transform duration-700 group-hover:scale-105"
                          sizes="(max-width: 768px) 50vw, 33vw"
                          unoptimized
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                          <Camera className="h-12 w-12 text-muted-foreground/30" />
                        </div>
                      )}

                      {/* Gradient overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

                      {/* Content overlay */}
                      <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5">
                        <h3 className="text-white font-heading font-semibold text-base sm:text-lg leading-tight mb-2">
                          {event.title}
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-white/60 text-xs sm:text-sm">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 flex-shrink-0" />
                            {new Date(event.eventDate).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </span>
                          {event.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3 flex-shrink-0" />
                              {event.location}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Hover arrow indicator */}
                      <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="h-4 w-4 text-white" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Load More */}
            {page < totalPages && (
              <div className="text-center mt-12">
                <button
                  onClick={() => fetchEvents(page + 1)}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 px-8 py-3 rounded-xl border border-border bg-card text-foreground font-medium hover:border-gold-500/50 hover:text-gold-500 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Loading...</>
                  ) : (
                    'Load More Stories'
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* CTA — Share your story */}
      {isLoggedIn && (
        <section className="border-t border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-[#1A1A1A] via-[#2d1a2e] to-[#1A1A1A] p-8 sm:p-12 text-center">
              <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-gold-500/10 blur-[80px]" />
              <div className="relative">
                <Heart className="h-8 w-8 text-gold-500 mx-auto mb-4" />
                <h2 className="text-2xl sm:text-3xl font-heading font-bold text-white mb-3">
                  Share Your <span className="text-gold-500">Story</span>
                </h2>
                <p className="text-white/50 mb-8 max-w-lg mx-auto">
                  Wore one of our gowns on your special day? We&apos;d love to feature your celebration in our gallery.
                </p>
                <Link
                  href="/events/submit"
                  className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-gold-500 text-[#1A1A1A] font-semibold hover:bg-gold-600 transition-colors"
                >
                  <Camera className="h-5 w-5" />
                  Submit Your Gallery
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
