'use client';

import { useState, useRef, useCallback } from 'react';
import Cropper, { ReactCropperElement } from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import { Modal } from '../ui/Modal';

interface Props {
  file: File;
  onCropped: (blob: Blob) => void;
  onCancel: () => void;
}

export default function ImageCropModal({ file, onCropped, onCancel }: Props) {
  const cropperRef = useRef<ReactCropperElement>(null);
  const [quality, setQuality] = useState(80);
  const [imageUrl] = useState(() => URL.createObjectURL(file));

  const handleCrop = useCallback(() => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper) return;

    const canvas = cropper.getCroppedCanvas({
      width: 900,
      height: 1200,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });

    canvas.toBlob(
      (blob) => {
        if (blob) onCropped(blob);
      },
      'image/jpeg',
      quality / 100,
    );
  }, [quality, onCropped]);

  return (
    <Modal isOpen title="Crop Image" size="lg" onClose={onCancel}>
      <div className="space-y-4">
        <div className="max-h-[60vh] overflow-hidden rounded-lg bg-black">
          <Cropper
            ref={cropperRef}
            src={imageUrl}
            style={{ height: '60vh', width: '100%' }}
            aspectRatio={3 / 4}
            guides
            viewMode={1}
            dragMode="move"
            autoCropArea={0.9}
            background={false}
          />
        </div>

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
          />
        </div>

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
