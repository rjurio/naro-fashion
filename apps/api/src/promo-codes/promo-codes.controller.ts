import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { PromoCodesService } from './promo-codes.service';
import { CreatePromoCodeDto, ValidatePromoCodeDto } from './dto/create-promo-code.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { Public } from '../auth/decorators/public.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('promo-codes')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('promo-codes')
export class PromoCodesController {
  constructor(private readonly promoCodesService: PromoCodesService) {}

  // Admin: Create promo code
  @Post()
  create(@Body() dto: CreatePromoCodeDto, @CurrentUser('id') createdBy: string) {
    return this.promoCodesService.create(dto, createdBy);
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

  // Public: Validate a promo code (storefront checkout). @Public() skips
  // JwtAuthGuard, so req.user is always null/undefined here and userId is
  // undefined for anonymous storefront callers. The pre-existing behaviour
  // (no per-user max-uses enforcement on this route) is preserved.
  @Public()
  @Post('validate')
  validate(
    @Body() dto: ValidatePromoCodeDto,
    @CurrentUser('id') userId: string | undefined,
  ) {
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
