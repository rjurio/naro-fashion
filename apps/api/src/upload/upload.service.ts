import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { randomBytes } from 'crypto';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadsDir = join(process.cwd(), 'uploads', 'products');

  async uploadToFolder(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    folder: string,
    skipMimeCheck = false,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }
    if (!skipMimeCheck) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new BadRequestException('Only JPEG, PNG, and WebP images are allowed');
      }
    }
    const maxSize = skipMimeCheck ? 25 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.buffer.length > maxSize) {
      throw new BadRequestException(`File size exceeds ${skipMimeCheck ? '25MB' : '5MB'} limit`);
    }
    const dir = join(process.cwd(), 'uploads', folder);
    await mkdir(dir, { recursive: true });
    // Derive extension from original filename for non-image files, MIME for images
    const origExt = file.originalname.split('.').pop()?.toLowerCase();
    const ext = skipMimeCheck && origExt
      ? origExt
      : file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : file.mimetype.split('/')[1];
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

  async uploadIdDocument(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    side: 'front' | 'back',
  ) {
    // TODO: Replace with actual secure upload (Cloudinary private folder)
    this.logger.log(
      `[UPLOAD] ID document (${side}) upload requested: ${file.originalname}`,
    );

    const mockUrl = `https://res.cloudinary.com/naro-fashion/image/upload/v${Date.now()}/id-documents/${side}_${file.originalname}`;

    return {
      url: mockUrl,
      side,
      publicId: `naro-fashion/id-documents/${side}_${file.originalname}`,
      message: 'Mock upload — Cloudinary integration pending',
    };
  }
}
