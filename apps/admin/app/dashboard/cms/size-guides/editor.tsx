'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Loader2, Ruler, LayoutTemplate, ArrowLeft, ChevronDown, FileUp, FileText, X, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Button from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { adminApi } from '@/lib/api';
import { SIZE_GUIDE_TEMPLATES } from './templates';

const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), { ssr: false });

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

function resolveUrl(url: string): string {
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

interface SizeGuideEditorProps {
  id?: string; // undefined = create mode
}

export default function SizeGuideEditor({ id }: SizeGuideEditorProps) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [activeLang, setActiveLang] = useState<'en' | 'sw'>('en');
  const [showTemplates, setShowTemplates] = useState(!id); // open by default for new

  const [name, setName] = useState('');
  const [nameSwahili, setNameSwahili] = useState('');
  const [content, setContent] = useState('');
  const [contentSwahili, setContentSwahili] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfUrlSwahili, setPdfUrlSwahili] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState<'en' | 'sw' | null>(null);
  const pdfInputEnRef = useRef<HTMLInputElement>(null);
  const pdfInputSwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const data = await adminApi.getSizeGuide(id);
        setName(data.name || '');
        setNameSwahili(data.nameSwahili || '');
        setContent(data.content || '');
        setContentSwahili(data.contentSwahili || '');
        setPdfUrl(data.pdfUrl || '');
        setPdfUrlSwahili(data.pdfUrlSwahili || '');
        setIsDefault(data.isDefault ?? false);
      } catch { toast.error('Failed to load size guide'); }
      finally { setLoading(false); }
    })();
  }, [id, toast]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!content.trim()) { toast.error('Content is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name, nameSwahili: nameSwahili || undefined,
        content, contentSwahili: contentSwahili || undefined,
        pdfUrl: pdfUrl || undefined, pdfUrlSwahili: pdfUrlSwahili || undefined,
        isDefault,
      };
      if (id) {
        await adminApi.updateSizeGuide(id, payload);
        toast.success('Size guide updated');
      } else {
        const created = await adminApi.createSizeGuide(payload);
        toast.success('Size guide created');
        router.push(`/dashboard/cms/size-guides/${created.id}`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = async (templateId: string) => {
    const template = SIZE_GUIDE_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    if (content.trim()) {
      const ok = await confirm({
        title: 'Apply Template', message: `Replace current content with "${template.name}"?`, confirmText: 'Apply', variant: 'danger',
      });
      if (!ok) return;
    }
    setContent(template.contentEn);
    setContentSwahili(template.contentSw);
    setShowTemplates(false);
    toast.success('Template applied');
  };

  const handlePdfUpload = async (lang: 'en' | 'sw', file: File) => {
    setUploadingPdf(lang);
    try {
      const result = await adminApi.uploadDocument(file);
      if (lang === 'en') setPdfUrl(result.url); else setPdfUrlSwahili(result.url);
      toast.success('PDF uploaded');
    } catch { toast.error('Upload failed'); }
    finally { setUploadingPdf(null); }
  };

  const currentContent = activeLang === 'en' ? content : contentSwahili;
  const setCurrentContent = (val: string) => { activeLang === 'en' ? setContent(val) : setContentSwahili(val); };
  const inputClass = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-gold" /></div>;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/cms/size-guides" className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
              <Ruler className="w-6 h-6 text-brand-gold" />
              {id ? 'Edit Size Guide' : 'New Size Guide'}
            </h1>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> {id ? 'Update' : 'Create'}</>}
        </Button>
      </div>

      {/* Name + Default */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4 sm:p-5 md:p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] px-1.5 py-0.5 rounded">EN</span>
              <label className="text-sm font-medium text-[hsl(var(--foreground))]">Name *</label>
            </div>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Women's Clothing" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-brand-gold/10 text-brand-gold px-1.5 py-0.5 rounded">SW</span>
              <label className="text-sm font-medium text-[hsl(var(--foreground))]">Jina</label>
            </div>
            <input type="text" value={nameSwahili} onChange={(e) => setNameSwahili(e.target.value)} className={inputClass} placeholder="mf. Nguo za Wanawake" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="sr-only peer" />
            <div className="w-11 h-6 bg-[hsl(var(--muted))] peer-focus:ring-2 peer-focus:ring-brand-gold/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-gold"></div>
          </label>
          <span className="text-sm text-[hsl(var(--foreground))]">Set as default size guide</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">(shown on /pages/size-guide)</span>
        </div>
      </div>

      {/* PDF Attachments */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4 sm:p-5 md:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">PDF Attachments</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* EN PDF */}
          <div className="p-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] space-y-3">
            <span className="text-sm font-medium text-[hsl(var(--foreground))]">English PDF</span>
            {pdfUrl ? (
              <div className="flex items-center gap-2">
                <a href={resolveUrl(pdfUrl)} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--muted))] text-sm hover:underline truncate">
                  <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span className="truncate">{pdfUrl.split('/').pop()}</span>
                </a>
                <button type="button" onClick={() => setPdfUrl('')} className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <button type="button" onClick={() => pdfInputEnRef.current?.click()} disabled={uploadingPdf === 'en'}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-[hsl(var(--border))] text-sm text-[hsl(var(--muted-foreground))] hover:border-brand-gold/50 transition-colors">
                {uploadingPdf === 'en' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                {uploadingPdf === 'en' ? 'Uploading...' : 'Upload PDF'}
              </button>
            )}
            <input ref={pdfInputEnRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdfUpload('en', f); e.target.value = ''; }} />
          </div>
          {/* SW PDF */}
          <div className="p-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] space-y-3">
            <span className="text-sm font-medium text-[hsl(var(--foreground))]">Swahili PDF</span>
            {pdfUrlSwahili ? (
              <div className="flex items-center gap-2">
                <a href={resolveUrl(pdfUrlSwahili)} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--muted))] text-sm hover:underline truncate">
                  <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span className="truncate">{pdfUrlSwahili.split('/').pop()}</span>
                </a>
                <button type="button" onClick={() => setPdfUrlSwahili('')} className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <button type="button" onClick={() => pdfInputSwRef.current?.click()} disabled={uploadingPdf === 'sw'}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-[hsl(var(--border))] text-sm text-[hsl(var(--muted-foreground))] hover:border-brand-gold/50 transition-colors">
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
        <button type="button" onClick={() => setShowTemplates(!showTemplates)} className="w-full flex items-center justify-between px-6 py-4 hover:bg-[hsl(var(--muted))] transition-colors">
          <div className="flex items-center gap-3">
            <LayoutTemplate className="w-5 h-5 text-brand-gold" />
            <div className="text-left">
              <p className="font-semibold text-[hsl(var(--foreground))] text-sm">Pre-built Templates</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Auto-fill content in both languages</p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-[hsl(var(--muted-foreground))] transition-transform ${showTemplates ? 'rotate-180' : ''}`} />
        </button>
        {showTemplates && (
          <div className="border-t border-[hsl(var(--border))] p-4 grid gap-3">
            {SIZE_GUIDE_TEMPLATES.map((t) => (
              <button key={t.id} type="button" onClick={() => applyTemplate(t.id)}
                className="text-left p-4 rounded-xl border border-[hsl(var(--border))] hover:border-brand-gold/50 hover:bg-brand-gold/5 transition-all">
                <p className="font-medium text-[hsl(var(--foreground))] text-sm">{t.name}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{t.description}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content Editor */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-2">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setActiveTab('edit')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'edit' ? 'bg-brand-gold text-white' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>Edit</button>
            <button type="button" onClick={() => setActiveTab('preview')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'preview' ? 'bg-brand-gold text-white' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>Preview</button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setActiveLang('en')} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${activeLang === 'en' ? 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>EN</button>
            <button type="button" onClick={() => setActiveLang('sw')} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${activeLang === 'sw' ? 'bg-brand-gold/10 text-brand-gold' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>SW</button>
          </div>
        </div>
        <div className="p-4">
          {activeTab === 'edit' ? (
            <RichTextEditor key={activeLang} value={currentContent} onChange={setCurrentContent}
              placeholder={activeLang === 'en' ? 'Write size guide content...' : 'Andika maudhui ya mwongozo wa saizi...'} minHeight="400px" />
          ) : (
            <div className="min-h-[400px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6 overflow-auto">
              {currentContent ? (
                <div className="prose prose-sm max-w-none prose-headings:font-bold prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3 prose-table:w-full prose-table:border-collapse prose-th:border prose-th:border-[hsl(var(--border))] prose-th:px-3 prose-th:py-2 prose-th:text-xs prose-th:font-semibold prose-th:bg-[hsl(var(--muted))] prose-td:border prose-td:border-[hsl(var(--border))] prose-td:px-3 prose-td:py-2 prose-td:text-sm"
                  dangerouslySetInnerHTML={{ __html: currentContent }} />
              ) : (
                <p className="text-[hsl(var(--muted-foreground))] text-sm">No content yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
