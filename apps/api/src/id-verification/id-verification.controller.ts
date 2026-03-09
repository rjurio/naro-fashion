import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  IdVerificationService,
  SubmitIdVerificationDto,
  RejectVerificationDto,
} from './id-verification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('id-verification')
export class IdVerificationController {
  constructor(
    private readonly idVerificationService: IdVerificationService,
  ) {}

  @Post('submit')
  submit(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitIdVerificationDto,
  ) {
    return this.idVerificationService.submit(userId, dto);
  }

  @Get('status')
  getStatus(@CurrentUser('id') userId: string) {
    return this.idVerificationService.getStatus(userId);
  }

  @Get('pending')
  getPending() {
    return this.idVerificationService.getPending();
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.idVerificationService.approve(id);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectVerificationDto) {
    return this.idVerificationService.reject(id, dto);
  }
}
