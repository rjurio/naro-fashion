'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Loader2, Ruler, LayoutTemplate, Eye, ArrowLeft, ChevronDown, FileUp, FileText, X, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import Button from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { adminApi } from '@/lib/api';
import { SIZE_GUIDE_TEMPLATES } from './templates';

const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), { ssr: false });

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');
const SLUG = 'size-guide';

function resolveUrl(url: string): string {
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

interface PageData {
  id?: string;
  title: string;
  titleSwahili: string;
  content: string;
  contentSwahili: string;
  isPublished: boolean;
}

const emptyPage: PageData = {
  title: 'Size Guide',
  titleSwahili: 'Mwongozo wa Saizi',
  content: '',
  contentSwahili: '',
  isPublished: true,
};

export default function SizeGuidePage() {
  const [page, setPage] = useState<PageData>(emptyPage);
  const [originalPage, setOriginalPage] = useState<PageData>(emptyPage);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exists, setExists] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [activeLang, setActiveLang] = useState<'en' | 'sw'>('en');
  const [showTemplates, setShowTemplates] = useState(false);

  // PDF attachments stored in CMS settings
  const [pdfUrlEn, setPdfUrlEn] = useState('');
  const [pdfUrlSw, setPdfUrlSw] = useState('');
  const [originalPdfEn, setOriginalPdfEn] = useState('');
  const [originalPdfSw, setOriginalPdfSw] = useState('');
  const [uploadingPdf, setUploadingPdf] = useState<'en' | 'sw' | null>(null);
  const pdfInputEnRef = useRef<HTMLInputElement>(null);
  const pdfInputSwRef = useRef<HTMLInputElement>(null);

  const toast = useToast();
  const confirm = useConfirm();

  const fetchPage = useCallback(async () => {
    try {
      setLoading(true);
      const [pages, settings] = await Promise.all([
        adminApi.getPages(),
        adminApi.getSettings(),
      ]);
      // Load page content
      const sizeGuide = (pages as any[]).find((p: any) => p.slug === SLUG);
      if (sizeGuide) {
        const data: PageData = {
          id: sizeGuide.id,
          title: sizeGuide.title || 'Size Guide',
          titleSwahili: sizeGuide.titleSwahili || '',
          content: sizeGuide.content || '',
          contentSwahili: sizeGuide.contentSwahili || '',
          isPublished: sizeGuide.isPublished ?? true,
        };
        setPage(data);
        setOriginalPage(data);
        setExists(true);
      }
      // Load PDF URLs from settings
      const settingsMap: Record<string, string> = {};
      if (Array.isArray(settings)) {
        settings.forEach((s: any) => { settingsMap[s.key] = s.value; });
      }
      setPdfUrlEn(settingsMap['size_guide_pdf_en'] || '');
      setPdfUrlSw(settingsMap['size_guide_pdf_sw'] || '');
      setOriginalPdfEn(settingsMap['size_guide_pdf_en'] || '');
      setOriginalPdfSw(settingsMap['size_guide_pdf_sw'] || '');
    } catch {
      toast.error('Failed to load size guide');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  const isDirty =
    JSON.stringify(page) !== JSON.stringify(originalPage) ||
    pdfUrlEn !== originalPdfEn ||
    pdfUrlSw !== originalPdfSw;

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        title: page.title,
        titleSwahili: page.titleSwahili,
        slug: SLUG,
        content: page.content,
        contentSwahili: page.contentSwahili,
        isPublished: page.isPublished,
      };

      if (exists && page.id) {
        await adminApi.updatePage(page.id, payload);
      } else {
        const created = await adminApi.createPage(payload);
        setPage((prev) => ({ ...prev, id: created.id }));
        setExists(true);
      }

      // Save PDF URLs as site settings
      const pdfUpdates: Promise<any>[] = [];
      if (pdfUrlEn !== originalPdfEn) {
        pdfUpdates.push(adminApi.updateSetting('size_guide_pdf_en', { value: pdfUrlEn }));
      }
      if (pdfUrlSw !== originalPdfSw) {
        pdfUpdates.push(adminApi.updateSetting('size_guide_pdf_sw', { value: pdfUrlSw }));
      }
      if (pdfUpdates.length) await Promise.all(pdfUpdates);

      setOriginalPage({ ...page });
      setOriginalPdfEn(pdfUrlEn);
      setOriginalPdfSw(pdfUrlSw);
      toast.success('Size guide saved');
    } catch {
      toast.error('Failed to save size guide');
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = async (templateId: string) => {
    const template = SIZE_GUIDE_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    const hasContent = page.content.trim().length > 0;
    if (hasContent) {
      const ok = await confirm({
        title: 'Apply Template',
        message: `This will replace your current content with the "${template.name}" template. Continue?`,
        confirmText: 'Apply Template',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setPage((prev) => ({ ...prev, content: template.contentEn, contentSwahili: template.contentSw }));
    setShowTemplates(false);
    toast.success(`Template "${template.name}" applied`);
  };

  const handlePdfUpload = async (lang: 'en' | 'sw', file: File) => {
    setUploadingPdf(lang);
    try {
      const result = await adminApi.uploadDocument(file);
      const url = result.url;
      if (lang === 'en') setPdfUrlEn(url);
      else setPdfUrlSw(url);
      toast.success('PDF uploaded');
    } catch {
      toast.error('Failed to upload PDF');
    } finally {
      setUploadingPdf(null);
    }
  };

  const currentContent = activeLang === 'en' ? page.content : page.contentSwahili;
  const setCurrentContent = (val: string) => {
    if (activeLang === 'en') setPage({ ...page, content: val });
    else setPage({ ...page, contentSwahili: val });
  };

  const inputClass = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/cms/pages" className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
              <Ruler className="w-6 h-6 text-brand-gold" />
              Size Guide
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
              Rich text content in English and Swahili with optional PDF attachments
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${process.env.NEXT_PUBLIC_STOREFRONT_URL || ''}/pages/size-guide`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View on Store
          </a>
          <Button onClick={handleSave} disabled={!isDirty || saving}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save</>}
          </Button>
        </div>
      </div>

      {/* Titles + Published */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4 sm:p-5 md:p-6 space-y-4">
        <h2 className="font-semibold text-[hsl(var(--foreground))]">Page Titles</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] px-1.5 py-0.5 rounded">EN</span>
              <label className="text-sm font-medium text-[hsl(var(--foreground))]">Title</label>
            </div>
            <input type="text" value={page.title} onChange={(e) => setPage({ ...page, title: e.target.value })} className={inputClass} placeholder="Size Guide" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-brand-gold/10 text-brand-gold px-1.5 py-0.5 rounded">SW</span>
              <label className="text-sm font-medium text-[hsl(var(--foreground))]">Kichwa</label>
            </div>
            <input type="text" value={page.titleSwahili} onChange={(e) => setPage({ ...page, titleSwahili: e.target.value })} className={inputClass} placeholder="Mwongozo wa Saizi" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={page.isPublished} onChange={(e) => setPage({ ...page, isPublished: e.target.checked })} className="sr-only peer" />
            <div className="w-11 h-6 bg-[hsl(var(--muted))] peer-focus:ring-2 peer-focus:ring-brand-gold/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-gold"></div>
          </label>
          <span className="text-sm text-[hsl(var(--foreground))]">Published</span>
        </div>
      </div>

      {/* PDF Attachments */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4 sm:p-5 md:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">PDF Attachments</h2>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Upload downloadable PDF size guide files. Customers can download these from the size guide page.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* English PDF */}
          <div className="p-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] space-y-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] px-1.5 py-0.5 rounded">EN</span>
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">English PDF</span>
            </div>
            {pdfUrlEn ? (
              <div className="flex items-center gap-2">
                <a
                  href={resolveUrl(pdfUrlEn)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--muted))] text-sm text-[hsl(var(--foreground))] hover:underline truncate"
                >
                  <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span className="truncate">{pdfUrlEn.split('/').pop()}</span>
                </a>
                <button type="button" onClick={() => setPdfUrlEn('')} className="p-1.5 rounded-lg hover:bg-red-50 text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors" title="Remove">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => pdfInputEnRef.current?.click()}
                disabled={uploadingPdf === 'en'}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-[hsl(var(--border))] text-sm text-[hsl(var(--muted-foreground))] hover:border-brand-gold/50 hover:text-brand-gold transition-colors"
              >
                {uploadingPdf === 'en' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                {uploadingPdf === 'en' ? 'Uploading...' : 'Upload PDF'}
              </button>
            )}
            <input ref={pdfInputEnRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdfUpload('en', f); e.target.value = ''; }} />
          </div>

          {/* Swahili PDF */}
          <div className="p-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] space-y-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-brand-gold/10 text-brand-gold px-1.5 py-0.5 rounded">SW</span>
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">Swahili PDF</span>
            </div>
            {pdfUrlSw ? (
              <div className="flex items-center gap-2">
                <a
                  href={resolveUrl(pdfUrlSw)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--muted))] text-sm text-[hsl(var(--foreground))] hover:underline truncate"
                >
                  <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span className="truncate">{pdfUrlSw.split('/').pop()}</span>
                </a>
                <button type="button" onClick={() => setPdfUrlSw('')} className="p-1.5 rounded-lg hover:bg-red-50 text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors" title="Remove">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => pdfInputSwRef.current?.click()}
                disabled={uploadingPdf === 'sw'}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-[hsl(var(--border))] text-sm text-[hsl(var(--muted-foreground))] hover:border-brand-gold/50 hover:text-brand-gold transition-colors"
              >
                {uploadingPdf === 'sw' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                {uploadingPdf === 'sw' ? 'Uploading...' : 'Upload PDF'}
              </button>
            )}
            <input ref={pdfInputSwRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdfUpload('sw', f); e.target.value = ''; }} />
          </div>
        </div>
      </div>

      {/* Template Picker */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowTemplates(!showTemplates)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-[hsl(var(--muted))] transition-colors"
        >
          <div className="flex items-center gap-3">
            <LayoutTemplate className="w-5 h-5 text-brand-gold" />
            <div className="text-left">
              <p className="font-semibold text-[hsl(var(--foreground))] text-sm">Pre-built Templates</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Choose a template to auto-fill content in both languages</p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-[hsl(var(--muted-foreground))] transition-transform ${showTemplates ? 'rotate-180' : ''}`} />
        </button>
        {showTemplates && (
          <div className="border-t border-[hsl(var(--border))] p-4 grid gap-3">
            {SIZE_GUIDE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => applyTemplate(template.id)}
                className="text-left p-4 rounded-xl border border-[hsl(var(--border))] hover:border-brand-gold/50 hover:bg-brand-gold/5 transition-all"
              >
                <p className="font-medium text-[hsl(var(--foreground))] text-sm">{template.name}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{template.description}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content Editor */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-2">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setActiveTab('edit')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'edit' ? 'bg-brand-gold text-white' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>
              Edit
            </button>
            <button type="button" onClick={() => setActiveTab('preview')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'preview' ? 'bg-brand-gold text-white' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>
              Preview
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setActiveLang('en')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${activeLang === 'en' ? 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>
              EN
            </button>
            <button type="button" onClick={() => setActiveLang('sw')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${activeLang === 'sw' ? 'bg-brand-gold/10 text-brand-gold' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>
              SW
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {activeTab === 'edit' ? (
            <RichTextEditor
              key={activeLang}
              value={currentContent}
              onChange={setCurrentContent}
              placeholder={activeLang === 'en'
                ? 'Write your size guide content here... Use a template above to get started!'
                : 'Andika maudhui ya mwongozo wa saizi hapa...'}
              minHeight="400px"
            />
          ) : (
            <div className="min-h-[400px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6 overflow-auto">
              {currentContent ? (
                <div
                  className="prose prose-sm max-w-none text-[hsl(var(--foreground))]
                    prose-headings:text-[hsl(var(--foreground))] prose-headings:font-bold
                    prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3
                    prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2
                    prose-p:leading-relaxed prose-p:mb-4 prose-p:text-[hsl(var(--muted-foreground))]
                    prose-ul:list-disc prose-ul:pl-5 prose-ul:mb-4
                    prose-li:mb-1 prose-li:text-[hsl(var(--muted-foreground))]
                    prose-strong:text-[hsl(var(--foreground))]
                    prose-table:w-full prose-table:border-collapse
                    prose-th:border prose-th:border-[hsl(var(--border))] prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-xs prose-th:font-semibold prose-th:bg-[hsl(var(--muted))]
                    prose-td:border prose-td:border-[hsl(var(--border))] prose-td:px-3 prose-td:py-2 prose-td:text-sm"
                  dangerouslySetInnerHTML={{ __html: currentContent }}
                />
              ) : (
                <p className="text-[hsl(var(--muted-foreground))] text-sm">No content yet. Switch to Edit mode to add content.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
