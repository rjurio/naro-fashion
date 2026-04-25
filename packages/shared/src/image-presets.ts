// Image upload presets — single source of truth for client-side validation,
// crop aspect ratios, output dimensions, quality, and per-context size limits.
// Sized to cover the largest CSS render box per context at 2x DPR.

export type ImagePresetKey =
  | 'product'
  | 'heroSlide'
  | 'parallaxBackdrop'
  | 'category'
  | 'eventCover'
  | 'eventGallery'
  | 'instagramPost'
  | 'banner'
  | 'logoSquare'
  | 'favicon'
  | 'logoWide'
  | 'paymentIcon'
  | 'newsletterInline'
  | 'idDocument';

export type ImageOutputMime = 'image/jpeg' | 'image/png' | 'passthrough';

export interface ImagePreset {
  key: ImagePresetKey;
  label: string;
  // null => freeform / no fixed crop
  aspectRatio: number | null;
  outputWidth: number;
  outputHeight: number;
  outputMime: ImageOutputMime;
  // 0..1, ignored when outputMime === 'passthrough'
  quality: number;
  minSourceWidth: number;
  minSourceHeight: number;
  maxFileSizeMB: number;
  allowedMimes: string[];
  // true => upload original bytes as-is (SVG icon, evidence document, RTE inline resize-only)
  skipCrop: boolean;
  // Matches /upload/<endpoint> on the API
  uploadEndpoint:
    | 'image'
    | 'hero-slide'
    | 'category'
    | 'branding'
    | 'banner'
    | 'instagram-post'
    | 'event'
    | 'payment-icon'
    | 'document'
    | 'id-document';
}

const STD_RASTER = ['image/jpeg', 'image/png', 'image/webp'];

