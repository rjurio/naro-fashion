'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import {
  type ImagePresetKey,
  getImagePreset,
  formatAllowedMimesForToast,
} from '@naro/shared';
import adminApi from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import ImageCropModal from '../products/ImageCropModal';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace(
  '/api/v1',
  '',
);

interface SingleProps {
  presetKey: ImagePresetKey;
  value: string | null;
  onChange: (url: string | null) => void;
  label?: string;
  hint?: string;
  shape?: 'square' | 'circle' | 'rect';
  previewSize?: number;
  multiple?: false;
}

interface MultiProps {
  presetKey: ImagePresetKey;
  values: string[];
  onChangeMany: (urls: string[]) => void;
  label?: string;
  hint?: string;
  shape?: 'square' | 'circle' | 'rect';
  previewSize?: number;
  multiple: true;
  max?: number;
  // ignored in multi mode but kept optional so callers may pass null safely
  value?: string | null;
  onChange?: (url: string | null) => void;
}

type Props = SingleProps | MultiProps;

function resolveSrc(url: string): string {
  if (!url) return '';
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

function dispatchUpload(
  endpoint: ReturnType<typeof getImagePreset>['uploadEndpoint'],
  file: File,
): Promise<{ url: string }> {
  switch (endpoint) {
    case 'image':
      return adminApi.uploadImage(file);
    case 'category':
      return adminApi.uploadCategoryImage(file);
    case 'hero-slide':
      return adminApi.uploadHeroSlide(file);
    case 'branding':
      return adminApi.uploadBranding(file) as Promise<{ url: string }>;
    case 'banner':
      return adminApi.uploadBanner(file);
    case 'instagram-post':
      return adminApi.uploadInstagramPost(file);
    case 'event':
      return adminApi.uploadEventImage(file);
    case 'payment-icon':
      return adminApi.uploadPaymentIcon(file) as Promise<{ url: string }>;
    case 'document':
      return adminApi.uploadDocument(file);
    case 'id-document':
      // admin should not be uploading id-documents; storefront handles its own path
      return adminApi.uploadDocument(file);
    default: {
      const _exhaustive: never = endpoint;
      void _exhaustive;
      return adminApi.uploadImage(file);
    }
  }
}

async function probeDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
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
  if (mime === 'application/pdf') return 'pdf';
  return fallback;
}

