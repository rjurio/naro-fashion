'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { adminApi } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { FormField } from '@/components/ui/FormField';
import { useToast } from '@/contexts/ToastContext';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Plus,
  Search,
  Camera,
  Calendar,
  MapPin,
  User,
  Package,
  ImageIcon,
  Pencil,
  Trash2,
  CheckCircle,
  XCircle,
  Star,
  Film,
  X,
} from 'lucide-react';

interface EventMedia {
  id: string;
  url: string;
  mediaType: 'IMAGE' | 'VIDEO';
  altText?: string;
}

interface EventItem {
  id: string;
  title: string;
  titleSwahili?: string;
  description?: string;
  descriptionSwahili?: string;
  eventDate?: string;
  location?: string;
  customerName?: string;
  coverImageUrl?: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  isFeatured: boolean;
  productId?: string;
  product?: { name: string };
  socialLinks?: { instagram?: string; facebook?: string; tiktok?: string };
  media?: EventMedia[];
  _count?: { media: number };
  createdAt: string;
}

interface EventFormData {
  title: string;
  titleSwahili: string;
  description: string;
  descriptionSwahili: string;
  eventDate: string;
  location: string;
  customerName: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  coverImageUrl: string;
  productId: string;
  isFeatured: boolean;
}

const emptyForm: EventFormData = {
  title: '',
  titleSwahili: '',
  description: '',
  descriptionSwahili: '',
  eventDate: '',
  location: '',
  customerName: '',
  instagram: '',
  facebook: '',
  tiktok: '',
  coverImageUrl: '',
  productId: '',
  isFeatured: false,
};

type Tab = 'all' | 'pending' | 'featured';

const statusBadgeVariant: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
};

