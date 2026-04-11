'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  Loader2,
  ArrowLeft,
  Save,
  Send,
  Eye,
  EyeOff,
  Sparkles,
  Tag,
  Lightbulb,
  FileText,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';

const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), { ssr: false });
import { useConfirm } from '@/components/ui/ConfirmDialog';

type TemplateType = 'NEW_ARRIVALS' | 'NEW_DEALS' | 'TIPS' | 'CUSTOM';

interface NewArrivalProduct {
  id: string;
  name: string;
  slug: string;
  basePrice: number;
  imageUrl?: string;
}

const templateOptions: { value: TemplateType; label: string; icon: React.ReactNode; description: string }[] = [
  {
    value: 'NEW_ARRIVALS',
    label: 'New Arrivals',
    icon: <Sparkles className="w-5 h-5" />,
    description: 'Showcase latest products added to the store',
  },
  {
    value: 'NEW_DEALS',
    label: 'New Deals',
    icon: <Tag className="w-5 h-5" />,
    description: 'Promote flash sales and special offers',
  },
  {
    value: 'TIPS',
    label: 'Fashion Tips',
    icon: <Lightbulb className="w-5 h-5" />,
    description: 'Share styling tips and fashion advice',
  },
  {
    value: 'CUSTOM',
    label: 'Custom',
    icon: <FileText className="w-5 h-5" />,
    description: 'Write a fully custom email from scratch',
  },
];

