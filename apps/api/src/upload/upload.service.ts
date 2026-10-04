import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { join } from 'path';
import { writeFile, mkdir, stat } from 'fs/promises';
import { randomBytes } from 'crypto';
import { imageSize } from 'image-size';
import {
  clientExtension,
  detectIdDocType,
  detectModelType,
  ID_DOC_CONTENT_TYPES,
  isPdf,
} from './file-signature.util';
import {
  buildIdDocRef,
  idDocAbsolutePath,
  parseIdDocKey,
  resolvePrivateRoot,
  TENANT_SEGMENT_RE,
} from './private-storage.util';

const MAX_DIMENSION = 4000;
export const MAX_MODEL_BYTES = 25 * 1024 * 1024;
export const MAX_ID_DOC_BYTES = 8 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function assertDimensionsWithinCap(
  buffer: Buffer,
  mimetype: string,
  logger: Logger,
): void {
  if (!mimetype.startsWith('image/')) return;
  if (mimetype === 'image/svg+xml') return;
  let dims: { width?: number; height?: number };
  try {
    dims = imageSize(buffer);
  } catch (err) {
    logger.warn(`[UPLOAD] image-size probe failed: ${(err as Error).message}`);
    throw new BadRequestException('Invalid image file');
  }
  if (!dims.width || !dims.height) {
    throw new BadRequestException('Could not read image dimensions');
  }
  if (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
    throw new BadRequestException(
      `Image dimensions ${dims.width}×${dims.height} exceed max ${MAX_DIMENSION}×${MAX_DIMENSION}`,
    );
  }
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadsDir = join(process.cwd(), 'uploads', 'products');

  /**
   * Public raster-image upload (JPEG/PNG/WebP) into `uploads/<folder>/`.
   * Pass `allowPdf` for the documents folder: a PDF is accepted only when
   * its bytes really start with `%PDF-`. The stored extension always comes
   * from the validated type, never from the client filename.
   */
  async uploadToFolder(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    folder: string,
    opts: { allowPdf?: boolean } = {},
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }
    let ext: string;
    if (opts.allowPdf && file.mimetype === 'application/pdf') {
      if (file.buffer.length > MAX_DOCUMENT_BYTES) {
        throw new BadRequestException('File size exceeds 10MB limit');
      }
      if (!isPdf(file.buffer)) {
        throw new BadRequestException('File content is not a valid PDF');
      }
      ext = 'pdf';
    } else {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new BadRequestException('Only JPEG, PNG, and WebP images are allowed');
      }
      if (file.buffer.length > 5 * 1024 * 1024) {
        throw new BadRequestException('File size exceeds 5MB limit');
      }
      assertDimensionsWithinCap(file.buffer, file.mimetype, this.logger);
      ext = file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : file.mimetype.split('/')[1];
    }
    const dir = join(process.cwd(), 'uploads', folder);
    await mkdir(dir, { recursive: true });
    const filename = `${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
    const filepath = join(dir, filename);
    await writeFile(filepath, file.buffer);
    this.logger.log(`[UPLOAD] Saved to ${folder}: ${filename}`);
    return { url: `/uploads/${folder}/${filename}`, filename, format: ext };
  }

  async uploadImage(file: { originalname: string; buffer: Buffer; mimetype: string }) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP images are allowed');
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.buffer.length > maxSize) {
      throw new BadRequestException('File size exceeds 5MB limit');
    }

    assertDimensionsWithinCap(file.buffer, file.mimetype, this.logger);

    await mkdir(this.uploadsDir, { recursive: true });

    const ext = file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : file.mimetype.split('/')[1];
    const filename = `${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
    const filepath = join(this.uploadsDir, filename);

    await writeFile(filepath, file.buffer);
    this.logger.log(`[UPLOAD] Saved image: ${filename}`);

    return {
      url: `/uploads/products/${filename}`,
      filename,
      format: ext,
    };
  }

  /**
   * 3D model upload (GLB / GLTF). Previously any file passed: the filter
   * accepted the client-claimed `application/octet-stream` and the stored
   * extension came from `originalname` (e.g. `evil.html` → served as HTML
   * from /uploads). Now: the client extension must be .glb/.gltf AND the
   * bytes must match (GLB magic "glTF" / .gltf JSON with an `asset` key),
   * and the stored extension is forced from the validated type.
   */
  async uploadModel(file: { originalname: string; buffer: Buffer; mimetype: string; size?: number }) {
    if (!file || !file.buffer) throw new BadRequestException('No file provided');
    if (file.buffer.length > MAX_MODEL_BYTES) {
      throw new BadRequestException('File size exceeds 25MB limit');
    }
    const claimed = clientExtension(file.originalname);
    if (claimed !== 'glb' && claimed !== 'gltf') {
      throw new BadRequestException('Only .glb and .gltf 3D model files are allowed');
    }
    const detected = detectModelType(file.buffer);
    if (!detected || detected !== claimed) {
      throw new BadRequestException('File content is not a valid GLB/GLTF 3D model');
    }
    const dir = join(process.cwd(), 'uploads', 'models');
    await mkdir(dir, { recursive: true });
    const filename = `${Date.now()}-${randomBytes(6).toString('hex')}.${detected}`;
    await writeFile(join(dir, filename), file.buffer);
    this.logger.log(`[UPLOAD] Saved to models: ${filename}`);
    return { url: `/uploads/models/${filename}`, filename, format: detected };
  }

  /**
   * Customer National-ID evidence. Was a MOCK that discarded the file and
   * returned a fake Cloudinary URL built from the client filename.
   *
   * Now stored in PRIVATE storage (outside the ServeStaticModule root — see
   * private-storage.util.ts), only JPEG/PNG/WebP/PDF verified by magic bytes,
   * max 8MB, random filename, extension forced from the detected type. The
   * original filename is never logged or persisted (it can contain the
   * customer's name / ID number). Returns an opaque `private://` reference
   * that only the admin-only streaming endpoint can resolve.
   *
   * ID documents are evidence — DO NOT crop, resize, or recompress.
   */
  async uploadIdDocument(
    file: { originalname?: string; buffer: Buffer; mimetype?: string },
    side: 'front' | 'back',
    tenantId: string,
  ) {
    if (!file || !file.buffer) throw new BadRequestException('No file provided');
    if (file.buffer.length > MAX_ID_DOC_BYTES) {
      throw new BadRequestException('File size exceeds 8MB limit');
    }
    if (!tenantId || !TENANT_SEGMENT_RE.test(tenantId)) {
      throw new BadRequestException('Tenant context is required');
    }
    const type = detectIdDocType(file.buffer);
    if (!type) {
      throw new BadRequestException('Only JPEG, PNG, WebP images or PDF documents are allowed');
    }
    if (type !== 'pdf') {
      assertDimensionsWithinCap(file.buffer, ID_DOC_CONTENT_TYPES[type], this.logger);
    }

    const root = resolvePrivateRoot();
    const fileName = `${randomBytes(16).toString('hex')}.${type}`;
    const fullPath = idDocAbsolutePath(root, tenantId, fileName);
    if (!fullPath) throw new BadRequestException('Invalid storage path');
    await mkdir(join(root, 'id-documents', tenantId), { recursive: true });
    await writeFile(fullPath, file.buffer, { mode: 0o600 });
    this.logger.log(`[UPLOAD] ID document (${side === 'back' ? 'back' : 'front'}) stored privately for tenant ${tenantId}`);

    return {
      url: buildIdDocRef(tenantId, fileName),
      side: side === 'back' ? 'back' : 'front',
      format: type,
    };
  }

  /**
   * Resolve an ID-document key for admin streaming. Returns null when the
   * key is malformed, belongs to another tenant, or the file is missing.
   * `callerTenantId` null = platform admin (may read any tenant).
   */
  async resolveIdDocument(
    key: string,
    callerTenantId: string | null,
    isPlatformAdmin: boolean,
  ): Promise<{ path: string; contentType: string; size: number; tenantId: string; fileName: string } | null> {
    const parsed = parseIdDocKey(key);
    if (!parsed) return null;
    if (!isPlatformAdmin && parsed.tenantId !== callerTenantId) return null;
    const fullPath = idDocAbsolutePath(resolvePrivateRoot(), parsed.tenantId, parsed.fileName);
    if (!fullPath) return null;
    try {
      const st = await stat(fullPath);
      if (!st.isFile()) return null;
      const ext = parsed.fileName.split('.').pop() as keyof typeof ID_DOC_CONTENT_TYPES;
      return {
        path: fullPath,
        contentType: ID_DOC_CONTENT_TYPES[ext],
        size: st.size,
        tenantId: parsed.tenantId,
        fileName: parsed.fileName,
      };
    } catch {
      return null;
    }
  }
}
