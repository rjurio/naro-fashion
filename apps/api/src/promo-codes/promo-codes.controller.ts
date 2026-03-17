import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PromoCodesService } from './promo-codes.service';
import { CreatePromoCodeDto, ValidatePromoCodeDto } from './dto/create-promo-code.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('promo-codes')
@UseGuards(JwtAuthGuard)
export class PromoCodesController {
  constructor(private readonly promoCodesService: PromoCodesService) {}

  // Admin: Create promo code
  @Post()
  create(@Body() dto: CreatePromoCodeDto, @Req() req: any) {
    return this.promoCodesService.create(dto, req.user?.sub);
  }

  // Admin: List all promo codes
  @Get()
  findAll() {
    return this.promoCodesService.findAll();
  }

  // Admin: Get promo code details
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.promoCodesService.findOne(id);
  }

  // Public: Validate a promo code (storefront checkout)
  @Public()
  @Post('validate')
  validate(@Body() dto: ValidatePromoCodeDto, @Req() req: any) {
    const userId = req.user?.sub;
    return this.promoCodesService.validate(dto, userId);
  }

  // Admin: Update promo code
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreatePromoCodeDto>) {
    return this.promoCodesService.update(id, dto);
  }

  // Admin: Delete promo code
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.promoCodesService.remove(id);
  }
}
