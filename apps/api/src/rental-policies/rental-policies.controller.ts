import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { RentalPoliciesService } from './rental-policies.service';
import { UpdatePolicyDto } from './dto/update-policy.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('rental-policies')
export class RentalPoliciesController {
  constructor(
    private readonly rentalPoliciesService: RentalPoliciesService,
  ) {}

  @Public()
  @Get()
  get() {
    return this.rentalPoliciesService.get();
  }

  @UseGuards(JwtAuthGuard)
  @Patch()
  update(@Body() dto: UpdatePolicyDto) {
    return this.rentalPoliciesService.update(dto);
  }
}