export const IMAGE_PRESETS: Record<ImagePresetKey, ImagePreset> = {
  product: {
    key: 'product',
    label: 'Product photo (3:4)',
    aspectRatio: 3 / 4,
    outputWidth: 1200,
    outputHeight: 1600,
    outputMime: 'image/jpeg',
    quality: 0.85,
    minSourceWidth: 900,
    minSourceHeight: 1200,
    maxFileSizeMB: 5,
    allowedMimes: STD_RASTER,
    skipCrop: false,
    uploadEndpoint: 'image',
  },
  heroSlide: {
    key: 'heroSlide',
    label: 'Hero slide (3:4)',
    aspectRatio: 3 / 4,
    outputWidth: 1200,
    outputHeight: 1600,
    outputMime: 'image/jpeg',
    quality: 0.85,
    minSourceWidth: 1000,
    minSourceHeight: 1333,
    maxFileSizeMB: 5,
    allowedMimes: STD_RASTER,
    skipCrop: false,
    uploadEndpoint: 'hero-slide',
  },
  parallaxBackdrop: {
    key: 'parallaxBackdrop',
    label: 'Parallax backdrop (16:9)',
    aspectRatio: 16 / 9,
    outputWidth: 1920,
    outputHeight: 1080,
    outputMime: 'image/jpeg',
    quality: 0.82,
    minSourceWidth: 1600,
    minSourceHeight: 900,
    maxFileSizeMB: 5,
    allowedMimes: STD_RASTER,
    skipCrop: false,
    uploadEndpoint: 'image',
  },
  category: {
    key: 'category',
    label: 'Category tile (3:4)',
    aspectRatio: 3 / 4,
    outputWidth: 1200,
    outputHeight: 1600,
    outputMime: 'image/jpeg',
    quality: 0.82,
    minSourceWidth: 900,
    minSourceHeight: 1200,
    maxFileSizeMB: 5,
    allowedMimes: STD_RASTER,
    skipCrop: false,
    uploadEndpoint: 'category',
  },
  eventCover: {
    key: 'eventCover',
    label: 'Event cover (16:9)',
    aspectRatio: 16 / 9,
    outputWidth: 1920,
    outputHeight: 1080,
    outputMime: 'image/jpeg',
    quality: 0.82,
    minSourceWidth: 1600,
    minSourceHeight: 900,
    maxFileSizeMB: 5,
    allowedMimes: STD_RASTER,
    skipCrop: false,
    uploadEndpoint: 'event',
  },
  eventGallery: {
    key: 'eventGallery',
    label: 'Event gallery photo (3:4)',
    aspectRatio: 3 / 4,
    outputWidth: 1200,
    outputHeight: 1600,
    outputMime: 'image/jpeg',
    quality: 0.82,
    minSourceWidth: 900,
    minSourceHeight: 1200,
    maxFileSizeMB: 5,
    allowedMimes: STD_RASTER,
    skipCrop: false,
    uploadEndpoint: 'event',
  },
  instagramPost: {
    key: 'instagramPost',
    label: 'Instagram post (1:1)',
    aspectRatio: 1,
    outputWidth: 1080,
    outputHeight: 1080,
    outputMime: 'image/jpeg',
    quality: 0.85,
    minSourceWidth: 800,
    minSourceHeight: 800,
    maxFileSizeMB: 5,
    allowedMimes: STD_RASTER,
    skipCrop: false,
    uploadEndpoint: 'instagram-post',
  },
  banner: {
    key: 'banner',
    label: 'Banner (16:9)',
    aspectRatio: 16 / 9,
    outputWidth: 1920,
    outputHeight: 1080,
    outputMime: 'image/jpeg',
    quality: 0.82,
    minSourceWidth: 1600,
    minSourceHeight: 900,
    maxFileSizeMB: 5,
    allowedMimes: STD_RASTER,
    skipCrop: false,
    uploadEndpoint: 'banner',
  },
  logoSquare: {
    key: 'logoSquare',
    label: 'Square logo / icon (1:1)',
    aspectRatio: 1,
    outputWidth: 256,
    outputHeight: 256,
    outputMime: 'image/png',
    quality: 0.92,
    minSourceWidth: 256,
    minSourceHeight: 256,
    maxFileSizeMB: 2,
    allowedMimes: STD_RASTER,
    skipCrop: false,
    uploadEndpoint: 'branding',
  },
  favicon: {
    key: 'favicon',
    label: 'Favicon (1:1)',
    aspectRatio: 1,
    outputWidth: 256,
    outputHeight: 256,
    outputMime: 'image/png',
    quality: 0.92,
    minSourceWidth: 128,
    minSourceHeight: 128,
    maxFileSizeMB: 1,
    allowedMimes: STD_RASTER,
    skipCrop: false,
    uploadEndpoint: 'branding',
  },
  logoWide: {
    key: 'logoWide',
    label: 'Wide logo (3:1)',
    aspectRatio: 3 / 1,
    outputWidth: 1200,
    outputHeight: 400,
    outputMime: 'image/png',
    quality: 0.9,
    minSourceWidth: 600,
    minSourceHeight: 200,
    maxFileSizeMB: 2,
    allowedMimes: STD_RASTER,
    skipCrop: false,
    uploadEndpoint: 'branding',
  },
  paymentIcon: {
    key: 'paymentIcon',
    label: 'Payment method icon',
    aspectRatio: null,
    outputWidth: 160,
    outputHeight: 112,
    outputMime: 'passthrough',
    quality: 1,
    minSourceWidth: 80,
    minSourceHeight: 56,
    maxFileSizeMB: 2,
    allowedMimes: [...STD_RASTER, 'image/svg+xml'],
    skipCrop: true,
    uploadEndpoint: 'payment-icon',
  },
  newsletterInline: {
    key: 'newsletterInline',
    label: 'Inline newsletter image',
    aspectRatio: null,
    outputWidth: 1200,
    outputHeight: 0, // 0 => preserve aspect ratio (resize-only path)
    outputMime: 'image/jpeg',
    quality: 0.8,
    minSourceWidth: 300,
    minSourceHeight: 200,
    maxFileSizeMB: 5,
    allowedMimes: STD_RASTER,
    skipCrop: true, // RTE skips crop UI; resizes via canvas before upload
    uploadEndpoint: 'image',
  },
  idDocument: {
    key: 'idDocument',
    label: 'ID document (evidence)',
    aspectRatio: null,
    outputWidth: 0,
    outputHeight: 0,
    outputMime: 'passthrough',
    quality: 1,
    minSourceWidth: 600,
    minSourceHeight: 400,
    maxFileSizeMB: 8,
    allowedMimes: [...STD_RASTER, 'application/pdf'],
    skipCrop: true,
    uploadEndpoint: 'id-document',
  },
};

export function getImagePreset(key: ImagePresetKey): ImagePreset {
  return IMAGE_PRESETS[key];
}

export function formatAllowedMimesForToast(preset: ImagePreset): string {
  return preset.allowedMimes
    .map((m) => m.replace('image/', '').replace('application/', '').toUpperCase())
    .join(', ');
}
