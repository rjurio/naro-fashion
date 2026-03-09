import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { RentalsService } from './rentals.service';
import { CreateRentalDto } from './dto/create-rental.dto';
import { QueryRentalsDto } from './dto/query-rentals.dto';
import { UpdateRentalStatusDto } from './dto/update-rental-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('rentals')
export class RentalsController {
  constructor(private readonly rentalsService: RentalsService) {}

  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRentalDto,
  ) {
    return this.rentalsService.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUser('id') userId: string) {
    return this.rentalsService.findAll(userId);
  }

  @Get('admin')
  findAllAdmin(@Query() query: QueryRentalsDto) {
    return this.rentalsService.findAllAdmin(query);
  }

  @Get('upcoming-pickups')
  getUpcomingPickups(@Query('days', ParseIntPipe) days: number) {
    return this.rentalsService.getUpcomingPickups(days);
  }

  @Get('availability/:productId')
  getAvailability(
    @Param('productId') productId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.rentalsService.getAvailability(
      productId,
      new Date(startDate),
      new Date(endDate),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.rentalsService.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRentalStatusDto,
  ) {
    return this.rentalsService.updateStatus(id, dto.status);
  }

  @Patch(':id/ready')
  markReadyForPickup(@Param('id') id: string) {
    return this.rentalsService.markReadyForPickup(id);
  }
}
