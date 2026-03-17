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
  Req,
} from '@nestjs/common';
import {
  NewsletterService,
  SubscribeDto,
  CreateNewsletterDto,
  UpdateNewsletterDto,
} from './newsletter.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

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

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Get('subscribers/stats')
  getSubscriberStats() {
    return this.newsletterService.getSubscriberStats();
  }

  // --- Admin: Dashboard ---

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  getDashboard() {
    return this.newsletterService.getDashboardStats();
  }

  // --- Admin: New Arrivals Preview ---

  @UseGuards(JwtAuthGuard)
  @Get('new-arrivals-preview')
  getNewArrivalsPreview() {
    return this.newsletterService.getNewArrivalsProducts();
  }

  // --- Admin: Newsletters CRUD ---

  @UseGuards(JwtAuthGuard)
  @Post()
  createNewsletter(@Body() dto: CreateNewsletterDto, @Req() req: any) {
    return this.newsletterService.createNewsletter(dto, req.user?.sub);
  }

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getNewsletter(@Param('id') id: string) {
    return this.newsletterService.getNewsletter(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  updateNewsletter(@Param('id') id: string, @Body() dto: UpdateNewsletterDto) {
    return this.newsletterService.updateNewsletter(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  deleteNewsletter(@Param('id') id: string) {
    return this.newsletterService.deleteNewsletter(id);
  }

  // --- Admin: Sending ---

  @UseGuards(JwtAuthGuard)
  @Post(':id/send')
  sendNewsletter(@Param('id') id: string) {
    return this.newsletterService.sendNewsletter(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/deliveries')
  getDeliveryStats(@Param('id') id: string) {
    return this.newsletterService.getDeliveryStats(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/failed')
  getFailedDeliveries(@Param('id') id: string) {
    return this.newsletterService.getFailedDeliveries(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/resend-failed')
  resendFailed(@Param('id') id: string) {
    return this.newsletterService.resendFailed(id);
  }
}
