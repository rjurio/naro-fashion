'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Calendar, MapPin, Camera } from 'lucide-react';
import { eventsApi } from '@/lib/api';

interface EventItem {
  id: string;
  title: string;
  slug: string;
  coverImage: string;
  eventDate: string;
  location: string;
}

interface EventsResponse {
  data: EventItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden bg-card border border-border">
      <div className="aspect-[4/3] bg-muted animate-pulse" />
      <div className="p-4 space-y-2">
        <div className="h-5 bg-muted animate-pulse rounded w-3/4" />
        <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
      </div>
    </div>
  );
}

export default function EventsPage() {
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
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900 py-20 sm:py-28">
        <div className="absolute inset-0 bg-[url('/pattern.png')] opacity-5" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Camera className="h-10 w-10 text-gold-500 mx-auto mb-4" />
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-heading font-bold text-white mb-4">
            Real <span className="text-gold-500">Weddings</span>
          </h1>
          <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto">
            See our beautiful brides and their special moments
          </p>
          <div className="mt-6 h-1 w-20 bg-gold-500 mx-auto rounded-full" />
        </div>
      </section>

      {/* Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-20">
            <Camera className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="text-xl font-heading font-semibold text-foreground mb-2">No galleries yet</h2>
            <p className="text-muted-foreground">Check back soon for beautiful wedding stories.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.map((event) => (
                <Link
                  key={event.id}
                  href={`/events/${event.slug}`}
                  className="group rounded-xl overflow-hidden bg-card border border-border hover:border-gold-500/50 transition-all duration-300 hover:shadow-xl hover:shadow-gold-500/5"
                >
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <Image
                      src={event.coverImage || '/placeholder-event.jpg'}
                      alt={event.title}
                      fill
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-4 border-l-4 border-gold-500">
                      <h3 className="text-white font-heading font-semibold text-lg leading-tight mb-1">
                        {event.title}
                      </h3>
                      <div className="flex items-center gap-3 text-white/70 text-sm">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {new Date(event.eventDate).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                        {event.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {event.location}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {page < totalPages && (
              <div className="text-center mt-10">
                <button
                  onClick={() => fetchEvents(page + 1)}
                  disabled={loadingMore}
                  className="px-8 py-3 rounded-xl bg-dark-800 text-white font-medium hover:bg-dark-700 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* CTA */}
      {isLoggedIn && (
        <section className="bg-gradient-to-r from-dark-900 to-dark-800 py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-heading font-bold text-white mb-3">
              Share Your <span className="text-gold-500">Story</span>
            </h2>
            <p className="text-white/60 mb-6 max-w-lg mx-auto">
              Wore one of our gowns on your special day? We would love to feature your wedding in our gallery.
            </p>
            <Link
              href="/events/submit"
              className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-gold-500 text-white font-semibold hover:bg-gold-600 transition-colors"
            >
              <Camera className="h-5 w-5" />
              Submit Your Gallery
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
