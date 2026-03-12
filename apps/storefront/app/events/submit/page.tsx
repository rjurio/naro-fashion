'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Camera,
  Plus,
  X,
  CheckCircle,
  Clock,
  XCircle,
  Send,
} from 'lucide-react';
import { eventsApi } from '@/lib/api';

interface ExistingEvent {
  id: string;
  title: string;
  status: string;
  rejectionReason?: string;
}

export default function SubmitEventPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [existingEvent, setExistingEvent] = useState<ExistingEvent | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [location, setLocation] = useState('');
  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [productId, setProductId] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!t) {
      router.push('/auth/login');
      return;
    }
    setToken(t);

    (async () => {
      try {
        const data = await eventsApi.getMyEvent();
        setExistingEvent(data);
      } catch {
        // No existing event — show form
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  function addUrl() {
    const url = newUrl.trim();
    if (url && !imageUrls.includes(url)) {
      setImageUrls((prev) => [...prev, url]);
      setNewUrl('');
    }
  }

  function removeUrl(index: number) {
    setImageUrls((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || submitting) return;
    setSubmitting(true);

    try {
      const eventData = {
        title,
        description,
        eventDate,
        location,
        instagramUrl: instagram || undefined,
        facebookUrl: facebook || undefined,
        tiktokUrl: tiktok || undefined,
        productId: productId || undefined,
      };

      const created = await eventsApi.submit(eventData);

      // Add media
      for (const url of imageUrls) {
        try {
          await eventsApi.addMedia(created.id, {
            url,
            type: url.match(/\.(mp4|webm|mov)$/i) ? 'VIDEO' : 'IMAGE',
          });
        } catch {
          // continue
        }
      }

      setSuccess(true);
    } catch {
      alert('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Show existing event status
  if (existingEvent) {
    const statusConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
      PENDING_APPROVAL: {
        icon: <Clock className="h-8 w-8 text-yellow-500" />,
        color: 'border-yellow-500/30 bg-yellow-500/5',
        label: 'Pending Review',
      },
      APPROVED: {
        icon: <CheckCircle className="h-8 w-8 text-green-500" />,
        color: 'border-green-500/30 bg-green-500/5',
        label: 'Approved',
      },
      REJECTED: {
        icon: <XCircle className="h-8 w-8 text-red-500" />,
        color: 'border-red-500/30 bg-red-500/5',
        label: 'Rejected',
      },
    };

    const config = statusConfig[existingEvent.status] || statusConfig.PENDING_APPROVAL;

    return (
      <div className="min-h-screen">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
          <Link
            href="/events"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-gold-500 transition-colors mb-8"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Galleries
          </Link>

          <h1 className="text-3xl font-heading font-bold mb-8">Your Submission</h1>

          <div className={`rounded-xl border ${config.color} p-6 sm:p-8 text-center`}>
            {config.icon}
            <h2 className="text-xl font-heading font-semibold mt-4 mb-1">{existingEvent.title}</h2>
            <p className="text-sm font-medium text-muted-foreground mb-4">Status: {config.label}</p>
            {existingEvent.status === 'REJECTED' && existingEvent.rejectionReason && (
              <div className="mt-4 p-4 rounded-lg bg-red-500/10 text-sm text-red-600 dark:text-red-400">
                <strong>Reason:</strong> {existingEvent.rejectionReason}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md mx-auto px-4 text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-heading font-bold mb-3">Gallery Submitted!</h1>
          <p className="text-muted-foreground mb-6">
            Your gallery has been submitted for review. It will be published within 24-48 hours after
            approval.
          </p>
          <Link
            href="/events"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gold-500 text-white font-medium hover:bg-gold-600 transition-colors"
          >
            View Galleries
          </Link>
        </div>
      </div>
    );
  }

  // Submission form
  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <Link
          href="/events"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-gold-500 transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Galleries
        </Link>

        <div className="mb-8">
          <Camera className="h-8 w-8 text-gold-500 mb-3" />
          <h1 className="text-3xl sm:text-4xl font-heading font-bold">
            Share Your <span className="text-gold-500">Wedding Story</span>
          </h1>
          <p className="text-muted-foreground mt-2">
            Fill in the details below and upload your beautiful wedding photos.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Sarah & John's Garden Wedding"
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Description</label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us about your special day..."
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500 resize-none"
            />
          </div>

          {/* Date + Location row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Event Date *</label>
              <input
                type="date"
                required
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g., Dar es Salaam"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500"
              />
            </div>
          </div>

          {/* Social links */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Social Links</label>
            <div className="space-y-3">
              <input
                type="url"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder="Instagram URL"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500"
              />
              <input
                type="url"
                value={facebook}
                onChange={(e) => setFacebook(e.target.value)}
                placeholder="Facebook URL"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500"
              />
              <input
                type="url"
                value={tiktok}
                onChange={(e) => setTiktok(e.target.value)}
                placeholder="TikTok URL"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500"
              />
            </div>
          </div>

          {/* Product */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Product Name or ID</label>
            <input
              type="text"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder="Enter the name or ID of the gown you wore"
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500"
            />
            <p className="text-xs text-muted-foreground mt-1">
              If you purchased or rented from us, enter the product name or order ID.
            </p>
          </div>

          {/* Image URLs */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Photo URLs</label>
            <div className="space-y-2 mb-3">
              {imageUrls.map((url, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border text-sm"
                >
                  <span className="truncate flex-1 text-foreground/80">{url}</span>
                  <button
                    type="button"
                    onClick={() => removeUrl(i)}
                    className="text-red-500 hover:text-red-600 shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="Paste image URL..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addUrl();
                  }
                }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500"
              />
              <button
                type="button"
                onClick={addUrl}
                className="px-4 py-2.5 rounded-xl border border-border hover:bg-muted transition-colors"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Add URLs for your wedding photos. Supported: images and video files.
            </p>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !title || !eventDate}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gold-500 text-white font-semibold hover:bg-gold-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-5 w-5" />
                Submit Gallery
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
