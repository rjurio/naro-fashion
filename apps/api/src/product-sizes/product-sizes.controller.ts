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

  @UseGuards(JwtAuthGuard)
  @Get('admin')
  findAll() {
    return this.service.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get('deleted')
  findDeleted() {
    return this.service.findDeleted();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateProductSizeDto) {
    return this.service.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductSizeDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/toggle-active')
  toggleActive(@Param('id') id: string) {
    return this.service.toggleActive(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.service.restore(id);
  }
}
