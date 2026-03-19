import {
  Controller,
  Post,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
/// <reference types="multer" />
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
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

  @Post('branding')
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
    return this.uploadService.uploadToFolder(file, 'documents');
  }

  @Post('id-document')
  @UseInterceptors(FileInterceptor('file'))
  uploadIdDocument(
    @UploadedFile() file: any,
    @Query('side') side: 'front' | 'back' = 'front',
  ) {
    return this.uploadService.uploadIdDocument(file, side);
  }

  @UseGuards(JwtAuthGuard)
  @Post('payment-icon')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPaymentIcon(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, WebP, or SVG files are allowed');
    }
    if (file.size > 2 * 1024 * 1024) throw new BadRequestException('File must be under 2MB');
    return this.uploadService.uploadToFolder(file, 'payment-methods');
  }

  @Post('3d-model')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB for 3D models
      fileFilter: (_req, file, cb) => {
        const allowedMimes = ['model/gltf-binary', 'model/gltf+json', 'application/octet-stream'];
        if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(glb|gltf)$/i)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only GLB and GLTF 3D model files are allowed'), false);
        }
      },
    }),
  )
  upload3dModel(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file provided');
    return this.uploadService.uploadToFolder(file, 'models', true);
  }
}
