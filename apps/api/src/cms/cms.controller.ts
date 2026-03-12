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
  CmsService,
  CreateBannerDto,
  UpdateBannerDto,
  CreatePageDto,
  UpdatePageDto,
  UpdateSettingDto,
} from './cms.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('cms')
export class CmsController {
  constructor(private readonly cmsService: CmsService) {}

  // --- Banners ---

  @Public()
  @Get('banners')
  findAllBanners() {
    return this.cmsService.findAllBanners();
  }

  @UseGuards(JwtAuthGuard)
  @Get('banners/admin')
  findAllBannersAdmin() {
    return this.cmsService.findAllBannersAdmin();
  }

  @UseGuards(JwtAuthGuard)
  @Get('banners/deleted')
  findDeletedBanners() {
    return this.cmsService.findDeletedBanners();
  }

  @UseGuards(JwtAuthGuard)
  @Post('banners')
  createBanner(@Body() dto: CreateBannerDto) {
    return this.cmsService.createBanner(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('banners/:id')
  updateBanner(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.cmsService.updateBanner(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('banners/:id/restore')
  restoreBanner(@Param('id') id: string) {
    return this.cmsService.restoreBanner(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('banners/:id')
  deleteBanner(@Param('id') id: string) {
    return this.cmsService.deleteBanner(id);
  }

  // --- Pages ---

  @Public()
  @Get('pages')
  findAllPages() {
    return this.cmsService.findAllPages();
  }

  @UseGuards(JwtAuthGuard)
  @Get('pages/deleted')
  findDeletedPages() {
    return this.cmsService.findDeletedPages();
  }

  @Public()
  @Get('pages/:slug')
  findPageBySlug(@Param('slug') slug: string) {
    return this.cmsService.findPageBySlug(slug);
  }

  @UseGuards(JwtAuthGuard)
  @Post('pages')
  createPage(@Body() dto: CreatePageDto) {
    return this.cmsService.createPage(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('pages/:id')
  updatePage(@Param('id') id: string, @Body() dto: UpdatePageDto) {
    return this.cmsService.updatePage(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('pages/:id/restore')
  restorePage(@Param('id') id: string) {
    return this.cmsService.restorePage(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('pages/:id')
  deletePage(@Param('id') id: string) {
    return this.cmsService.deletePage(id);
  }

  // --- Settings ---

  @Public()
  @Get('settings')
  findAllSettings() {
    return this.cmsService.findAllSettings();
  }

  @UseGuards(JwtAuthGuard)
  @Patch('settings/:key')
  updateSetting(@Param('key') key: string, @Body() dto: UpdateSettingDto) {
    return this.cmsService.updateSetting(key, dto);
  }
}
