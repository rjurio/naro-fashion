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
} from '@nestjs/common';
import {
  NewsletterService,
  SubscribeDto,
  CreateNewsletterDto,
  UpdateNewsletterDto,
} from './newsletter.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  // --- Public ---

  @Public()
  @Post('subscribe')
  subscribe(@Body() dto: SubscribeDto) {
    return this.newsletterService.subscribe(dto);
  }

  @Public()
  @Get('unsubscribe/:token')
  unsubscribe(@Param('token') token: string) {
    return this.newsletterService.unsubscribe(token);
  }

  // --- Admin: Subscribers ---

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('subscribers')
  getSubscribers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.newsletterService.getSubscribers(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      search,
    );
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('subscribers/stats')
  getSubscriberStats() {
    return this.newsletterService.getSubscriberStats();
  }

  // --- Admin: Dashboard ---

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('dashboard')
  getDashboard() {
    return this.newsletterService.getDashboardStats();
  }

  // --- Admin: New Arrivals Preview ---

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('new-arrivals-preview')
  getNewArrivalsPreview() {
    return this.newsletterService.getNewArrivalsProducts();
  }

  // --- Admin: Newsletters CRUD ---

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post()
  createNewsletter(
    @Body() dto: CreateNewsletterDto,
    @CurrentUser('id') createdBy: string,
  ) {
    return this.newsletterService.createNewsletter(dto, createdBy);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get()
  getNewsletters(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.newsletterService.getNewsletters(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get(':id')
  getNewsletter(@Param('id') id: string) {
    return this.newsletterService.getNewsletter(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id')
  updateNewsletter(@Param('id') id: string, @Body() dto: UpdateNewsletterDto) {
    return this.newsletterService.updateNewsletter(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete(':id')
  deleteNewsletter(@Param('id') id: string) {
    return this.newsletterService.deleteNewsletter(id);
  }

  // --- Admin: Sending ---

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':id/send')
  sendNewsletter(@Param('id') id: string) {
    return this.newsletterService.sendNewsletter(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get(':id/deliveries')
  getDeliveryStats(@Param('id') id: string) {
    return this.newsletterService.getDeliveryStats(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get(':id/failed')
  getFailedDeliveries(@Param('id') id: string) {
    return this.newsletterService.getFailedDeliveries(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':id/resend-failed')
  resendFailed(@Param('id') id: string) {
    return this.newsletterService.resendFailed(id);
  }
}
