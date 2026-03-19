import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  // ============================================================
  // PUBLIC ENDPOINTS (used by storefront)
  // ============================================================

  /**
   * Resolve tenant by domain or slug — public, used by storefront middleware.
   */
  @Public()
  @Get('resolve')
  async resolve(@Query('domain') domain?: string, @Query('slug') slug?: string) {
    if (domain) return this.tenantsService.resolveByDomain(domain);
    if (slug) return this.tenantsService.resolveBySlug(slug);
    return { error: 'Provide domain or slug query parameter' };
  }

  /**
   * Get tenant branding — public, used by storefront layout.
   */
  @Public()
  @Get(':id/branding')
  async getBranding(@Param('id') id: string) {
    return this.tenantsService.getBranding(id);
  }

  // ============================================================
  // PLATFORM ADMIN ENDPOINTS
  // ============================================================

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get('platform/stats')
  async getPlatformStats() {
    return this.tenantsService.getPlatformStats();
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get()
  async findAll(@Query('status') status?: string, @Query('search') search?: string) {
    return this.tenantsService.findAll({ status, search });
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get('plans')
  async getPlans() {
    return this.tenantsService.getPlans();
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Post('plans')
  async createPlan(@Body() data: any) {
    return this.tenantsService.createPlan(data);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Patch('plans/:id')
  async updatePlan(@Param('id') id: string, @Body() data: any) {
    return this.tenantsService.updatePlan(id, data);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get('payments')
  async getAllPayments(@Query('status') status?: string) {
    return this.tenantsService.getAllPayments({ status });
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Post()
  async create(@Body() dto: any) {
    return this.tenantsService.create(dto);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.tenantsService.update(id, data);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.tenantsService.updateStatus(id, body.status);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get(':id/modules')
  async getModules(@Param('id') id: string) {
    return this.tenantsService.getModules(id);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Patch(':id/modules')
  async toggleModule(
    @Param('id') id: string,
    @Body() body: { moduleCode: string; isEnabled: boolean },
  ) {
    return this.tenantsService.toggleModule(id, body.moduleCode, body.isEnabled);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Patch(':id/branding')
  async updateBranding(@Param('id') id: string, @Body() data: any) {
    return this.tenantsService.updateBranding(id, data);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Post(':id/subscribe')
  async subscribe(
    @Param('id') id: string,
    @Body() body: { planId: string; billingCycle?: string },
  ) {
    return this.tenantsService.subscribeTenant(id, body.planId, body.billingCycle);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Post(':id/payments')
  async recordPayment(@Param('id') id: string, @Body() data: any) {
    return this.tenantsService.recordPayment(id, data);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get(':id/payments')
  async getPayments(@Param('id') id: string) {
    return this.tenantsService.getPayments(id);
  }
}
