---
title: "3D Product View — Implementation Plan"
subtitle: "Naro Fashion Multi-Tenant SaaS Platform"
date: "March 2026"
---

# 3D Product View — Implementation Plan

## Overview

This document describes the implementation of interactive 3D product viewing on the Naro Fashion e-commerce storefront using Google's open-source `<model-viewer>` web component. The feature allows customers to rotate, zoom, and on mobile use AR ("View in your space") to interact with product 3D models.

### Why `<model-viewer>`

| Feature | Detail |
|---------|--------|
| **Cost** | Free, open-source (Google) |
| **Formats** | GLB/GLTF (industry standard) |
| **Interaction** | Rotate, zoom, pan (mouse + touch) |
| **AR Support** | Built-in — Android Scene Viewer, iOS Quick Look |
| **Bundle Size** | ~100KB gzipped, lazy-loadable |
| **Browser Support** | All modern browsers + mobile Safari/Chrome |

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Admin Panel    │     │    NestJS API     │     │   Storefront    │
│                  │     │                  │     │                  │
│ Model3dUploader  │────>│ POST /upload/    │     │ ModelViewer      │
│ (drag-drop GLB)  │     │   3d-model       │     │ (<model-viewer>) │
│                  │     │                  │     │                  │
│ ProductForm      │────>│ Product CRUD     │────>│ Photos/3D Toggle │
│ (model3dUrl)     │     │ (model3dUrl)     │     │ (lazy loaded)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

---

## Phase 1: Database & API

### Database Schema Changes

Two new nullable fields added to the `Product` model:

```prisma
model Product {
  // ... existing fields ...

  model3dUrl        String?   // URL to GLB/GLTF file in /uploads/models/
  model3dPosterUrl  String?   // Optional poster image while 3D loads

  // ... rest of model ...
}
```

### API Endpoints

| Method | Endpoint | Description | Limit |
|--------|----------|-------------|-------|
| `POST` | `/upload/3d-model` | Upload GLB/GLTF file | 25MB |
| `POST` | `/products` | Create product (includes `model3dUrl`) | — |
| `PATCH` | `/products/:id` | Update product (includes `model3dUrl`) | — |

**Upload validation:**
- Accepted MIME types: `model/gltf-binary`, `model/gltf+json`, `application/octet-stream`
- Also checks file extension: `.glb`, `.gltf`
- Max file size: 25MB
- Storage: `uploads/models/` directory

### Product DTOs

Both `CreateProductDto` and `UpdateProductDto` include:

```typescript
@IsOptional()
@IsString()
model3dUrl?: string;

@IsOptional()
@IsString()
model3dPosterUrl?: string;
```

---

## Phase 2: Admin Dashboard

### Model3dUploader Component

**File:** `apps/admin/components/products/Model3dUploader.tsx`

A drag-and-drop upload component for 3D model files with:

- Drag-and-drop zone accepting `.glb/.gltf` (max 25MB)
- Upload progress spinner
- Live `<model-viewer>` preview after upload (camera controls + auto-rotate)
- Remove button to clear the model
- Toast notifications for errors/success

**Props:**
```typescript
interface Props {
  modelUrl: string | null;
  posterUrl: string | null;
  onModelChange: (url: string | null) => void;
  onPosterChange: (url: string | null) => void;
}
```

### ProductForm Integration

The `Model3dUploader` is rendered in a new "3D Model (Optional)" section between the Images and Variants sections of the existing `ProductForm`.

---

## Phase 3: Storefront

### ModelViewer Component

**File:** `apps/storefront/components/product/ModelViewer.tsx`

A client component that dynamically imports `@google/model-viewer` and renders an interactive 3D viewer with:

- Camera controls (mouse/touch rotate, zoom, pan)
- Auto-rotate when not interacting
- AR support on mobile devices
- Lazy loading (model downloads only when viewer is visible)
- Shadow and lighting for realistic presentation

### Product Detail Page Toggle

When a product has a 3D model (`model3dUrl` is set), the product detail page shows two toggle buttons above the image gallery:

| Button | Icon | Description |
|--------|------|-------------|
| **Photos** | Image icon | Shows the existing photo gallery (default) |
| **3D View** | Box icon | Shows the interactive 3D model viewer |

The 3D viewer is lazy-loaded via `next/dynamic` with `ssr: false` — it only downloads when the user clicks "3D View", ensuring zero impact on page load speed.

**Poster image:** While the 3D model loads, a poster image is shown. If no dedicated poster is set, the product's primary photo is used as fallback.

