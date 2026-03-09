import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { CalculateRateDto } from './dto/calculate-rate.dto';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Public()
  @Get('zones')
  getZones() {
    return this.shippingService.getZones();
  }

  @UseGuards(JwtAuthGuard)
  @Post('zones')
  createZone(@Body() dto: CreateZoneDto) {
    return this.shippingService.createZone(dto);
  }

  @Public()
  @Get('zones/:id')
  getZone(@Param('id') id: string) {
    return this.shippingService.getZone(id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('zones/:id')
  updateZone(@Param('id') id: string, @Body() dto: UpdateZoneDto) {
    return this.shippingService.updateZone(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('zones/:id')
  deleteZone(@Param('id') id: string) {
    return this.shippingService.deleteZone(id);
  }

  @Public()
  @Post('calculate')
  calculateRate(@Body() dto: CalculateRateDto) {
    return this.shippingService.calculateRate(dto.zoneId, dto.orderAmount);
  }

  @UseGuards(JwtAuthGuard)
  @Post('shipments')
  createShipment(@Body() dto: CreateShipmentDto) {
    return this.shippingService.createShipment(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('shipments/:id')
  updateShipment(
    @Param('id') id: string,
    @Body() dto: UpdateShipmentDto,
  ) {
    return this.shippingService.updateShipment(id, dto);
  }

  @Public()
  @Get('shipments/order/:orderId')
  getShipment(@Param('orderId') orderId: string) {
    return this.shippingService.getShipment(orderId);
  }
}