const statusLabel: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export default function EventsPage() {
  const toast = useToast();

  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [pendingCount, setPendingCount] = useState(0);

  // Modal states
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [form, setForm] = useState<EventFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Reject modal
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectEventId, setRejectEventId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // Media management
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState<'IMAGE' | 'VIDEO'>('IMAGE');
  const [addingMedia, setAddingMedia] = useState(false);
  const [showMediaForm, setShowMediaForm] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const [allEvents, pendingEvents] = await Promise.all([
        adminApi.getEvents(),
        adminApi.getPendingEvents(),
      ]);
      setEvents(allEvents || []);
      setPendingCount((pendingEvents || []).length);
    } catch {
      toast.error('Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Filtered events
  const filtered = (events || []).filter((e) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      e.title?.toLowerCase().includes(q) ||
      e.customerName?.toLowerCase().includes(q) ||
      e.location?.toLowerCase().includes(q);

    if (activeTab === 'pending') return matchesSearch && e.status === 'PENDING_APPROVAL';
    if (activeTab === 'featured') return matchesSearch && e.isFeatured;
    return matchesSearch;
  });

  // Open create
  const openCreate = () => {
    setEditingEvent(null);
    setForm(emptyForm);
    setShowMediaForm(false);
    setFormOpen(true);
  };

  // Open edit
  const openEdit = async (event: EventItem) => {
    try {
      const full = await adminApi.getEvent(event.id);
      setEditingEvent(full);
      setForm({
        title: full.title || '',
        titleSwahili: full.titleSwahili || '',
        description: full.description || '',
        descriptionSwahili: full.descriptionSwahili || '',
        eventDate: full.eventDate ? full.eventDate.slice(0, 10) : '',
        location: full.location || '',
        customerName: full.customerName || '',
        instagram: full.socialLinks?.instagram || '',
        facebook: full.socialLinks?.facebook || '',
        tiktok: full.socialLinks?.tiktok || '',
        coverImageUrl: full.coverImageUrl || '',
        productId: full.productId || '',
        isFeatured: full.isFeatured ?? false,
      });
      setShowMediaForm(false);
      setFormOpen(true);
    } catch {
      toast.error('Failed to load event details');
    }
  };

  // Save (create or update)
  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.warning('Title is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        titleSwahili: form.titleSwahili || undefined,
        description: form.description || undefined,
        descriptionSwahili: form.descriptionSwahili || undefined,
        eventDate: form.eventDate || undefined,
        location: form.location || undefined,
        customerName: form.customerName || undefined,
        coverImageUrl: form.coverImageUrl || undefined,
        productId: form.productId || undefined,
        isFeatured: form.isFeatured,
        socialLinks:
          form.instagram || form.facebook || form.tiktok
            ? {
                instagram: form.instagram || undefined,
                facebook: form.facebook || undefined,
                tiktok: form.tiktok || undefined,
              }
            : undefined,
      };

      if (editingEvent) {
        await adminApi.updateEvent(editingEvent.id, payload);
        toast.success('Event updated successfully');
      } else {
        await adminApi.createEvent(payload);
        toast.success('Event created successfully');
      }
      setFormOpen(false);
      fetchEvents();
    } catch {
      toast.error(editingEvent ? 'Failed to update event' : 'Failed to create event');
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const handleDelete = async (id: string) => {
    try {
      await adminApi.deleteEvent(id);
      toast.success('Event deleted');
      fetchEvents();
    } catch {
      toast.error('Failed to delete event');
    }
  };

  // Approve
  const handleApprove = async (id: string) => {
    try {
      await adminApi.approveEvent(id);
      toast.success('Event approved');
      fetchEvents();
    } catch {
      toast.error('Failed to approve event');
    }
  };

  // Reject
  const openReject = (id: string) => {
    setRejectEventId(id);
    setRejectReason('');
    setRejectOpen(true);
  };

  const handleReject = async () => {
    if (!rejectEventId || !rejectReason.trim()) {
      toast.warning('Please provide a reason for rejection');
      return;
    }
    setRejecting(true);
    try {
      await adminApi.rejectEvent(rejectEventId, rejectReason);
      toast.success('Event rejected');
      setRejectOpen(false);
      fetchEvents();
    } catch {
      toast.error('Failed to reject event');
    } finally {
      setRejecting(false);
    }
  };

  // Add media
  const handleAddMedia = async () => {
    if (!editingEvent || !mediaUrl.trim()) {
      toast.warning('Please enter a media URL');
      return;
    }
    setAddingMedia(true);
    try {
      await adminApi.addEventMedia(editingEvent.id, {
        url: mediaUrl,
        mediaType,
        altText: '',
      });
      toast.success('Media added');
      setMediaUrl('');
      // Refresh the editing event
      const updated = await adminApi.getEvent(editingEvent.id);
      setEditingEvent(updated);
    } catch {
      toast.error('Failed to add media');
    } finally {
      setAddingMedia(false);
    }
  };

  // Delete media
  const handleDeleteMedia = async (mediaId: string) => {
    if (!editingEvent) return;
    try {
      await adminApi.deleteEventMedia(editingEvent.id, mediaId);
      toast.success('Media removed');
      const updated = await adminApi.getEvent(editingEvent.id);
      setEditingEvent(updated);
    } catch {
      toast.error('Failed to remove media');
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'No date';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const updateField = <K extends keyof EventFormData>(key: K, value: EventFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const inputClass =
    'w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/50 focus:border-brand-gold';

  return (
    <div>
      <PageHeader
        title="Events Gallery"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Events Gallery' },
        ]}
        actions={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Create Event
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        {([
          { key: 'all' as Tab, label: 'All Events' },
          { key: 'pending' as Tab, label: 'Pending Approval', count: pendingCount },
          { key: 'featured' as Tab, label: 'Featured' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-brand-gold text-brand-gold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-2 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search events by title, customer, or location..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} pl-10`}
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border border-border rounded-xl p-4 space-y-3">
              <Skeleton className="h-40 w-full rounded-lg" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Camera className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">No events found</p>
          <p className="text-sm mt-1">
            {search ? 'Try adjusting your search.' : 'Create your first event to get started.'}
          </p>
        </div>
      )}

      {/* Event cards grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((event) => (
            <div
              key={event.id}
              className="border rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden bg-card"
            >
              {/* Cover image */}
              <div className="relative h-48 bg-muted flex items-center justify-center">
                {event.coverImageUrl ? (
                  <img
                    src={event.coverImageUrl}
                    alt={event.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Camera className="w-10 h-10 text-muted-foreground/40" />
                )}
                {event.isFeatured && (
                  <span className="absolute top-2 right-2 bg-brand-gold text-white text-xs font-semibold px-2 py-1 rounded-full flex items-center gap-1">
                    <Star className="w-3 h-3" /> Featured
                  </span>
                )}
              </div>

              <div className="p-4 space-y-2">
                {/* Title & status */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-foreground line-clamp-1">{event.title}</h3>
                  <Badge variant={statusBadgeVariant[event.status] || 'neutral'}>
                    {statusLabel[event.status] || event.status}
                  </Badge>
                </div>

                {/* Meta info */}
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formatDate(event.eventDate)}</span>
                  </div>
                  {event.location && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="line-clamp-1">{event.location}</span>
                    </div>
                  )}
                  {event.customerName && (
                    <div className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" />
                      <span>{event.customerName}</span>
                    </div>
                  )}
                  {event.product?.name && (
                    <div className="flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5" />
                      <span className="line-clamp-1">{event.product.name}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>{event._count?.media ?? 0} media</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(event)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                  {event.status === 'PENDING_APPROVAL' && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => handleApprove(event.id)}>
                        <CheckCircle className="w-3.5 h-3.5 mr-1 text-green-600" /> Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openReject(event.id)}>
                        <XCircle className="w-3.5 h-3.5 mr-1 text-red-600" /> Reject
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-red-500 hover:text-red-700"
                    onClick={() => handleDelete(event.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingEvent ? 'Edit Event' : 'Create Event'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingEvent ? 'Update Event' : 'Create Event'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Title" required>
              <input
                className={inputClass}
                value={form.title}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder="Event title"
              />
            </FormField>
            <FormField label="Title (Swahili)">
              <input
                className={inputClass}
                value={form.titleSwahili}
                onChange={(e) => updateField('titleSwahili', e.target.value)}
                placeholder="Kichwa cha tukio"
              />
            </FormField>
          </div>

          <FormField label="Description">
            <textarea
              className={`${inputClass} min-h-[80px]`}
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Event description"
              rows={3}
            />
          </FormField>

          <FormField label="Description (Swahili)">
            <textarea
              className={`${inputClass} min-h-[80px]`}
              value={form.descriptionSwahili}
              onChange={(e) => updateField('descriptionSwahili', e.target.value)}
              placeholder="Maelezo ya tukio"
              rows={3}
            />
          </FormField>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Event Date">
              <input
                type="date"
                className={inputClass}
                value={form.eventDate}
                onChange={(e) => updateField('eventDate', e.target.value)}
              />
            </FormField>
            <FormField label="Location">
              <input
                className={inputClass}
                value={form.location}
                onChange={(e) => updateField('location', e.target.value)}
                placeholder="e.g. Dar es Salaam"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Customer Name">
              <input
                className={inputClass}
                value={form.customerName}
                onChange={(e) => updateField('customerName', e.target.value)}
                placeholder="Customer's name"
              />
            </FormField>
            <FormField label="Product ID" hint="Link to a product (optional)">
              <input
                className={inputClass}
                value={form.productId}
                onChange={(e) => updateField('productId', e.target.value)}
                placeholder="Product ID"
              />
            </FormField>
          </div>

          <FormField label="Cover Image URL">
            <input
              className={inputClass}
              value={form.coverImageUrl}
              onChange={(e) => updateField('coverImageUrl', e.target.value)}
              placeholder="https://..."
            />
          </FormField>

          {/* Social links */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Social Links</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="Instagram">
                <input
                  className={inputClass}
                  value={form.instagram}
                  onChange={(e) => updateField('instagram', e.target.value)}
                  placeholder="https://instagram.com/..."
                />
              </FormField>
              <FormField label="Facebook">
                <input
                  className={inputClass}
                  value={form.facebook}
                  onChange={(e) => updateField('facebook', e.target.value)}
                  placeholder="https://facebook.com/..."
                />
              </FormField>
              <FormField label="TikTok">
                <input
                  className={inputClass}
                  value={form.tiktok}
                  onChange={(e) => updateField('tiktok', e.target.value)}
                  placeholder="https://tiktok.com/..."
                />
              </FormField>
            </div>
          </div>

          {/* Featured checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isFeatured}
              onChange={(e) => updateField('isFeatured', e.target.checked)}
              className="w-4 h-4 rounded border-border text-brand-gold focus:ring-brand-gold"
            />
            <span className="text-sm font-medium text-foreground">Featured Event</span>
          </label>

          {/* Media Management (edit mode only) */}
          {editingEvent && (
            <div className="border-t border-border pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-foreground">
                  Media ({(editingEvent.media || []).length})
                </p>
                <Button size="sm" variant="outline" onClick={() => setShowMediaForm(!showMediaForm)}>
                  {showMediaForm ? (
                    <>
                      <X className="w-3.5 h-3.5 mr-1" /> Cancel
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Media
                    </>
                  )}
                </Button>
              </div>

              {showMediaForm && (
                <div className="flex items-end gap-3 mb-4 p-3 bg-muted/50 rounded-lg">
                  <FormField label="URL">
                    <input
                      className={inputClass}
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      placeholder="https://..."
                    />
                  </FormField>
                  <FormField label="Type">
                    <select
                      className={inputClass}
                      value={mediaType}
                      onChange={(e) => setMediaType(e.target.value as 'IMAGE' | 'VIDEO')}
                    >
                      <option value="IMAGE">Image</option>
                      <option value="VIDEO">Video</option>
                    </select>
                  </FormField>
                  <Button size="sm" onClick={handleAddMedia} disabled={addingMedia}>
                    {addingMedia ? 'Adding...' : 'Add'}
                  </Button>
                </div>
              )}

              {(editingEvent.media || []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No media yet.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {(editingEvent.media || []).map((m) => (
                    <div key={m.id} className="relative group rounded-lg overflow-hidden border border-border">
                      {m.mediaType === 'VIDEO' ? (
                        <div className="h-20 bg-muted flex items-center justify-center">
                          <Film className="w-6 h-6 text-muted-foreground" />
                        </div>
                      ) : (
                        <img
                          src={m.url}
                          alt={m.altText || ''}
                          className="h-20 w-full object-cover"
                        />
                      )}
                      <button
                        onClick={() => handleDeleteMedia(m.id)}
                        className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Reject Modal */}
      <Modal
        isOpen={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject Event"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReject} disabled={rejecting}>
              {rejecting ? 'Rejecting...' : 'Reject Event'}
            </Button>
          </>
        }
      >
        <FormField label="Reason for rejection" required>
          <textarea
            className={`${inputClass} min-h-[100px]`}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Explain why this event is being rejected..."
            rows={4}
          />
        </FormField>
      </Modal>
    </div>
  );
}
