'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState, useCallback, useRef } from 'react';
import { Code, Eye, Upload, ImageIcon, Loader2 } from 'lucide-react';
import { getImagePreset, formatAllowedMimesForToast } from '@naro/shared';
import { useToast } from '@/contexts/ToastContext';
import 'react-quill-new/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const NEWSLETTER_PRESET = getImagePreset('newsletterInline');

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new window.Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // keep URL alive — caller revokes
  }
}

async function resizeToWidth(file: File, targetW: number, quality: number): Promise<Blob> {
  const img = await loadImage(file);
  const ratio = img.naturalHeight / img.naturalWidth;
  const w = Math.min(img.naturalWidth, targetW);
  const h = Math.round(w * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      quality,
    );
  });
}

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  enableImageUpload?: boolean;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Start writing...',
  minHeight = '300px',
  enableImageUpload = true,
}: RichTextEditorProps) {
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const handleImageUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Mime check
    if (!NEWSLETTER_PRESET.allowedMimes.includes(file.type)) {
      toast.error(`Allowed formats: ${formatAllowedMimesForToast(NEWSLETTER_PRESET)}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    // Size check
    if (file.size > NEWSLETTER_PRESET.maxFileSizeMB * 1024 * 1024) {
      toast.error(`File too large. Max ${NEWSLETTER_PRESET.maxFileSizeMB} MB.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    try {
      // Probe min-source dims, resize-only (no crop UI in RTE flow).
      const probe = new window.Image();
      probe.src = URL.createObjectURL(file);
      await probe.decode();
      if (
        probe.naturalWidth < NEWSLETTER_PRESET.minSourceWidth ||
        probe.naturalHeight < NEWSLETTER_PRESET.minSourceHeight
      ) {
        toast.error(
          `Image too small. Minimum ${NEWSLETTER_PRESET.minSourceWidth}×${NEWSLETTER_PRESET.minSourceHeight}. Yours is ${probe.naturalWidth}×${probe.naturalHeight}.`,
        );
        URL.revokeObjectURL(probe.src);
        return;
      }
      URL.revokeObjectURL(probe.src);

      const blob = await resizeToWidth(
        file,
        NEWSLETTER_PRESET.outputWidth,
        NEWSLETTER_PRESET.quality,
      );
      const resizedFile = new File([blob], `newsletter-${Date.now()}.jpg`, { type: 'image/jpeg' });

      const formData = new FormData();
      formData.append('file', resizedFile);
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/upload/image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      const imageUrl = data.url?.startsWith('/uploads')
        ? `${API_BASE_URL.replace('/api/v1', '')}${data.url}`
        : data.url;

      // Append image to current HTML content
      const imgTag = `<p><img src="${imageUrl}" alt="uploaded image" /></p>`;
      onChange(value + imgTag);
      toast.success('Image inserted');
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [onChange, toast, value]);

  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, 3, 4, false] }],
          [{ font: [] }],
          [{ size: ['small', false, 'large', 'huge'] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ color: [] }, { background: [] }],
          [{ list: 'ordered' }, { list: 'bullet' }],
          [{ indent: '-1' }, { indent: '+1' }],
          [{ align: [] }],
          ['link', 'image', 'video'],
          ['blockquote', 'code-block'],
          [{ direction: 'rtl' }],
          ['clean'],
        ],
        handlers: enableImageUpload ? { image: handleImageUpload } : {},
      },
      clipboard: { matchVisual: false },
    }),
    [enableImageUpload, handleImageUpload],
  );

  const formats = [
    'header', 'font', 'size',
    'bold', 'italic', 'underline', 'strike',
    'color', 'background',
    'list', 'indent',
    'align', 'direction',
    'link', 'image', 'video',
    'blockquote', 'code-block',
  ];

  return (
    <div className="rich-editor-wrapper" style={{ ['--editor-min-height' as string]: minHeight }}>
      {/* Mode toggle toolbar */}
      <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode('visual')}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === 'visual'
                ? 'bg-brand-gold text-white'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))]'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Visual
          </button>
          <button
            type="button"
            onClick={() => setMode('html')}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === 'html'
                ? 'bg-brand-gold text-white'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))]'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            HTML
          </button>
        </div>
        <div className="flex items-center gap-2">
          {uploading && (
            <span className="flex items-center gap-1 text-xs text-brand-gold">
              <Loader2 className="w-3 h-3 animate-spin" />
              Uploading...
            </span>
          )}
          {enableImageUpload && mode === 'visual' && (
            <button
              type="button"
              onClick={handleImageUpload}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))] transition-colors"
              title="Upload image"
            >
              <Upload className="w-3.5 h-3.5" />
              <ImageIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Hidden file input for image uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileSelected}
        className="hidden"
        title="Upload image"
        aria-label="Upload image"
      />

      {/* Visual editor (Quill) */}
      {mode === 'visual' && (
        <>
          <style>{`
            .rich-editor-wrapper .ql-toolbar {
              border-color: hsl(var(--border)) !important;
              border-radius: 0;
              background: hsl(var(--muted));
              border-top: none !important;
            }
            .rich-editor-wrapper .ql-container {
              border-color: hsl(var(--border)) !important;
              border-radius: 0 0 0.5rem 0.5rem;
              font-size: 14px;
              font-family: inherit;
              min-height: var(--editor-min-height, 300px);
            }
            .rich-editor-wrapper .ql-editor {
              min-height: var(--editor-min-height, 300px);
              color: hsl(var(--foreground));
              line-height: 1.7;
            }
            .rich-editor-wrapper .ql-editor.ql-blank::before {
              color: hsl(var(--muted-foreground));
              font-style: normal;
            }
            .rich-editor-wrapper .ql-snow .ql-stroke {
              stroke: hsl(var(--muted-foreground));
            }
            .rich-editor-wrapper .ql-snow .ql-fill {
              fill: hsl(var(--muted-foreground));
            }
            .rich-editor-wrapper .ql-snow .ql-picker-label {
              color: hsl(var(--muted-foreground));
            }
            .rich-editor-wrapper .ql-snow .ql-picker-options {
              background: hsl(var(--card));
              border-color: hsl(var(--border));
            }
            .rich-editor-wrapper .ql-snow .ql-picker-item {
              color: hsl(var(--foreground));
            }
            .rich-editor-wrapper .ql-snow .ql-tooltip {
              background: hsl(var(--card));
              border-color: hsl(var(--border));
              color: hsl(var(--foreground));
              box-shadow: 0 4px 12px rgba(0,0,0,0.15);
              z-index: 10;
            }
            .rich-editor-wrapper .ql-snow .ql-tooltip input[type="text"] {
              background: hsl(var(--background));
              border-color: hsl(var(--border));
              color: hsl(var(--foreground));
            }
            .rich-editor-wrapper .ql-snow .ql-tooltip a.ql-action::after,
            .rich-editor-wrapper .ql-snow .ql-tooltip a.ql-remove::before {
              color: hsl(var(--foreground));
            }
            .rich-editor-wrapper .ql-editor img {
              max-width: 100%;
              height: auto;
              border-radius: 0.5rem;
              margin: 1rem 0;
            }
            .rich-editor-wrapper .ql-editor h1 { font-size: 1.5rem; font-weight: 700; margin: 1.5rem 0 0.75rem; }
            .rich-editor-wrapper .ql-editor h2 { font-size: 1.25rem; font-weight: 700; margin: 1.5rem 0 0.75rem; }
            .rich-editor-wrapper .ql-editor h3 { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.5rem; }
            .rich-editor-wrapper .ql-editor h4 { font-size: 1rem; font-weight: 600; margin: 0.75rem 0 0.5rem; }
            .rich-editor-wrapper .ql-editor p { margin: 0.5rem 0; }
            .rich-editor-wrapper .ql-editor blockquote {
              border-left: 4px solid hsl(var(--border));
              padding-left: 1rem;
              margin: 1rem 0;
              color: hsl(var(--muted-foreground));
              font-style: italic;
            }
            .rich-editor-wrapper .ql-editor pre.ql-syntax {
              background: hsl(var(--muted));
              color: hsl(var(--foreground));
              border-radius: 0.375rem;
              padding: 0.75rem 1rem;
              font-size: 0.85rem;
              overflow-x: auto;
            }
            .rich-editor-wrapper .ql-editor table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
            .rich-editor-wrapper .ql-editor th, .rich-editor-wrapper .ql-editor td { border: 1px solid hsl(var(--border)); padding: 0.5rem 0.75rem; text-align: left; font-size: 0.875rem; }
            .rich-editor-wrapper .ql-editor th { background: hsl(var(--muted)); font-weight: 600; }
            .rich-editor-wrapper .ql-editor a { color: #D4AF37; text-decoration: underline; }
            .rich-editor-wrapper .ql-editor ul, .rich-editor-wrapper .ql-editor ol { padding-left: 1.5rem; margin: 0.5rem 0; }
            .rich-editor-wrapper .ql-editor li { margin: 0.25rem 0; }
            .rich-editor-wrapper .ql-editor iframe { max-width: 100%; margin: 1rem 0; border-radius: 0.5rem; }
          `}</style>
          <ReactQuill
            theme="snow"
            value={value}
            onChange={onChange}
            modules={modules}
            formats={formats}
            placeholder={placeholder}
          />
        </>
      )}

      {/* HTML source code editor */}
      {mode === 'html' && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="<h1>Write your HTML here...</h1>"
          className="w-full rounded-b-lg border border-t-0 border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-3 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold font-mono resize-y"
          style={{ minHeight }}
        />
      )}
    </div>
  );
}
