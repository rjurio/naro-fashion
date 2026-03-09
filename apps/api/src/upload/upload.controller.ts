import {
  Controller,
  Post,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(@UploadedFile() file: any) {
    return this.uploadService.uploadImage(file);
  }

  @Post('id-document')
  @UseInterceptors(FileInterceptor('file'))
  uploadIdDocument(
    @UploadedFile() file: any,
    @Query('side') side: 'front' | 'back' = 'front',
  ) {
    return this.uploadService.uploadIdDocument(file, side);
  }
}
