'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Upload, RotateCcw, Loader2 } from 'lucide-react';

interface ImageUploadFieldProps {
  label: string;
  currentUrl: string;
  defaultUrl: string;
  onUpload: (file: File) => Promise<string>;
  onReset: () => void;
  previewSize?: number;
  shape?: 'square' | 'circle';
  hint?: string;
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
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setUploading(true);
    try {
      await onUpload(file);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const isDefault = currentUrl === defaultUrl;
  const apiOrigin = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');
  const displayUrl = currentUrl.startsWith('/uploads') ? `${apiOrigin}${currentUrl}` : currentUrl;

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
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
}
