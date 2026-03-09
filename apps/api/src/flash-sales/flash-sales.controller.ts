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
import {
  FlashSalesService,
  CreateFlashSaleDto,
  UpdateFlashSaleDto,
} from './flash-sales.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('flash-sales')
export class FlashSalesController {
  constructor(private readonly flashSalesService: FlashSalesService) {}

  @Public()
  @Get()
  findAllActive() {
    return this.flashSalesService.findAllActive();
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.flashSalesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateFlashSaleDto) {
    return this.flashSalesService.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFlashSaleDto) {
    return this.flashSalesService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.flashSalesService.delete(id);
  }
}
