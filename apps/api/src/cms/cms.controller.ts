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
  BadRequestException,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  CmsService,
  CreateBannerDto,
  UpdateBannerDto,
  CreatePageDto,
  UpdatePageDto,
  UpdateSettingDto,
  CreateHeroSlideDto,
  UpdateHeroSlideDto,
  CreateParallaxSectionDto,
  UpdateParallaxSectionDto,
  CreateInstagramPostDto,
  UpdateInstagramPostDto,
  SubmitContactDto,
  UpdateContactStatusDto,
  ReplyContactDto,
} from './cms.service';
import { InstagramService } from './instagram.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { Public } from '../auth/decorators/public.decorator';
import { INSTAGRAM_SYNC_INTERVALS } from '../scheduler/scheduler.service';
import { TenantContext } from '../tenant/tenant.context';

@Controller('cms')
export class CmsController {
  constructor(
    private readonly cmsService: CmsService,
    private readonly instagramService: InstagramService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly tenantContext: TenantContext,
  ) {}

  // --- Banners ---

  @Public()
  @Get('banners')
  findAllBanners() {
    return this.cmsService.findAllBanners();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('banners/admin')
  findAllBannersAdmin() {
    return this.cmsService.findAllBannersAdmin();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('banners/deleted')
  findDeletedBanners() {
    return this.cmsService.findDeletedBanners();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('banners')
  createBanner(@Body() dto: CreateBannerDto) {
    return this.cmsService.createBanner(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('banners/:id')
  updateBanner(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.cmsService.updateBanner(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('banners/:id/restore')
  restoreBanner(@Param('id') id: string) {
    return this.cmsService.restoreBanner(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
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

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('pages/deleted')
  findDeletedPages() {
    return this.cmsService.findDeletedPages();
  }

  @Public()
  @Get('pages/:slug')
  findPageBySlug(@Param('slug') slug: string) {
    return this.cmsService.findPageBySlug(slug);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('pages')
  createPage(@Body() dto: CreatePageDto) {
    return this.cmsService.createPage(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('pages/:id')
  updatePage(@Param('id') id: string, @Body() dto: UpdatePageDto) {
    return this.cmsService.updatePage(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('pages/:id/restore')
  restorePage(@Param('id') id: string) {
    return this.cmsService.restorePage(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('pages/:id')
  deletePage(@Param('id') id: string) {
    return this.cmsService.deletePage(id);
  }

  // --- Settings ---

  @Public()
  @Get('settings/business-profile')
  getBusinessProfile() {
    return this.cmsService.getBusinessProfile();
  }

  @Public()
  @Get('settings')
  findAllSettings() {
    return this.cmsService.findAllSettings();
  }

  @Public()
  @Get('storefront-stats')
  getStorefrontStats() {
    return this.cmsService.getStorefrontStats();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('settings/:key')
  updateSetting(@Param('key') key: string, @Body() dto: UpdateSettingDto) {
    return this.cmsService.updateSetting(key, dto);
  }

  // --- Hero Slides ---

  @Public()
  @Get('hero-slides')
  findActiveHeroSlides() {
    return this.cmsService.findActiveHeroSlides();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('hero-slides/admin')
  findAllHeroSlidesAdmin() {
    return this.cmsService.findAllHeroSlidesAdmin();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('hero-slides/deleted')
  findDeletedHeroSlides() {
    return this.cmsService.findDeletedHeroSlides();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('hero-slides')
  createHeroSlide(@Body() dto: CreateHeroSlideDto) {
    return this.cmsService.createHeroSlide(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('hero-slides/:id')
  updateHeroSlide(@Param('id') id: string, @Body() dto: UpdateHeroSlideDto) {
    return this.cmsService.updateHeroSlide(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('hero-slides/:id/restore')
  restoreHeroSlide(@Param('id') id: string) {
    return this.cmsService.restoreHeroSlide(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('hero-slides/:id')
  deleteHeroSlide(@Param('id') id: string) {
    return this.cmsService.deleteHeroSlide(id);
  }

  // --- Parallax Sections ---

  @Public()
  @Get('parallax-sections')
  findActiveParallaxSections() {
    return this.cmsService.findActiveParallaxSections();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('parallax-sections/admin')
  findAllParallaxSectionsAdmin() {
    return this.cmsService.findAllParallaxSectionsAdmin();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('parallax-sections/deleted')
  findDeletedParallaxSections() {
    return this.cmsService.findDeletedParallaxSections();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('parallax-sections')
  createParallaxSection(@Body() dto: CreateParallaxSectionDto) {
    return this.cmsService.createParallaxSection(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('parallax-sections/:id')
  updateParallaxSection(@Param('id') id: string, @Body() dto: UpdateParallaxSectionDto) {
    return this.cmsService.updateParallaxSection(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('parallax-sections/:id/restore')
  restoreParallaxSection(@Param('id') id: string) {
    return this.cmsService.restoreParallaxSection(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('parallax-sections/:id/toggle-active')
  toggleParallaxSectionActive(@Param('id') id: string) {
    return this.cmsService.toggleParallaxSectionActive(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('parallax-sections/:id')
  deleteParallaxSection(@Param('id') id: string) {
    return this.cmsService.deleteParallaxSection(id);
  }

  // --- Instagram Posts ---

  @Public()
  @Get('instagram-posts')
  findActiveInstagramPosts() {
    return this.cmsService.findActiveInstagramPosts();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('instagram-posts/admin')
  findAllInstagramPostsAdmin() {
    return this.cmsService.findAllInstagramPostsAdmin();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('instagram-posts/deleted')
  findDeletedInstagramPosts() {
    return this.cmsService.findDeletedInstagramPosts();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('instagram-posts')
  createInstagramPost(@Body() dto: CreateInstagramPostDto) {
    return this.cmsService.createInstagramPost(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('instagram-posts/:id')
  updateInstagramPost(@Param('id') id: string, @Body() dto: UpdateInstagramPostDto) {
    return this.cmsService.updateInstagramPost(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('instagram-posts/:id/restore')
  restoreInstagramPost(@Param('id') id: string) {
    return this.cmsService.restoreInstagramPost(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('instagram-posts/:id')
  deleteInstagramPost(@Param('id') id: string) {
    return this.cmsService.deleteInstagramPost(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('instagram-posts/:id/pin')
  togglePinInstagramPost(@Param('id') id: string) {
    return this.cmsService.togglePinInstagramPost(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('instagram-posts/sync')
  syncInstagramPosts() {
    return this.instagramService.syncFromInstagram(this.tenantContext.id ?? undefined);
  }

  // --- Instagram Sync Config ---

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('instagram-sync-config')
  getInstagramSyncConfig() {
    return this.cmsService.getInstagramSyncConfig();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('instagram-sync-config')
  async updateInstagramSyncConfig(@Body() body: { interval: string }) {
    const interval = body.interval;
    if (!INSTAGRAM_SYNC_INTERVALS.hasOwnProperty(interval)) {
      throw new BadRequestException(
        `Invalid interval. Valid options: ${Object.keys(INSTAGRAM_SYNC_INTERVALS).join(', ')}`,
      );
    }
    const result = await this.cmsService.updateInstagramSyncConfig(interval);

    // Re-register the dynamic cron job
    const cronExpr = INSTAGRAM_SYNC_INTERVALS[interval];
    const jobName = 'instagram-sync-dynamic';
    try { this.schedulerRegistry.deleteCronJob(jobName); } catch { /* didn't exist */ }
    if (cronExpr) {
      const job = new CronJob(cronExpr, async () => { await this.instagramService.syncFromInstagram(); });
      this.schedulerRegistry.addCronJob(jobName, job);
      job.start();
    }

    return result;
  }

  // --- Contact Submissions ---

  @Public()
  @Post('contact')
  submitContact(@Body() dto: SubmitContactDto) {
    return this.cmsService.submitContact(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('contact-submissions')
  findAllContactSubmissions(@Query('status') status?: string) {
    return this.cmsService.findAllContactSubmissions(status);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('contact-submissions/stats')
  getContactSubmissionStats() {
    return this.cmsService.getContactSubmissionStats();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('contact-submissions/:id')
  findContactSubmission(@Param('id') id: string) {
    return this.cmsService.findContactSubmission(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('contact-submissions/:id/status')
  updateContactStatus(@Param('id') id: string, @Body() dto: UpdateContactStatusDto) {
    return this.cmsService.updateContactStatus(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('contact-submissions/:id/reply')
  replyToContact(@Param('id') id: string, @Body() dto: ReplyContactDto) {
    return this.cmsService.replyToContact(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('contact-submissions/:id')
  deleteContactSubmission(@Param('id') id: string) {
    return this.cmsService.deleteContactSubmission(id);
  }
}
