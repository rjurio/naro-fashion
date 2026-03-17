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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RentalsService } from './rentals.service';
import { CreateRentalDto } from './dto/create-rental.dto';
import { UpdateRentalDto } from './dto/update-rental.dto';
import { QueryRentalsDto } from './dto/query-rentals.dto';
import { UpdateRentalStatusDto } from './dto/update-rental-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { extname } from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { diskStorage } = require('multer');

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

  @Get('pending-returns')
  getPendingReturns() {
    return this.rentalsService.getPendingReturns();
  }

  @Get('overdue')
  getOverdueRentals() {
    return this.rentalsService.getOverdueRentals();
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

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRentalDto,
  ) {
    return this.rentalsService.update(id, dto);
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

  @Post(':id/transport-receipt')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/receipts',
        filename: (_req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `receipt-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.match(/\/(jpg|jpeg|png|pdf|webp)$/)) {
          cb(null, true);
        } else {
          cb(new Error('Only image files and PDFs are allowed'), false);
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadTransportReceipt(
    @Param('id') id: string,
    @UploadedFile() file: any,
  ) {
    const receiptUrl = `/uploads/receipts/${file.filename}`;
    return this.rentalsService.update(id, { transportReceiptUrl: receiptUrl });
  }
}