**AR on mobile:** The `<model-viewer>` component automatically shows an AR button on supported devices:
- **Android:** Google Scene Viewer (Chrome)
- **iOS:** Apple Quick Look (Safari, iOS 12+)

---

## Content Creation Guide

### How to Create 3D Models from Product Photos

#### Recommended Free Tools

| Tool | Platform | Method | Best For |
|------|----------|--------|----------|
| **Luma AI** | Web (lumalabs.ai/genie) | Upload 8-20 photos → AI generates 3D | Gowns on mannequins |
| **Polycam** | iOS / Android app | Photo or LiDAR scan → export GLB | Quick captures |
| **Meshroom** | Windows (NVIDIA GPU) | Photogrammetry from 20-50 photos | High-detail items |
| **Blender** | All platforms | Manual 3D modeling → export GLB | Full creative control |
| **Sketchfab** | Web marketplace | Download free CC-licensed models | Generic fashion items |

#### Photography Tips for Best 3D Results

1. **Lighting:** Use consistent, even lighting — no harsh shadows
2. **Background:** Place product on solid white or light gray background
3. **Angles:** Take photos at 3 heights — eye level, 45° above, slightly below
4. **Coverage:** Walk around the product, taking a photo every 10-15° (20-30 total)
5. **Overlap:** Each photo should overlap ~60-70% with the previous one
6. **Details:** Include close-ups of fabric texture, embellishments, labels
7. **Distance:** Keep consistent distance from the product

#### File Optimization

GLB files should ideally be under 5MB for fast loading on mobile networks in Tanzania. Use this free tool to compress:

```bash
npx @gltf-transform/cli optimize model.glb optimized.glb --compress draco
```

### Recommended Workflow

1. Place the garment on a dress form or mannequin
2. Take 20-30 photos walking around it in a circle
3. Upload to **Luma AI** or **Polycam**
4. Export as **GLB** format (single file with embedded textures)
5. Optimize with `gltf-transform` if over 5MB
6. Upload via admin dashboard → Product Edit → 3D Model section

---

## Technical Details

### Dependencies

| Package | Version | Apps |
|---------|---------|------|
| `@google/model-viewer` | ^4.0.0 | admin, storefront |

### Type Declarations

Both admin and storefront need a TypeScript declaration file for the `<model-viewer>` web component:

**`types/model-viewer.d.ts`:**
```typescript
declare namespace JSX {
  interface IntrinsicElements {
    'model-viewer': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>, HTMLElement
    > & {
      src?: string;
      alt?: string;
      poster?: string;
      'camera-controls'?: boolean | string;
      'auto-rotate'?: boolean | string;
      ar?: boolean | string;
      'ar-modes'?: string;
      loading?: string;
      'shadow-intensity'?: string;
      style?: React.CSSProperties;
    };
  }
}
```

### Files Modified/Created

| File | Action |
|------|--------|
| `packages/database/prisma/schema.prisma` | Modified — added 2 fields to Product |
| `apps/api/src/upload/upload.controller.ts` | Modified — added 3D model upload endpoint |
| `apps/api/src/upload/upload.service.ts` | Modified — added `skipMimeCheck` parameter |
| `apps/api/src/products/dto/create-product.dto.ts` | Modified — added 3D fields |
| `apps/api/src/products/dto/update-product.dto.ts` | Modified — added 3D fields |
| `apps/admin/types/model-viewer.d.ts` | Created |
| `apps/admin/components/products/Model3dUploader.tsx` | Created |
| `apps/admin/components/products/ProductForm.tsx` | Modified — added 3D section |
| `apps/admin/lib/api.ts` | Modified — added `upload3dModel` method |
| `apps/storefront/types/model-viewer.d.ts` | Created |
| `apps/storefront/components/product/ModelViewer.tsx` | Created |
| `apps/storefront/app/products/[slug]/page.tsx` | Modified — added Photos/3D toggle |

---

## Testing Checklist

- [ ] Upload a sample GLB file via admin product edit form
- [ ] Verify 3D preview works in admin after upload
- [ ] Open product on storefront — verify "Photos" / "3D View" toggle appears
- [ ] Click "3D View" — verify model loads with rotation/zoom
- [ ] Test auto-rotate stops when user interacts, resumes when idle
- [ ] Test on mobile — verify AR button appears (Android/iOS)
- [ ] Test product WITHOUT 3D model — verify no toggle, normal gallery only
- [ ] Edit product → remove 3D model → save → verify toggle disappears
- [ ] Test with large GLB file (15-20MB) — verify upload works within 25MB limit
- [ ] Test poster image fallback (when no dedicated poster, uses primary product image)

---

*Document generated for Naro Fashion — March 2026*
