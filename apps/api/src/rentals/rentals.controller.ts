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
import { Throttle } from '@nestjs/throttler';
import { RentalsService } from './rentals.service';
import { CreateRentalDto } from './dto/create-rental.dto';
import { UpdateRentalDto } from './dto/update-rental.dto';
import { QueryRentalsDto } from './dto/query-rentals.dto';
import { UpdateRentalStatusDto } from './dto/update-rental-status.dto';
import {
  RentalAvailabilityQueryDto,
  parseAvailabilityWindow,
} from './dto/rental-availability-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { extname } from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { diskStorage } = require('multer');

@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('rentals')
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

  @UseGuards(AdminGuard)
  @Get('admin')
  findAllAdmin(@Query() query: QueryRentalsDto) {
    return this.rentalsService.findAllAdmin(query);
  }

  @UseGuards(AdminGuard)
  @Get('upcoming-pickups')
  getUpcomingPickups(@Query('days', ParseIntPipe) days: number) {
    return this.rentalsService.getUpcomingPickups(days);
  }

  @UseGuards(AdminGuard)
  @Get('pending-returns')
  getPendingReturns() {
    return this.rentalsService.getPendingReturns();
  }

  @UseGuards(AdminGuard)
  @Get('overdue')
  getOverdueRentals() {
    return this.rentalsService.getOverdueRentals();
  }

  /**
   * PUBLIC (shoppers check dates before signing in — the User Guide promises
   * "Available for selected dates"). Returns ONLY `{ available }`: no
   * booking ids, dates, customers or counts. Tenant-scoped via X-Tenant-Id
   * (TenantGuard rejects suspended tenants; ModuleGuard still requires the
   * rentals module), limited to active rental-eligible products, a bounded
   * date window, and 20 calls/min per client IP to slow calendar scraping.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('availability/:productId')
  getAvailability(
    @Param('productId') productId: string,
    @Query() query: RentalAvailabilityQueryDto,
  ) {
    const { start, end } = parseAvailabilityWindow(query);
    return this.rentalsService.getAvailability(productId, start, end);
  }

  /**
   * PUBLIC: the down-payment terms a booking would store now (product
   * override → shop default → 25 %), so the storefront shows the server's
   * percentage and amount instead of computing its own. Amounts only, same
   * product visibility as availability.
   */
  /** PUBLIC: { downPaymentRequired } for the shop (catalogue copy only). */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('terms-summary')
  getTermsSummary() {
    return this.rentalsService.getTermsSummary();
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('quote/:productId')
  getQuote(@Param('productId') productId: string) {
    return this.rentalsService.getQuote(productId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.rentalsService.findOne(id, user);
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRentalDto,
  ) {
    return this.rentalsService.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRentalStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.rentalsService.updateStatus(id, dto.status, dto.expectedStatus, user, dto.returnedAt);
  }

  @UseGuards(AdminGuard)
  @Patch(':id/ready')
  markReadyForPickup(@Param('id') id: string) {
    return this.rentalsService.markReadyForPickup(id);
  }

  @UseGuards(AdminGuard)
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
