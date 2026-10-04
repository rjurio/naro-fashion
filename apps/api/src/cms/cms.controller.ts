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
  ForbiddenException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
import { InstagramService, INSTAGRAM_SYNC_INTERVAL_MS } from './instagram.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { TenantContext } from '../tenant/tenant.context';
import { PrismaService } from '../prisma/prisma.service';
import { adminHasPermission, isPrivilegedSettingKey } from './settings-permissions';

@Controller('cms')
export class CmsController {
  constructor(
    private readonly cmsService: CmsService,
    private readonly instagramService: InstagramService,
    private readonly tenantContext: TenantContext,
    private readonly prisma: PrismaService,
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

  /**
   * Site-setting writes are RBAC-gated (previously any admin, incl. STAFF):
   *  - privileged keys (session lifetimes `auth_*`, secrets/tokens, Instagram
   *    / Facebook integration config) require `settings:manage`
   *  - ordinary content keys (homepage copy, feature toggles, business
   *    profile) accept `settings:manage` OR `cms:manage`, so MANAGER (which
   *    deliberately lacks settings:manage) can still edit homepage CMS text.
   */
  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('settings:manage', 'cms:manage')
  @Patch('settings/:key')
  async updateSetting(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentUser() user: any,
  ) {
    if (isPrivilegedSettingKey(key) && !(await adminHasPermission(this.prisma, user, 'settings:manage'))) {
      throw new ForbiddenException('Missing required permission: settings:manage');
    }
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

  // Manual sync of THIS tenant's feed only (requireId: never "some tenant").
  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('cms:manage')
  @Post('instagram-posts/sync')
  syncInstagramPosts() {
    return this.instagramService.syncTenant(this.tenantContext.requireId);
  }

  // --- Instagram Sync Config ---

  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('cms:manage')
  @Get('instagram-sync-config')
  getInstagramSyncConfig() {
    return this.cmsService.getInstagramSyncConfig();
  }

  /**
   * Per-tenant interval. Stored in the tenant's SiteSetting only — the
   * hourly InstagramService sweep honours it. This used to delete and
   * re-register the single PLATFORM-WIDE cron job, so any tenant admin could
   * reschedule (or switch OFF) every tenant's sync.
   */
  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('cms:manage')
  @Patch('instagram-sync-config')
  async updateInstagramSyncConfig(@Body() body: { interval: string }) {
    const interval = body?.interval;
    if (typeof interval !== 'string' || !Object.prototype.hasOwnProperty.call(INSTAGRAM_SYNC_INTERVAL_MS, interval)) {
      throw new BadRequestException(
        `Invalid interval. Valid options: ${Object.keys(INSTAGRAM_SYNC_INTERVAL_MS).join(', ')}`,
      );
    }
    return this.cmsService.updateInstagramSyncConfig(interval);
  }

  // --- Contact Submissions ---

  @Public()
  // Public form that triggers an outbound acknowledgement email to an
  // arbitrary address — keep it well below the global limit (spam relay).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
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
