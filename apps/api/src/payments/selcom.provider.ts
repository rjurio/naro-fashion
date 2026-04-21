import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { normalizePhone } from './phone.util';
import {
  GatewayInitiateRequest,
  GatewayInitiateResult,
  GatewayStatusResult,
  PaymentProvider,
  PROVIDER_CODES,
  ProviderCode,
} from './payment-provider.types';

// Legacy aliases — kept so existing imports compile.
export type SelcomPaymentRequest = GatewayInitiateRequest;
export type SelcomPaymentResponse = GatewayInitiateResult;
export type SelcomStatusResponse = GatewayStatusResult;

/**
 * Selcom Checkout API integration for M-Pesa, Tigo Pesa, and Airtel Money payments in Tanzania.
 *
 * Selcom API docs: https://developers.selcom.net/
 *
 * This provider is designed to be replaceable — other gateways (Flutterwave, DPO, etc.)
 * can be added by implementing the same interface methods.
 */
@Injectable()
export class SelcomProvider implements PaymentProvider {
  readonly code: ProviderCode = PROVIDER_CODES.SELCOM;
  private readonly logger = new Logger(SelcomProvider.name);
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly vendor: string;
  private readonly baseUrl: string;
  private readonly webhookUrl: string;
  private readonly isConfigured: boolean;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('SELCOM_API_KEY', '');
    this.apiSecret = this.configService.get<string>('SELCOM_API_SECRET', '');
    this.vendor = this.configService.get<string>('SELCOM_VENDOR', '');
    this.baseUrl = this.configService.get<string>(
      'SELCOM_BASE_URL',
      'https://apigw.selcom.net/v1',
    );
    const apiUrl = this.configService.get<string>(
      'API_URL',
      'http://localhost:4000',
    );
    this.webhookUrl = `${apiUrl}/api/v1/payments/webhook`;

    this.isConfigured = !!(this.apiKey && this.apiSecret && this.vendor);

