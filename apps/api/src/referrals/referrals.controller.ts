import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ReferralsService, ApplyReferralDto } from './referrals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';

@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('referrals')
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('my-code')
  getMyCode(@CurrentUser('id') userId: string) {
    return this.referralsService.getMyCode(userId);
  }

  @Post('generate')
  generateCode(@CurrentUser('id') userId: string) {
    return this.referralsService.generateCode(userId);
  }

  @Post('apply')
  applyCode(
    @CurrentUser('id') userId: string,
    @Body() dto: ApplyReferralDto,
  ) {
    return this.referralsService.applyCode(userId, dto);
  }

  @Get('stats')
  getStats() {
    return this.referralsService.getStats();
  }
}
