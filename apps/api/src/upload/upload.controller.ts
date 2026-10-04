import {
  Controller,
  Get,
  Post,
  Param,
  Res,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  Query,
  BadRequestException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
/// <reference types="multer" />
import { Response } from 'express';
import { createReadStream } from 'fs';
import { UploadService, MAX_ID_DOC_BYTES, MAX_MODEL_BYTES } from './upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';

// Every route here is admin-only EXCEPT /id-document, which logged-in
// customers hit during the rental ID-verification flow. AdminGuard is wired
// per-method so id-document stays customer-accessible; everything else is
// gated so a customer JWT can't upload product / branding / hero / etc. assets.
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  @Post('image')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPEG, PNG, and WebP images are allowed'), false);
        }
      },
    }),
  )
  uploadImage(@UploadedFile() file: any) {
    return this.uploadService.uploadImage(file);
  }

  @Post('hero-slide')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPEG, PNG, and WebP images are allowed'), false);
        }
      },
    }),
  )
  uploadHeroSlide(@UploadedFile() file: any) {
    return this.uploadService.uploadToFolder(file, 'hero-slides');
  }

  @Post('category')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPEG, PNG, and WebP images are allowed'), false);
        }
      },
    }),
  )
  uploadCategory(@UploadedFile() file: any) {
    return this.uploadService.uploadToFolder(file, 'categories');
  }

  @Post('banner')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPEG, PNG, and WebP images are allowed'), false);
        }
      },
    }),
  )
  uploadBanner(@UploadedFile() file: any) {
    return this.uploadService.uploadToFolder(file, 'banners');
  }

  @Post('instagram-post')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPEG, PNG, and WebP images are allowed'), false);
        }
      },
    }),
  )
  uploadInstagramPost(@UploadedFile() file: any) {
    return this.uploadService.uploadToFolder(file, 'instagram-posts');
  }

  @Post('event')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPEG, PNG, and WebP images are allowed'), false);
        }
      },
    }),
  )
  uploadEvent(@UploadedFile() file: any) {
    return this.uploadService.uploadToFolder(file, 'events');
  }

  @Post('branding')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPEG, PNG, and WebP images are allowed'), false);
        }
      },
    }),
  )
  uploadBranding(@UploadedFile() file: any) {
    return this.uploadService.uploadToFolder(file, 'branding');
  }

  @Post('document')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only PDF, JPEG, PNG, and WebP files are allowed'), false);
        }
      },
    }),
  )
  uploadDocument(@UploadedFile() file: any) {
    return this.uploadService.uploadToFolder(file, 'documents', { allowPdf: true });
  }

  // Customer-accessible: rental ID-verification flow uploads here. Stored in
  // PRIVATE storage (never web-served); returns an opaque private:// ref.
  @Post('id-document')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ID_DOC_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        // First-pass filter on the claimed type; the service re-checks the
        // real type by magic bytes.
        if (['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only JPEG, PNG, WebP images or PDF documents are allowed'), false);
        }
      },
    }),
  )
  uploadIdDocument(
    @UploadedFile() file: any,
    @Query('side') side: 'front' | 'back' = 'front',
  ) {
    return this.uploadService.uploadIdDocument(file, side, this.tenantContext.requireId);
  }

  /**
   * Admin-only: stream a privately stored ID document. `:tenantScopedKey` is
   * the URL-encoded reference returned by POST /upload/id-document, with or
   * without the `private://id-documents/` prefix — i.e.
   * `encodeURIComponent('<tenantId>/<file>')`. The tenant segment must equal
   * the caller's tenant (platform admins excepted); keys are whitelisted by
   * regex so path traversal is impossible. Every view is audit-logged.
   */
  @Get('id-document/:tenantScopedKey')
  @UseGuards(AdminGuard)
  async streamIdDocument(
    @Param('tenantScopedKey') key: string,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const isPlatformAdmin = !!user?.isPlatformAdmin;
    const callerTenantId = isPlatformAdmin ? null : this.tenantContext.requireId;
    const doc = await this.uploadService.resolveIdDocument(key, callerTenantId, isPlatformAdmin);
    // Same 404 for "missing", "malformed" and "other tenant's" — don't leak existence.
    if (!doc) throw new NotFoundException('Document not found');

    await this.auditService.log('VIEW', 'CustomerIDDocument', `${doc.tenantId}/${doc.fileName}`, {
      size: doc.size,
    });

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    return new StreamableFile(createReadStream(doc.path), {
      type: doc.contentType,
      length: doc.size,
      disposition: `inline; filename="id-document.${doc.fileName.split('.').pop()}"`,
    });
  }

  @Post('payment-icon')
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  async uploadPaymentIcon(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, WebP, or SVG files are allowed');
    }
    if (file.size > 2 * 1024 * 1024) throw new BadRequestException('File must be under 2MB');
    return this.uploadService.uploadToFolder(file, 'payment-methods');
  }

  @Post('3d-model')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_MODEL_BYTES, files: 1 }, // 25MB for 3D models
      fileFilter: (_req, file, cb) => {
        // Extension is REQUIRED (no more "any octet-stream passes"); the
        // service then verifies the bytes and forces the stored extension.
        if (/\.(glb|gltf)$/i.test(file.originalname || '')) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only GLB and GLTF 3D model files are allowed'), false);
        }
      },
    }),
  )
  upload3dModel(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file provided');
    return this.uploadService.uploadModel(file);
  }
}
