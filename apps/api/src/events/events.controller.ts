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
  Request,
} from '@nestjs/common';
import {
  EventsService,
  CreateEventDto,
  UpdateEventDto,
  CustomerSubmitEventDto,
  AddMediaDto,
  ReorderMediaDto,
} from './events.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  // --- Public ---

  @Public()
  @Get()
  findAllPublic(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.eventsService.findAllPublic(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 9,
    );
  }

  @Public()
  @Get('by-slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.eventsService.findBySlug(slug);
  }

  // --- Admin ---

  @UseGuards(JwtAuthGuard)
  @Get('admin')
  findAllAdmin(
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.eventsService.findAllAdmin({ status, search });
  }

  @UseGuards(JwtAuthGuard)
  @Get('pending')
  findPending() {
    return this.eventsService.findPending();
  }

  @UseGuards(JwtAuthGuard)
  @Get('deleted')
  findDeleted() {
    return this.eventsService.findDeleted();
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-event')
  findMyEvent(@Request() req: any) {
    return this.eventsService.findMyEvent(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOneAdmin(@Param('id') id: string) {
    return this.eventsService.findOneAdmin(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  createByAdmin(@Body() dto: CreateEventDto, @Request() req: any) {
    return this.eventsService.createByAdmin(dto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('customer')
  createByCustomer(@Body() dto: CustomerSubmitEventDto, @Request() req: any) {
    return this.eventsService.createByCustomer(dto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.eventsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/approve')
  approve(@Param('id') id: string, @Request() req: any) {
    return this.eventsService.approve(id, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body('reason') reason: string) {
    return this.eventsService.reject(id, reason);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.eventsService.restore(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  softDelete(@Param('id') id: string) {
    return this.eventsService.softDelete(id);
  }

  // --- Media ---

  @UseGuards(JwtAuthGuard)
  @Post(':id/media')
  addMedia(@Param('id') id: string, @Body() dto: AddMediaDto) {
    return this.eventsService.addMedia(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/media/:mediaId')
  removeMedia(@Param('id') id: string, @Param('mediaId') mediaId: string) {
    return this.eventsService.removeMedia(id, mediaId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/media/reorder')
  reorderMedia(@Param('id') id: string, @Body() dto: ReorderMediaDto) {
    return this.eventsService.reorderMedia(id, dto);
  }
}
