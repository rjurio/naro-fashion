import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto, QueryProductsDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  findAll(@Query() query: QueryProductsDto) {
    return this.productsService.findAll(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin')
  findAllAdmin(@Query() query: QueryProductsDto) {
    return this.productsService.findAllAdmin(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('deleted')
  findDeleted() {
    return this.productsService.findDeleted();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('by-id/:id')
  findById(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @Public()
  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.productsService.findBySlug(slug);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('bulk-import')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  }))
  async bulkImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const name = (file.originalname || '').toLowerCase();
    if (!name.endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are accepted');
    }
    return this.productsService.bulkImport(file.buffer);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/toggle-active')
  toggleActive(@Param('id') id: string) {
    return this.productsService.toggleActive(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.productsService.restore(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.productsService.delete(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete(':id/permanent')
  permanentDelete(@Param('id') id: string) {
    return this.productsService.permanentDelete(id);
  }
}
