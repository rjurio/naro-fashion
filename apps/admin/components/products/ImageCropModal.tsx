'use client';

import { useState, useRef, useCallback } from 'react';
import Cropper, { ReactCropperElement } from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import type { ImagePreset } from '@naro/shared';
import { Modal } from '../ui/Modal';

interface Props {
  file: File;
  onCropped: (blob: Blob) => void;
  onCancel: () => void;
  preset?: ImagePreset;
}

const DEFAULT_ASPECT = 3 / 4;
const DEFAULT_OUTPUT_W = 900;
const DEFAULT_OUTPUT_H = 1200;
const DEFAULT_MIME: 'image/jpeg' = 'image/jpeg';

export default function ImageCropModal({ file, onCropped, onCancel, preset }: Props) {
  const cropperRef = useRef<ReactCropperElement>(null);
  const aspect = preset?.aspectRatio ?? DEFAULT_ASPECT;
  const outW = preset?.outputWidth ?? DEFAULT_OUTPUT_W;
  const outH = preset?.outputHeight ?? DEFAULT_OUTPUT_H;
  const outputMime: 'image/jpeg' | 'image/png' =
    preset?.outputMime === 'image/png' ? 'image/png' : DEFAULT_MIME;
  const isLossless = outputMime === 'image/png';

  const initialQuality = preset ? Math.round(preset.quality * 100) : 80;
  const [quality, setQuality] = useState(initialQuality);
  const [imageUrl] = useState(() => URL.createObjectURL(file));

  const handleCrop = useCallback(() => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper) return;

    const canvas = cropper.getCroppedCanvas({
      width: outW,
      height: outH,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });

    if (isLossless) {
      canvas.toBlob((blob) => {
        if (blob) onCropped(blob);
      }, outputMime);
    } else {
      canvas.toBlob(
        (blob) => {
          if (blob) onCropped(blob);
        },
        outputMime,
        quality / 100,
      );
    }
  }, [quality, onCropped, outW, outH, outputMime, isLossless]);

  const title = preset?.label ? `Crop ${preset.label}` : 'Crop Image';
  const dimsLabel = `${outW}×${outH}`;

  return (
    <Modal isOpen title={title} size="lg" onClose={onCancel}>
      <div className="space-y-4">
        <div className="max-h-[60vh] overflow-hidden rounded-lg bg-black">
          <Cropper
            ref={cropperRef}
            src={imageUrl}
            style={{ height: '60vh', width: '100%' }}
            aspectRatio={aspect}
            guides
            viewMode={1}
            dragMode="move"
            autoCropArea={0.9}
            background={false}
          />
        </div>

        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Output: <span className="font-mono">{dimsLabel}</span>
          {isLossless ? ' · PNG (lossless)' : ' · JPEG'}
        </p>

        {!isLossless && (
          <div className="flex items-center gap-3">
            <label className="text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
              Quality: {quality}%
            </label>
            <input
              type="range"
              min={40}
              max={100}
              step={5}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="flex-1 h-1.5 accent-brand-gold"
              aria-label="JPEG quality"
            />
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]"
          >
            Cancel
          </button>
          <button
            onClick={handleCrop}
            className="px-4 py-2 text-sm rounded-lg bg-brand-gold text-black font-medium hover:bg-brand-gold/90"
          >
            Crop & Upload
          </button>
        </div>
      </div>
    </Modal>
  );
}
