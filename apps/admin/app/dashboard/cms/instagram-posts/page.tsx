'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, Eye, EyeOff,
  Instagram, ExternalLink, Loader2, X, Heart, Pin, RefreshCw, Settings, Clock,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { adminApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const API_ORIGIN = API_BASE_URL.replace('/api/v1', '');

interface InstagramPost {
  id: string;
  caption?: string;
  imageUrl: string;
  postUrl?: string;
  likes: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  source?: string;
  isPinned?: boolean;
  instagramMediaId?: string;
  mediaType?: string;
  postedAt?: string;
}

const emptyForm = {
  caption: '',
  imageUrl: '',
  postUrl: '',
  likes: 0,
  sortOrder: 0,
};

export default function InstagramPostsPage() {
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncInterval, setSyncInterval] = useState('EVERY_6_HOURS');
  const [syncOptions, setSyncOptions] = useState<string[]>([]);
  const [syncConfigSaving, setSyncConfigSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const INTERVAL_LABELS: Record<string, string> = {
    OFF: 'Off (Manual only)',
    EVERY_HOUR: 'Every hour',
    EVERY_3_HOURS: 'Every 3 hours',
    EVERY_6_HOURS: 'Every 6 hours',
    EVERY_12_HOURS: 'Every 12 hours',
    DAILY: 'Once a day',
    WEEKLY: 'Once a week',
  };

  const fetchSyncConfig = useCallback(async () => {
    try {
      const config = await adminApi.getInstagramSyncConfig();
      setSyncInterval(config.interval);
      setSyncOptions(config.options);
    } catch { /* ignore */ }
  }, []);

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getInstagramPosts();
      setPosts(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load Instagram posts');
      setPosts([]);
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { fetchPosts(); fetchSyncConfig(); }, [fetchPosts, fetchSyncConfig]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (p: InstagramPost) => {
    setEditingId(p.id);
    setForm({
      caption: p.caption || '',
      imageUrl: p.imageUrl || '',
      postUrl: p.postUrl || '',
      likes: p.likes ?? 0,
      sortOrder: p.sortOrder ?? 0,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.imageUrl.trim()) { toast.error('Image URL is required'); return; }
    setSaving(true);
    try {
      if (editingId) {
        const updated = await adminApi.updateInstagramPost(editingId, form);
        setPosts((prev) => prev.map((p) => (p.id === editingId ? { ...p, ...updated } : p)));
        toast.success('Instagram post updated');
      } else {
        const created = await adminApi.createInstagramPost(form);
        setPosts((prev) => [...prev, created]);
        toast.success('Instagram post created');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
    } catch { toast.error('Failed to save Instagram post'); }
    finally { setSaving(false); }
  };

  const handleSyncIntervalChange = async (newInterval: string) => {
    setSyncConfigSaving(true);
    try {
      await adminApi.updateInstagramSyncConfig(newInterval);
      setSyncInterval(newInterval);
      toast.success(`Auto-sync set to: ${INTERVAL_LABELS[newInterval] || newInterval}`);
    } catch {
      toast.error('Failed to update sync interval');
    } finally {
      setSyncConfigSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await adminApi.syncInstagramPosts() as { synced?: number; errors?: number };
      await fetchPosts();
      toast.success(`Synced ${result.synced ?? 0} post(s) from Instagram${result.errors ? `, ${result.errors} error(s)` : ''}`);
    } catch {
      toast.error('Failed to sync from Instagram');
    } finally {
      setSyncing(false);
    }
  };

  const handlePin = async (p: InstagramPost) => {
    setPinningId(p.id);
    try {
      const updated = await adminApi.pinInstagramPost(p.id) as InstagramPost;
      setPosts((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...updated } : x)));
      toast.success(updated.isPinned ? 'Post pinned' : 'Post unpinned');
    } catch {
      toast.error('Failed to toggle pin');
    } finally {
      setPinningId(null);
    }
  };

  const toggleActive = async (p: InstagramPost) => {
    setTogglingId(p.id);
    try {
      const updated = await adminApi.updateInstagramPost(p.id, { isActive: !p.isActive });
      setPosts((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...updated } : x)));
      toast.success(p.isActive ? 'Post deactivated' : 'Post activated');
    } catch { toast.error('Failed to toggle post'); }
    finally { setTogglingId(null); }
  };

  const handleDelete = async (p: InstagramPost) => {
    const ok = await confirm({
      title: 'Delete Instagram Post',
      message: `Move "${p.caption || 'this post'}" to recycle bin?`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    setDeletingId(p.id);
    try {
      await adminApi.deleteInstagramPost(p.id);
      setPosts((prev) => prev.filter((x) => x.id !== p.id));
      toast.success('Instagram post moved to recycle bin');
    } catch { toast.error('Failed to delete post'); }
    finally { setDeletingId(null); }
  };

  const resolveImageUrl = (url: string) =>
    url.startsWith('/uploads') ? `${API_ORIGIN}${url}` : url;

  const inputClass = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50';
  const labelClass = 'block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Instagram Posts</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Manage Instagram posts displayed on the storefront
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {syncing ? 'Syncing...' : 'Sync from Instagram'}
          </Button>
          <Button size="sm" className="gap-1.5" onClick={openCreate}>
            <Plus className="w-4 h-4" />
            Add Post
          </Button>
        </div>
      </div>

      {/* Auto-Sync Config */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-brand-gold/10">
              <Clock className="w-5 h-5 text-brand-gold" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[hsl(var(--card-foreground))]">Auto-Sync Schedule</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Automatically refresh Instagram posts to keep images fresh
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select
              title="Instagram auto-sync interval"
              value={syncInterval}
              onChange={(e) => handleSyncIntervalChange(e.target.value)}
              disabled={syncConfigSaving}
              className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50 disabled:opacity-50"
            >
              {(syncOptions.length > 0 ? syncOptions : Object.keys(INTERVAL_LABELS)).map((opt) => (
                <option key={opt} value={opt}>{INTERVAL_LABELS[opt] || opt}</option>
              ))}
            </select>
            {syncConfigSaving && <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />}
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
              syncInterval === 'OFF'
                ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${syncInterval === 'OFF' ? 'bg-gray-400' : 'bg-emerald-500 animate-pulse'}`} />
              {syncInterval === 'OFF' ? 'Disabled' : 'Active'}
            </span>
          </div>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))]">
              {editingId ? 'Edit Instagram Post' : 'Add New Instagram Post'}
            </h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={labelClass}>Image URL *</label>
              <input type="text" required value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="/uploads/products/photo.jpg or https://..." className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Caption</label>
              <input type="text" value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} placeholder="e.g., New collection drop" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Instagram Post URL</label>
              <input type="text" value={form.postUrl} onChange={(e) => setForm({ ...form, postUrl: e.target.value })} placeholder="https://www.instagram.com/p/..." className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Likes</label>
                <input type="number" min="0" value={form.likes} onChange={(e) => setForm({ ...form, likes: Number(e.target.value) })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Sort Order</label>
                <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} className={inputClass} />
              </div>
            </div>
          </div>
          {/* Image preview */}
          {form.imageUrl && (
            <div className="mt-4">
              <label className={labelClass}>Preview</label>
              <div className="w-32 h-32 rounded-lg overflow-hidden bg-[hsl(var(--muted))]">
                <img src={resolveImageUrl(form.imageUrl)} alt="Preview" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 mt-5">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : editingId ? 'Update Post' : 'Create Post'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} type="button">Cancel</Button>
          </div>
        </form>
      )}

      {/* Loading / Empty / Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-12 text-center">
          <Instagram className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <h3 className="font-semibold text-[hsl(var(--card-foreground))]">No Instagram posts yet</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 mb-4">Add your first Instagram post or sync from your Instagram account</p>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleSync} disabled={syncing}>
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {syncing ? 'Syncing...' : 'Sync from Instagram'}
            </Button>
            <Button size="sm" className="gap-1.5" onClick={openCreate}>
              <Plus className="w-4 h-4" /> Add Post
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {posts.map((post) => (
            <div key={post.id}
              className={`rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden transition-opacity ${
                post.isActive ? 'border-[hsl(var(--border))]' : 'border-dashed border-[hsl(var(--border))] opacity-60'
              }`}>
              {/* Image */}
              <div className="aspect-square bg-[hsl(var(--muted))] relative group">
                {post.imageUrl ? (
                  <img
                    src={resolveImageUrl(post.imageUrl)}
                    alt={post.caption || 'Instagram post'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Instagram className="w-8 h-8 text-[hsl(var(--muted-foreground))]" />
                  </div>
                )}
                {/* Hover overlay with actions */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-200 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                  <button onClick={() => handlePin(post)} disabled={pinningId === post.id} className="p-2 rounded-full bg-white/90 hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title={post.isPinned ? 'Unpin' : 'Pin'}>
                    {pinningId === post.id ? <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> : <Pin className={`w-4 h-4 ${post.isPinned ? 'text-brand-gold fill-brand-gold' : 'text-gray-600'}`} />}
                  </button>
                  <button onClick={() => toggleActive(post)} disabled={togglingId === post.id} className="p-2 rounded-full bg-white/90 hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title={post.isActive ? 'Deactivate' : 'Activate'}>
                    {togglingId === post.id ? <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> : post.isActive ? <Eye className="w-4 h-4 text-emerald-600" /> : <EyeOff className="w-4 h-4 text-gray-600" />}
                  </button>
                  <button onClick={() => openEdit(post)} className="p-2 rounded-full bg-white/90 hover:bg-white transition-colors" title="Edit">
                    <Pencil className="w-4 h-4 text-amber-600" />
                  </button>
                  <button onClick={() => handleDelete(post)} disabled={deletingId === post.id} className="p-2 rounded-full bg-white/90 hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Delete">
                    {deletingId === post.id ? <Loader2 className="w-4 h-4 animate-spin text-red-600" /> : <Trash2 className="w-4 h-4 text-red-600" />}
                  </button>
                </div>
                {/* Top-left badges: status + source */}
                <div className="absolute top-2 left-2 flex flex-col gap-1">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    post.isActive
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>{post.isActive ? 'Active' : 'Inactive'}</span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    post.source === 'INSTAGRAM_API'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>{post.source === 'INSTAGRAM_API' ? 'IG' : 'Manual'}</span>
                </div>
                {/* Top-right badges: sort order + pin */}
                <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                  <span className="inline-flex items-center rounded-full bg-black/60 text-white px-2 py-0.5 text-[10px] font-medium">
                    #{post.sortOrder}
                  </span>
                  {post.isPinned && (
                    <span className="inline-flex items-center rounded-full bg-brand-gold/90 text-white px-2 py-0.5 text-[10px] font-medium gap-0.5">
                      <Pin className="w-2.5 h-2.5 fill-white" /> Pinned
                    </span>
                  )}
                </div>
              </div>
              {/* Info */}
              <div className="p-3">
                <p className="text-sm font-medium text-[hsl(var(--card-foreground))] truncate">
                  {post.caption || 'No caption'}
                </p>
                <div className="flex items-center justify-between mt-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                  <span className="flex items-center gap-1">
                    <Heart className="w-3 h-3" /> {post.likes}
                  </span>
                  {post.postUrl && (
                    <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-brand-gold transition-colors">
                      <ExternalLink className="w-3 h-3" /> View
                    </a>
                  )}
                </div>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
                  {formatDate(post.source === 'INSTAGRAM_API' && post.postedAt ? post.postedAt : post.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
