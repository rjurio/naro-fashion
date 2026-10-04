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
  /**
   * Amount the gateway reports as actually collected, when the status API
   * returns one. Used by PaymentSettlementService to refuse crediting a short
   * collection on the poll/reconcile paths, same as the webhook path.
   */
  collectedAmount?: number;
}

/**
 * Input for a gateway refund/reversal of a previously COMPLETED collection.
 * Gateway-agnostic: providers pick the identifier their API needs.
 */
export interface GatewayRefundRequest {
  /** Our Payment.transactionRef of the original collection. */
  transactionRef?: string | null;
  /** The gateway's id for the original collection (Payment.providerTransactionId). */
  providerTransactionId?: string | null;
  amount: number;
  currency?: string;
  reason?: string;
}

/**
 * Result of `PaymentProvider.refund()`. `supported: false` means the provider
 * has no implemented/documented refund API — callers must fall back to a
 * manually recorded refund (money returned outside the gateway).
 */
export interface GatewayRefundResult {
  supported: boolean;
  success?: boolean;
  /** Why the refund is unsupported or failed (human readable). */
  reason?: string;
  /** Gateway reference for the refund, when one is issued. */
  refundReference?: string;
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

  /**
   * Refund (reverse) a completed collection through the gateway. Providers
   * without an implemented refund API return `{ supported: false, reason }`
   * — never invent an undocumented endpoint. Used by OrderRefundsService
   * for `method: 'GATEWAY'` refunds.
   */
  refund(
    request: GatewayRefundRequest,
    creds?: ProviderCredentials,
  ): Promise<GatewayRefundResult>;
}
