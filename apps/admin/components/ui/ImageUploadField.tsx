'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Upload, RotateCcw, Loader2 } from 'lucide-react';
import {
  type ImagePresetKey,
  getImagePreset,
  formatAllowedMimesForToast,
} from '@naro/shared';
import { useToast } from '@/contexts/ToastContext';
import ImageCropModal from '../products/ImageCropModal';

interface ImageUploadFieldProps {
  label: string;
  currentUrl: string;
  defaultUrl: string;
  onUpload: (file: File) => Promise<string>;
  onReset: () => void;
  previewSize?: number;
  shape?: 'square' | 'circle';
  hint?: string;
  // Optional preset — when present, file is validated (mime/size/dimensions)
  // and (unless skipCrop) cropped via ImageCropModal before being passed to onUpload.
  presetKey?: ImagePresetKey;
}

async function probeDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new window.Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function extFromMime(mime: string, fallback: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/svg+xml') return 'svg';
  return fallback;
}

export default function ImageUploadField({
  label,
  currentUrl,
  defaultUrl,
  onUpload,
  onReset,
  previewSize = 120,
  shape = 'square',
  hint,
  presetKey,
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const toast = useToast();
  const preset = presetKey ? getImagePreset(presetKey) : null;

  const finishUpload = async (file: File) => {
    setError('');
    setUploading(true);
    try {
      await onUpload(file);
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleCropped = async (blob: Blob) => {
    if (!preset) return;
    setPendingFile(null);
    const ext = extFromMime(
      preset.outputMime === 'passthrough' ? 'image/jpeg' : preset.outputMime,
      'jpg',
    );
    const namedFile = new File([blob], `${preset.key}-${Date.now()}.${ext}`, {
      type: preset.outputMime === 'passthrough' ? blob.type || 'image/jpeg' : preset.outputMime,
    });
    await finishUpload(namedFile);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // No preset → legacy passthrough behavior.
    if (!preset) {
      await finishUpload(file);
      return;
    }

    setError('');

    if (!preset.allowedMimes.includes(file.type)) {
      const msg = `Allowed formats: ${formatAllowedMimesForToast(preset)}`;
      setError(msg);
      toast.error(msg);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    const maxBytes = preset.maxFileSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      const msg = `File too large. Max ${preset.maxFileSizeMB} MB.`;
      setError(msg);
      toast.error(msg);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    // Min-source dimension check (skip for SVG/PDF or when no min set).
    if (
      file.type !== 'image/svg+xml' &&
      file.type !== 'application/pdf' &&
      preset.minSourceWidth > 0 &&
      preset.minSourceHeight > 0
    ) {
      try {
        const dims = await probeDimensions(file);
        if (dims.width < preset.minSourceWidth || dims.height < preset.minSourceHeight) {
          const msg = `Image too small. Minimum ${preset.minSourceWidth}×${preset.minSourceHeight}. Yours is ${dims.width}×${dims.height}.`;
          setError(msg);
          toast.error(msg);
          if (inputRef.current) inputRef.current.value = '';
          return;
        }
      } catch {
        // probe failed — let server validate
      }
    }

    if (preset.skipCrop) {
      await finishUpload(file);
      return;
    }

    setPendingFile(file);
  };

  const isDefault = currentUrl === defaultUrl;
  const apiOrigin = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');
  const displayUrl = currentUrl.startsWith('/uploads') ? `${apiOrigin}${currentUrl}` : currentUrl;
  const accept = preset ? preset.allowedMimes.join(',') : 'image/jpeg,image/png,image/webp';

  return (
    <div className="flex items-start gap-4">
      <div
        className={`relative flex-shrink-0 overflow-hidden border-2 border-[hsl(var(--border))] bg-[hsl(var(--muted))] ${
          shape === 'circle' ? 'rounded-full' : 'rounded-lg'
        }`}
        style={{ width: previewSize, height: previewSize }}
      >
        {uploading ? (
          <div className="flex items-center justify-center w-full h-full">
            <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
          </div>
        ) : (
          <Image
            src={displayUrl}
            alt={label}
            width={previewSize}
            height={previewSize}
            className="object-cover w-full h-full"
            unoptimized
          />
        )}
      </div>
      <div className="flex-1 space-y-2">
        <p className="text-sm font-medium text-[hsl(var(--foreground))]">{label}</p>
        {hint && <p className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</p>}
        {preset && !hint && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Min {preset.minSourceWidth}×{preset.minSourceHeight}. Output {preset.outputWidth}×{preset.outputHeight}.
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload New
          </button>
          {!isDefault && (
            <button
              type="button"
              onClick={onReset}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
          className="hidden"
          aria-label={`Upload ${label}`}
          title={`Upload ${label}`}
        />
      </div>

      {pendingFile && preset && (
        <ImageCropModal
          file={pendingFile}
          preset={preset}
          onCropped={handleCropped}
          onCancel={() => {
            setPendingFile(null);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
      )}
    </div>
  );
}
