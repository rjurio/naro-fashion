'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import adminApi from '@/lib/api';
import ImageCropModal from './ImageCropModal';

interface Props {
  images: string[];
  onChange: (images: string[]) => void;
  maxImages?: number;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function ImageUploader({ images, onChange, maxImages = 8 }: Props) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error('Only JPEG, PNG, and WebP images are allowed');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error('File size exceeds 5MB limit');
      return;
    }

    if (images.length >= maxImages) {
      toast.error(`Maximum ${maxImages} images allowed`);
      return;
    }

    setCropFile(file);
  }, [images.length, maxImages, toast]);

  const handleCropped = useCallback(async (blob: Blob) => {
    setCropFile(null);
    setUploading(true);
    try {
      const file = new File([blob], `product-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const result = await adminApi.uploadImage(file);
      onChange([...images, result.url]);
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [images, onChange, toast]);

  const removeImage = (index: number) => {
    onChange(images.filter((_, i) => i !== index));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div className="space-y-3">
      {/* Thumbnail Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {images.map((url, i) => (
            <div key={i} className="relative group aspect-[3/4] rounded-lg overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--accent))]">
              <img
                src={url.startsWith('/') ? `http://localhost:4000${url}` : url}
                alt={`Product image ${i + 1}`}
                className="w-full h-full object-cover"
              />
              {i === 0 && (
                <span className="absolute top-1 left-1 text-[9px] font-bold bg-brand-gold text-black px-1.5 py-0.5 rounded">
                  PRIMARY
                </span>
              )}
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drop Zone */}
      {images.length < maxImages && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
            dragOver
              ? 'border-brand-gold bg-brand-gold/5'
              : 'border-[hsl(var(--border))] hover:border-brand-gold/50'
          }`}
        >
          {uploading ? (
            <>
              <div className="w-8 h-8 border-2 border-brand-gold border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Uploading...</p>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-[hsl(var(--accent))] flex items-center justify-center">
                {dragOver ? (
                  <ImageIcon className="w-5 h-5 text-brand-gold" />
                ) : (
                  <Upload className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                  {dragOver ? 'Drop image here' : 'Drag & drop or click to browse'}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                  JPEG, PNG, WebP • Max 5MB • {images.length}/{maxImages}
                </p>
              </div>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
        </div>
      )}

      {/* Crop Modal */}
      {cropFile && (
        <ImageCropModal
          file={cropFile}
          onCropped={handleCropped}
          onCancel={() => setCropFile(null)}
        />
      )}
    </div>
  );
}
