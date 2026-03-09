import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  async uploadImage(file: { originalname: string; buffer: Buffer; mimetype: string }) {
    // TODO: Replace with actual Cloudinary upload
    this.logger.log(`[UPLOAD] Image upload requested: ${file.originalname}`);

    const mockUrl = `https://res.cloudinary.com/naro-fashion/image/upload/v${Date.now()}/${file.originalname}`;

    return {
      url: mockUrl,
      publicId: `naro-fashion/${file.originalname}`,
      format: file.mimetype.split('/')[1],
      message: 'Mock upload — Cloudinary integration pending',
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