    if (!this.isConfigured) {
      this.logger.warn(
        'Selcom payment gateway is not configured. Set SELCOM_API_KEY, SELCOM_API_SECRET, and SELCOM_VENDOR in .env to enable.',
      );
    } else {
      this.logger.log(
        `Selcom payment gateway initialized (vendor: ${this.vendor}, base: ${this.baseUrl})`,
      );
    }
  }

  /**
   * Check if the gateway is properly configured.
   */
  get configured(): boolean {
    return this.isConfigured;
  }

  /**
   * Generate authorization headers for Selcom API requests.
   * Selcom uses signed timestamp + API key authentication.
   */
  private getAuthHeaders(): Record<string, string> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14);
    const signedFields = `timestamp=${timestamp}`;
    const digest = crypto
      .createHmac('sha256', this.apiSecret)
      .update(signedFields)
      .digest('base64');

    return {
      'Content-Type': 'application/json',
      Authorization: `SELCOM ${Buffer.from(this.apiKey).toString('base64')}`,
      'Digest-Method': 'HS256',
      Digest: digest,
      Timestamp: timestamp,
      'Signed-Fields': 'timestamp',
    };
  }

  /**
   * Make an authenticated request to the Selcom API.
   */
  private async selcomRequest(
    endpoint: string,
    method: 'GET' | 'POST',
    body?: any,
  ): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = this.getAuthHeaders();

    this.logger.debug(`Selcom ${method} ${url}`);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error(
          `Selcom API error: ${response.status} ${JSON.stringify(data)}`,
        );
        return { success: false, error: data };
      }

      return data;
    } catch (error) {
      this.logger.error(`Selcom API request failed: ${error}`);
      throw error;
    }
  }

  /**
   * Initiate a USSD push payment (M-Pesa, Tigo Pesa, Airtel Money).
   *
   * For mobile money, this sends a USSD prompt to the customer's phone.
   * The customer confirms on their phone, and Selcom sends a webhook callback.
   */
  async initiateUssdPush(
    request: SelcomPaymentRequest,
  ): Promise<SelcomPaymentResponse> {
    if (!this.isConfigured) {
      this.logger.warn(
        'Selcom not configured — returning simulated USSD push response',
      );
      return this.simulatePaymentResponse(request);
    }

    const payload = {
      vendor: this.vendor,
      order_id: request.orderId,
      buyer_email: request.buyerEmail || 'customer@narofashion.co.tz',
      buyer_name: request.buyerName || 'Naro Customer',
      buyer_phone: normalizePhone(request.phoneNumber || ''),
      amount: request.amount,
      currency: request.currency || 'TZS',
      payment_methods: 'USSDPUSH',
      webhook: this.webhookUrl,
      no_of_items: 1,
    };

    try {
      const data = await this.selcomRequest(
        '/checkout/create-order-minimal',
        'POST',
        payload,
      );

      if (data?.result === 'SUCCESS' || data?.resultcode === '000') {
        return {
          success: true,
          transactionId: data.transid || data.order_id,
          reference: data.reference || request.orderId,
          message: 'USSD push sent to phone. Please confirm the payment.',
          rawResponse: data,
        };
      }

      return {
        success: false,
        message:
          data?.message || data?.resultcode || 'Failed to initiate payment',
        rawResponse: data,
      };
    } catch (error) {
      this.logger.error(`USSD push initiation failed: ${error}`);
      return {
        success: false,
        message: 'Payment gateway request failed. Please try again.',
      };
    }
  }

  /**
   * Initiate a card checkout (Visa/Mastercard).
   *
   * Returns a gateway URL where the customer completes the card payment.
   */
  async initiateCardCheckout(
    request: SelcomPaymentRequest,
  ): Promise<SelcomPaymentResponse> {
    if (!this.isConfigured) {
      this.logger.warn(
        'Selcom not configured — returning simulated card checkout response',
      );
      return this.simulatePaymentResponse(request);
    }

    const payload = {
      vendor: this.vendor,
      order_id: request.orderId,
      buyer_email: request.buyerEmail || 'customer@narofashion.co.tz',
      buyer_name: request.buyerName || 'Naro Customer',
      buyer_phone: normalizePhone(request.phoneNumber || ''),
      amount: request.amount,
      currency: request.currency || 'TZS',
      payment_methods: 'ALL',
      webhook: this.webhookUrl,
      no_of_items: 1,
    };

    try {
      const data = await this.selcomRequest(
        '/checkout/create-order',
        'POST',
        payload,
      );

      if (data?.result === 'SUCCESS' || data?.resultcode === '000') {
        return {
          success: true,
          transactionId: data.transid || data.order_id,
          reference: data.reference || request.orderId,
          gatewayUrl: data.gateway_buyer_uuid
            ? `${this.baseUrl}/checkout/checkout-order/${data.gateway_buyer_uuid}`
            : undefined,
          message: 'Redirect customer to payment page.',
          rawResponse: data,
        };
      }

      return {
        success: false,
        message:
          data?.message || data?.resultcode || 'Failed to initiate checkout',
        rawResponse: data,
      };
    } catch (error) {
      this.logger.error(`Card checkout initiation failed: ${error}`);
      return {
        success: false,
        message: 'Payment gateway request failed. Please try again.',
      };
    }
  }

  /**
   * Initiate a payment — automatically routes to USSD push or card checkout
   * based on the payment method.
   */
  async initiatePayment(
    request: SelcomPaymentRequest,
    _creds?: unknown,
  ): Promise<SelcomPaymentResponse> {
    if (request.method === 'MOBILE_MONEY') {
      return this.initiateUssdPush(request);
    }
    return this.initiateCardCheckout(request);
  }

  /**
   * Check the status of a payment via the Selcom API.
   */
  async checkPaymentStatus(
    transactionRef: string,
    _creds?: unknown,
  ): Promise<SelcomStatusResponse> {
    if (!this.isConfigured) {
      this.logger.warn(
        'Selcom not configured — returning simulated status check',
      );
      return this.simulateStatusCheck(transactionRef);
    }

    try {
      const data = await this.selcomRequest(
        `/checkout/order-status?order_id=${transactionRef}`,
        'GET',
      );

      const status = this.mapSelcomStatus(
        data?.payment_status || data?.order_status,
      );

      return {
        success: true,
        status,
        transactionId: data?.transid,
        resultCode: data?.resultcode,
        message: data?.message || data?.result,
        rawResponse: data,
      };
    } catch (error) {
      this.logger.error(`Status check failed for ${transactionRef}: ${error}`);
      return {
        success: false,
        status: 'PENDING',
        message: 'Failed to check payment status.',
      };
    }
  }

  /**
   * Verify webhook signature using HMAC-SHA256.
   *
   * Selcom sends a signature header that can be verified against the payload
   * using the API secret.
   */
  verifyWebhookSignature(
    payload: string,
    signature: string | undefined,
    _creds?: unknown,
  ): boolean {
    if (!this.isConfigured) {
      this.logger.warn(
        'Selcom not configured — skipping webhook signature verification',
      );
      return true;
    }

    if (!signature) {
      this.logger.warn('Selcom webhook: missing signature header');
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.apiSecret)
        .update(payload)
        .digest('base64');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );

      if (!isValid) {
        this.logger.warn('Webhook signature verification failed');
      }

      return isValid;
    } catch (error) {
      this.logger.error(`Webhook signature verification error: ${error}`);
      return false;
    }
  }

  /**
   * Map Selcom payment status strings to our internal status enum.
   */
  private mapSelcomStatus(
    selcomStatus: string | undefined,
  ): GatewayStatusResult['status'] {
    if (!selcomStatus) return 'PENDING';

    const normalized = selcomStatus.toUpperCase();

    if (
      normalized === 'COMPLETED' ||
      normalized === 'SUCCESSFUL' ||
      normalized === 'SUCCESS' ||
      normalized === 'PAID'
    ) {
      return 'COMPLETED';
    }

    if (
      normalized === 'FAILED' ||
      normalized === 'REJECTED' ||
      normalized === 'DECLINED'
    ) {
      return 'FAILED';
    }

    if (normalized === 'CANCELLED' || normalized === 'EXPIRED') {
      return 'CANCELLED';
    }

    if (normalized === 'PROCESSING') {
      return 'PROCESSING';
    }

    return 'PENDING';
  }

  /**
   * Simulate a payment response when Selcom is not configured.
   * Useful for development and testing without live credentials.
   */
  private simulatePaymentResponse(
    request: SelcomPaymentRequest,
  ): SelcomPaymentResponse {
    const simulatedRef = `SIM-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    return {
      success: true,
      transactionId: simulatedRef,
      reference: request.orderId,
      gatewayUrl:
        request.method === 'CARD'
          ? `http://localhost:4000/api/v1/payments/simulated-checkout/${simulatedRef}`
          : undefined,
      message:
        request.method === 'MOBILE_MONEY'
          ? 'SIMULATED: USSD push sent. In production, the customer would see a prompt on their phone.'
          : 'SIMULATED: Card checkout initiated. In production, redirect to gateway URL.',
    };
  }

  /**
   * Simulate a status check when Selcom is not configured.
   * After 10 seconds from creation, simulated payments auto-complete.
   */
  private simulateStatusCheck(
    transactionRef: string,
  ): SelcomStatusResponse {
    // For simulated payments, auto-complete after a short delay to allow
    // testing the polling flow. Use the timestamp embedded in the ref.
    const parts = transactionRef.split('-');
    const createdAt = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
    const elapsed = Date.now() - createdAt;

    // Auto-complete after 10 seconds for testing
    const status: 'PENDING' | 'COMPLETED' =
      elapsed > 10000 ? 'COMPLETED' : 'PENDING';

    return {
      success: true,
      status,
      transactionId: transactionRef,
      message:
        status === 'COMPLETED'
          ? 'SIMULATED: Payment completed successfully.'
          : 'SIMULATED: Payment is still being processed.',
    };
  }
}
