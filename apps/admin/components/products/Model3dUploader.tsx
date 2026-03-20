'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Box, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import adminApi from '@/lib/api';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ACCEPTED_EXTENSIONS = ['.glb', '.gltf'];

interface Props {
  modelUrl: string | null;
  posterUrl: string | null;
  onModelChange: (url: string | null) => void;
  onPosterChange: (url: string | null) => void;
}

function resolveUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

export default function Model3dUploader({ modelUrl, posterUrl, onModelChange, onPosterChange }: Props) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const viewerContainerRef = useRef<HTMLDivElement>(null);

  // Dynamically load model-viewer web component
  useEffect(() => {
    if (modelUrl && typeof window !== 'undefined') {
      import('@google/model-viewer').catch(() => {
        // model-viewer may already be registered or package not installed
        // attempt CDN fallback
        if (!customElements.get('model-viewer')) {
          const script = document.createElement('script');
          script.type = 'module';
          script.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';
          document.head.appendChild(script);
        }
      });
    }
  }, [modelUrl]);

  const validateFile = useCallback((file: File): boolean => {
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      toast.error('Only .glb and .gltf files are allowed');
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File size exceeds 25MB limit');
      return false;
    }
    return true;
  }, [toast]);

  const handleUpload = useCallback(async (file: File) => {
    if (!validateFile(file)) return;

    setUploading(true);
    try {
      const result = await adminApi.upload3dModel(file);
      onModelChange(result.url);
      toast.success('3D model uploaded successfully');
    } catch (err: any) {
      toast.error(err.message || '3D model upload failed');
    } finally {
      setUploading(false);
    }
  }, [validateFile, onModelChange, toast]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;
    handleUpload(file);
  }, [handleUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleRemove = () => {
    onModelChange(null);
    onPosterChange(null);
  };

  const resolvedModelUrl = resolveUrl(modelUrl);
  const resolvedPosterUrl = resolveUrl(posterUrl);

  return (
    <div className="space-y-3">
      {/* Preview */}
      {modelUrl && resolvedModelUrl && (
        <div className="relative group">
          <div
            ref={viewerContainerRef}
            className="w-full aspect-square rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--accent))] overflow-hidden"
          >
            <model-viewer
              src={resolvedModelUrl}
              alt="3D model preview"
              poster={resolvedPosterUrl || undefined}
              camera-controls=""
              auto-rotate=""
              shadow-intensity="1"
              loading="lazy"
              style={{ width: '100%', height: '100%' }}
            />
          </div>
          <button
            type="button"
            onClick={handleRemove}
            className="absolute top-2 right-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 text-white text-[10px] font-medium">
            <Box className="w-3 h-3" />
            3D Model
          </div>
        </div>
      )}

      {/* Drop Zone */}
      {!modelUrl && (
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
              <Loader2 className="w-8 h-8 text-brand-gold animate-spin" />
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Uploading 3D model...</p>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-[hsl(var(--accent))] flex items-center justify-center">
                {dragOver ? (
                  <Box className="w-5 h-5 text-brand-gold" />
                ) : (
                  <Upload className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                  {dragOver ? 'Drop 3D model here' : 'Drag & drop or click to browse'}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                  GLB or GLTF format &bull; Max 25MB
                </p>
              </div>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
        </div>
      )}
    </div>
  );
}
