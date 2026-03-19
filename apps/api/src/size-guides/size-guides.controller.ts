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
import { SizeGuidesService, CreateSizeGuideDto, UpdateSizeGuideDto } from './size-guides.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('size-guides')
export class SizeGuidesController {
  constructor(private readonly sizeGuidesService: SizeGuidesService) {}

  // --- Public ---

  @Public()
  @Get()
  findAllPublic() {
    return this.sizeGuidesService.findAllPublic();
  }

  @Public()
  @Get('default')
  findDefault() {
    return this.sizeGuidesService.findDefault();
  }

  @Public()
  @Get('by-slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.sizeGuidesService.findBySlug(slug);
  }

  // --- Admin ---

  @UseGuards(JwtAuthGuard)
  @Get('admin')
  findAll() {
    return this.sizeGuidesService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get('deleted')
  findDeleted() {
    return this.sizeGuidesService.findDeleted();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.sizeGuidesService.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateSizeGuideDto) {
    return this.sizeGuidesService.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSizeGuideDto) {
    return this.sizeGuidesService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/set-default')
  setDefault(@Param('id') id: string) {
    return this.sizeGuidesService.setDefault(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/toggle-active')
  toggleActive(@Param('id') id: string) {
    return this.sizeGuidesService.toggleActive(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.sizeGuidesService.restore(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.sizeGuidesService.delete(id);
  }
}
