import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ProductSizesService,
  CreateProductSizeDto,
  UpdateProductSizeDto,
} from './product-sizes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('product-sizes')
export class ProductSizesController {
  constructor(private readonly service: ProductSizesService) {}

  // Public — used by storefront product detail size pickers
  @Public()
  @Get()
  findActive() {
    return this.service.findActive();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin')
  findAll() {
    return this.service.findAll();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('deleted')
  findDeleted() {
    return this.service.findDeleted();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post()
  create(@Body() dto: CreateProductSizeDto) {
    return this.service.create(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductSizeDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/toggle-active')
  toggleActive(@Param('id') id: string) {
    return this.service.toggleActive(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.service.restore(id);
  }
}
