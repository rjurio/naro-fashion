import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/create-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId')
  findByOrder(@Param('orderId') orderId: string) {
    return this.paymentsService.findByOrder(orderId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId/summary')
  getPaymentSummary(@Param('orderId') orderId: string) {
    return this.paymentsService.getPaymentSummary(orderId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('rental/:rentalOrderId')
  findByRental(@Param('rentalOrderId') rentalOrderId: string) {
    return this.paymentsService.findByRental(rentalOrderId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.paymentsService.updateStatus(id, dto);
  }

  @Public()
  @Post('webhook')
  handleWebhook(@Body() payload: any) {
    return this.paymentsService.handleWebhook(payload);
  }
}
