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
  EventsService,
  CreateEventDto,
  UpdateEventDto,
  CustomerSubmitEventDto,
  AddMediaDto,
  ReorderMediaDto,
} from './events.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { Public } from '../auth/decorators/public.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(ModuleGuard)
@RequiresModule('events')
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

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin')
  findAllAdmin(
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.eventsService.findAllAdmin({ status, search });
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('pending')
  findPending() {
    return this.eventsService.findPending();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('deleted')
  findDeleted() {
    return this.eventsService.findDeleted();
  }

  // Customer-facing: logged-in user reads own event.
  @UseGuards(JwtAuthGuard)
  @Get('my-event')
  findMyEvent(@CurrentUser('id') userId: string) {
    return this.eventsService.findMyEvent(userId);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get(':id')
  findOneAdmin(@Param('id') id: string) {
    return this.eventsService.findOneAdmin(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post()
  createByAdmin(@Body() dto: CreateEventDto, @CurrentUser('id') adminId: string) {
    return this.eventsService.createByAdmin(dto, adminId);
  }

  // Customer-facing: logged-in user submits an event under own userId.
  @UseGuards(JwtAuthGuard)
  @Post('customer')
  createByCustomer(
    @Body() dto: CustomerSubmitEventDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.eventsService.createByCustomer(dto, userId);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.eventsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/approve')
  approve(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.eventsService.approve(id, adminId);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body('reason') reason: string) {
    return this.eventsService.reject(id, reason);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.eventsService.restore(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete(':id')
  softDelete(@Param('id') id: string) {
    return this.eventsService.softDelete(id);
  }

  // --- Media (admin-only — gallery management) ---

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':id/media')
  addMedia(@Param('id') id: string, @Body() dto: AddMediaDto) {
    return this.eventsService.addMedia(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete(':id/media/:mediaId')
  removeMedia(@Param('id') id: string, @Param('mediaId') mediaId: string) {
    return this.eventsService.removeMedia(id, mediaId);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/media/reorder')
  reorderMedia(@Param('id') id: string, @Body() dto: ReorderMediaDto) {
    return this.eventsService.reorderMedia(id, dto);
  }
}
