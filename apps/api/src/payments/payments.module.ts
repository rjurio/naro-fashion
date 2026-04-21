import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SelcomProvider } from './selcom.provider';
import { ClickPesaProvider } from './clickpesa.provider';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentsReconciliationService } from './payments.reconciliation';

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    SelcomProvider,
    ClickPesaProvider,
    PaymentProviderRegistry,
    PaymentsReconciliationService,
  ],
  exports: [
    PaymentsService,
    SelcomProvider,
    ClickPesaProvider,
    PaymentProviderRegistry,
  ],
})
export class PaymentsModule {}
