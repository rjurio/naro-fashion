/**
 * Canonical payment-provider codes used across the app.
 * Stored on Payment.providerCode and PaymentMethod.code.
 */
export const PROVIDER_CODES = {
  SELCOM: 'SELCOM',
  CLICKPESA_MIXX: 'CLICKPESA_MIXX',
} as const;

export type ProviderCode = (typeof PROVIDER_CODES)[keyof typeof PROVIDER_CODES];

/**
 * Input envelope passed to every provider's `initiatePayment`.
 * Kept small and gateway-agnostic — providers can ignore fields they don't need.
 */
export interface GatewayInitiateRequest {
  orderId: string;
  amount: number;
  phoneNumber?: string;
  method: 'MOBILE_MONEY' | 'CARD';
  buyerEmail?: string;
  buyerName?: string;
  currency?: string;
}

export interface GatewayInitiateResult {
  success: boolean;
  transactionId?: string;
  reference?: string;
  gatewayUrl?: string;
  message?: string;
  rawResponse?: any;
}

export interface GatewayStatusResult {
  success: boolean;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  transactionId?: string;
  resultCode?: string;
  message?: string;
  rawResponse?: any;
}

/**
 * Per-tenant credentials resolved from PaymentMethod.integrationParams.
 * Shape is provider-specific — providers cast to their own type internally.
 */
export type ProviderCredentials = Record<string, any>;

/**
 * Common shape every gateway provider implements so PaymentsService can
 * dispatch through the registry without knowing the underlying API.
 */
export interface PaymentProvider {
  readonly code: ProviderCode;

  initiatePayment(
    request: GatewayInitiateRequest,
    creds?: ProviderCredentials,
  ): Promise<GatewayInitiateResult>;

  checkPaymentStatus(
    transactionRef: string,
    creds?: ProviderCredentials,
  ): Promise<GatewayStatusResult>;

  verifyWebhookSignature(
    rawBody: string,
    signature: string | undefined,
    creds?: ProviderCredentials,
  ): boolean;
}
