import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SelcomProvider } from './selcom.provider';
import { ClickPesaProvider } from './clickpesa.provider';
import {
  PROVIDER_CODES,
  PaymentProvider,
  ProviderCode,
} from './payment-provider.types';

/**
 * Looks up a payment provider by code (e.g. "SELCOM", "CLICKPESA_MIXX").
 * PaymentsService dispatches through this instead of injecting providers directly.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly logger = new Logger(PaymentProviderRegistry.name);
  private readonly providers: Map<string, PaymentProvider>;

  constructor(
    private readonly selcom: SelcomProvider,
    private readonly clickpesa: ClickPesaProvider,
  ) {
    this.providers = new Map();
    this.providers.set(PROVIDER_CODES.SELCOM, this.selcom);
    this.providers.set(PROVIDER_CODES.CLICKPESA_MIXX, this.clickpesa);

    this.logger.log(
      `Payment provider registry initialized: ${[...this.providers.keys()].join(', ')}`,
    );
  }

  resolve(code: ProviderCode | string): PaymentProvider {
    const provider = this.providers.get(code);
    if (!provider) {
      throw new NotFoundException(`Unknown payment provider: ${code}`);
    }
    return provider;
  }

  has(code: string): boolean {
    return this.providers.has(code);
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}