export default function PresetImageUploadField(props: Props) {
  const preset = getImagePreset(props.presetKey);
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const previewSize = props.previewSize ?? 96;
  const shape = props.shape ?? 'rect';
  const isMulti = props.multiple === true;
  const max = isMulti ? props.max ?? 12 : 1;
  const currentCount = isMulti ? props.values.length : props.value ? 1 : 0;
  const reachedMax = currentCount >= max;

  const performUpload = useCallback(
    async (fileToUpload: File) => {
      setUploading(true);
      try {
        const result = await dispatchUpload(preset.uploadEndpoint, fileToUpload);
        if (isMulti) {
          (props as MultiProps).onChangeMany([...(props as MultiProps).values, result.url]);
        } else {
          (props as SingleProps).onChange(result.url);
        }
        toast.success('Image uploaded');
      } catch (err: any) {
        toast.error(err?.message || 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [preset.uploadEndpoint, isMulti, props, toast],
  );

  const handleCropped = useCallback(
    async (blob: Blob) => {
      setPendingFile(null);
      const ext = extFromMime(preset.outputMime === 'passthrough' ? 'image/jpeg' : preset.outputMime, 'jpg');
      const namedFile = new File([blob], `${preset.key}-${Date.now()}.${ext}`, {
        type: preset.outputMime === 'passthrough' ? blob.type || 'image/jpeg' : preset.outputMime,
      });
      await performUpload(namedFile);
    },
    [performUpload, preset],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (reachedMax) {
        toast.error(`Maximum ${max} image${max === 1 ? '' : 's'} reached`);
        return;
      }
      if (!preset.allowedMimes.includes(file.type)) {
        toast.error(`Allowed formats: ${formatAllowedMimesForToast(preset)}`);
        return;
      }
      const maxBytes = preset.maxFileSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        toast.error(`File too large. Max ${preset.maxFileSizeMB} MB.`);
        return;
      }

      // Skip-crop path: SVG icons, ID-doc evidence (admin path normally won't hit), passthrough.
      if (preset.skipCrop) {
        // For raster files, we still validate min dims (skip for SVG / PDF — vector / non-raster).
        if (file.type !== 'image/svg+xml' && file.type !== 'application/pdf') {
          try {
            const dims = await probeDimensions(file);
            if (dims.width < preset.minSourceWidth || dims.height < preset.minSourceHeight) {
              toast.error(
                `Image too small. Minimum ${preset.minSourceWidth}×${preset.minSourceHeight}. Yours is ${dims.width}×${dims.height}.`,
              );
              return;
            }
          } catch {
            // probe failed — let server validate
          }
        }
        await performUpload(file);
        return;
      }

      // Crop path: enforce min source dimensions.
      let dims: { width: number; height: number };
      try {
        dims = await probeDimensions(file);
      } catch {
        toast.error('Could not read image dimensions');
        return;
      }
      if (dims.width < preset.minSourceWidth || dims.height < preset.minSourceHeight) {
        toast.error(
          `Image too small. Minimum ${preset.minSourceWidth}×${preset.minSourceHeight}. Yours is ${dims.width}×${dims.height}.`,
        );
        return;
      }

      setPendingFile(file);
    },
    [max, performUpload, preset, reachedMax, toast],
  );

  const removeAt = (idx: number) => {
    if (!isMulti) return;
    const next = [...(props as MultiProps).values];
    next.splice(idx, 1);
    (props as MultiProps).onChangeMany(next);
  };

  const clearSingle = () => {
    if (isMulti) return;
    (props as SingleProps).onChange(null);
  };

  const radiusClass = shape === 'circle' ? 'rounded-full' : 'rounded-lg';
  const aspectStyle =
    shape === 'rect' && preset.aspectRatio
      ? { aspectRatio: String(preset.aspectRatio) }
      : { width: previewSize, height: previewSize };

  const triggerLabel = uploading
    ? 'Uploading…'
    : isMulti
      ? `Add image (${currentCount}/${max})`
      : 'Upload image';

  const dimsHint = preset.aspectRatio
    ? `Min ${preset.minSourceWidth}×${preset.minSourceHeight}, output ${preset.outputWidth}×${preset.outputHeight}`
    : `Min ${preset.minSourceWidth}×${preset.minSourceHeight}, max ${preset.maxFileSizeMB} MB`;

  return (
    <div className="space-y-2">
      {props.label && (
        <label className="block text-xs font-medium text-[hsl(var(--foreground))]">{props.label}</label>
      )}

      {/* Multi: thumbnail grid */}
      {isMulti && (props as MultiProps).values.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {(props as MultiProps).values.map((url, i) => (
            <div
              key={`${url}-${i}`}
              className={`relative group overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--accent))] ${radiusClass}`}
              style={aspectStyle}
            >
              <img src={resolveSrc(url)} alt={`Image ${i + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                aria-label="Remove image"
                title="Remove image"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Single: thumbnail + actions */}
      {!isMulti && (props as SingleProps).value && (
        <div className="flex items-center gap-3">
          <div
            className={`relative shrink-0 overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--accent))] ${radiusClass}`}
            style={aspectStyle}
          >
            <img
              src={resolveSrc((props as SingleProps).value!)}
              alt={preset.label}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[hsl(var(--muted-foreground))] truncate" title={(props as SingleProps).value!}>
              {(props as SingleProps).value}
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="text-xs text-brand-gold hover:underline disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : 'Replace'}
              </button>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">·</span>
              <button
                type="button"
                onClick={clearSingle}
                disabled={uploading}
                className="text-xs text-red-500 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trigger button */}
      {!reachedMax && (isMulti || !(props as SingleProps).value) && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] hover:border-brand-gold/50 hover:text-[hsl(var(--foreground))] transition-colors disabled:opacity-50"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> {triggerLabel}
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" /> {triggerLabel}
            </>
          )}
        </button>
      )}

      <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
        {props.hint ?? dimsHint}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={preset.allowedMimes.join(',')}
        className="hidden"
        aria-label={`Upload ${preset.label}`}
        title={`Upload ${preset.label}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />

      {pendingFile && (
        <ImageCropModal
          file={pendingFile}
          preset={preset}
          onCropped={handleCropped}
          onCancel={() => setPendingFile(null)}
        />
      )}
    </div>
  );
}