export default function ComposeNewsletterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');
  const toast = useToast();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [templateType, setTemplateType] = useState<TemplateType>('CUSTOM');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const [newArrivals, setNewArrivals] = useState<NewArrivalProduct[]>([]);
  const [loadingArrivals, setLoadingArrivals] = useState(false);

  // Load existing newsletter for editing
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    if (editId) {
      const fetchNewsletter = async () => {
        try {
          setLoading(true);
          const nl = await adminApi.getNewsletter(editId);
          setTemplateType(nl.templateType || 'CUSTOM');
          setSubject(nl.subject || '');
          setBody(nl.body || '');
        } catch (err) {
          console.error('Failed to fetch newsletter:', err);
          toast.error('Failed to load newsletter');
        } finally {
          setLoading(false);
        }
      };
      fetchNewsletter();
    }
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch new arrivals when template type is NEW_ARRIVALS
  const fetchNewArrivals = useCallback(async () => {
    try {
      setLoadingArrivals(true);
      const products = await adminApi.getNewArrivalsPreview();
      setNewArrivals(Array.isArray(products) ? products : []);
    } catch (err) {
      console.error('Failed to fetch new arrivals:', err);
      setNewArrivals([]);
    } finally {
      setLoadingArrivals(false);
    }
  }, []);

  useEffect(() => {
    if (templateType === 'NEW_ARRIVALS') {
      fetchNewArrivals();
    }
  }, [templateType, fetchNewArrivals]);

  const handleSaveDraft = async () => {
    if (!subject.trim()) {
      toast.warning('Please enter a subject line');
      return;
    }

    try {
      setSaving(true);
      const data = { subject: subject.trim(), body, templateType };

      if (editId) {
        await adminApi.updateNewsletter(editId, data);
        toast.success('Newsletter updated');
      } else {
        const created = await adminApi.createNewsletter(data);
        toast.success('Draft saved');
        router.push(`/dashboard/newsletter/compose?id=${created.id}`);
      }
    } catch (err) {
      console.error('Failed to save draft:', err);
      toast.error('Failed to save draft');
    } finally {
      setSaving(false);
    }
  };

  const handleSendNow = async () => {
    if (!subject.trim()) {
      toast.warning('Please enter a subject line');
      return;
    }

    const confirmed = await confirm({
      title: 'Send Newsletter',
      message: 'This will send the newsletter to all active subscribers. This action cannot be undone.',
      confirmText: 'Send Now',
      variant: 'warning',
    });

    if (!confirmed) return;

    try {
      setSending(true);

      let newsletterId = editId;

      if (!newsletterId) {
        const created = await adminApi.createNewsletter({
          subject: subject.trim(),
          body,
          templateType,
        });
        newsletterId = created.id;
      } else {
        await adminApi.updateNewsletter(newsletterId, {
          subject: subject.trim(),
          body,
          templateType,
        });
      }

      const result = await adminApi.sendNewsletter(newsletterId!);
      toast.success(result?.message || 'Newsletter sent successfully');
      router.push(`/dashboard/newsletter/${newsletterId}`);
    } catch (err) {
      console.error('Failed to send newsletter:', err);
      toast.error('Failed to send newsletter');
    } finally {
      setSending(false);
    }
  };

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
  const baseUrl = apiUrl.replace('/api/v1', '');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard/newsletter')}
            className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
              {editId ? 'Edit Newsletter' : 'Compose Newsletter'}
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              {editId ? 'Update your newsletter draft' : 'Create and send a new email campaign'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showPreview ? 'Hide Preview' : 'Preview'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSaveDraft}
            disabled={saving}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save as Draft
          </Button>
          <Button
            size="sm"
            onClick={handleSendNow}
            disabled={sending}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send Now
          </Button>
        </div>
      </div>

      {/* Template Type Selector */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-4">Template Type</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {templateOptions.map((opt) => (
            <label
              key={opt.value}
              className={`relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                templateType === opt.value
                  ? 'border-brand-gold bg-amber-50/50 dark:bg-amber-900/10'
                  : 'border-[hsl(var(--border))] hover:border-[hsl(var(--muted-foreground))]'
              }`}
            >
              <input
                type="radio"
                name="templateType"
                value={opt.value}
                checked={templateType === opt.value}
                onChange={(e) => setTemplateType(e.target.value as TemplateType)}
                className="sr-only"
              />
              <div
                className={`p-2 rounded-lg ${
                  templateType === opt.value
                    ? 'text-brand-gold bg-amber-100 dark:bg-amber-900/30'
                    : 'text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]'
                }`}
              >
                {opt.icon}
              </div>
              <span className="font-medium text-sm text-[hsl(var(--foreground))]">{opt.label}</span>
              <span className="text-xs text-[hsl(var(--muted-foreground))] text-center">
                {opt.description}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* New Arrivals Preview */}
      {templateType === 'NEW_ARRIVALS' && (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-4">
            New Arrivals Preview
          </h3>
          {loadingArrivals ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
            </div>
          ) : newArrivals.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))] py-4">
              No new arrivals found. Products will be included when available.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {newArrivals.map((product) => {
                const imgSrc = product.imageUrl
                  ? product.imageUrl.startsWith('http')
                    ? product.imageUrl
                    : `${baseUrl}/${product.imageUrl}`
                  : null;

                return (
                  <div
                    key={product.id}
                    className="rounded-lg border border-[hsl(var(--border))] overflow-hidden"
                  >
                    <div className="aspect-square bg-[hsl(var(--muted))] relative">
                      {imgSrc ? (
                        <Image
                          src={imgSrc}
                          alt={product.name}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Sparkles className="w-8 h-8 text-[hsl(var(--muted-foreground))]" />
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-medium text-[hsl(var(--foreground))] truncate">
                        {product.name}
                      </p>
                      <p className="text-xs text-brand-gold font-semibold">
                        TZS {(product.basePrice ?? 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Subject + Body */}
      <div className={`grid ${showPreview ? 'lg:grid-cols-2' : 'grid-cols-1'} gap-6`}>
        {/* Editor */}
        <div className="space-y-4">
          {/* Subject */}
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
            <label className="block text-sm font-semibold text-[hsl(var(--foreground))] mb-2">
              Subject Line
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Enter newsletter subject..."
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-2.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
            />
          </div>

          {/* Body */}
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
            <label className="block text-sm font-semibold text-[hsl(var(--foreground))] mb-2">
              Body
            </label>
            <RichTextEditor
              value={body}
              onChange={setBody}
              placeholder="Start writing your newsletter content..."
              minHeight="400px"
              enableImageUpload
            />
          </div>
        </div>

        {/* Preview */}
        {showPreview && (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
            <div className="p-4 border-b border-[hsl(var(--border))]">
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Preview</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                Subject: {subject || '(no subject)'}
              </p>
            </div>
            <div className="p-6">
              {body ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: body }}
                />
              ) : (
                <p className="text-sm text-[hsl(var(--muted-foreground))] italic">
                  Start typing in the body field to see a preview here...
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
