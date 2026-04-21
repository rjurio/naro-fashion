import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isMixxMsisdn, maskPhone, normalizePhone } from './phone.util';
import { verifyChecksum } from './clickpesa.checksum';
import {
  GatewayInitiateRequest,
  GatewayInitiateResult,
  GatewayStatusResult,
  PaymentProvider,
  PROVIDER_CODES,
  ProviderCode,
} from './payment-provider.types';

/**
 * Per-tenant ClickPesa credentials stored in PaymentMethod.integrationParams.
 * Saved/edited from the admin "Payment Methods" form (JSON textarea).
 */
export interface ClickPesaCredentials {
  clientId: string;
  apiKey: string;
  checksumSecret: string;
  usePreview?: boolean;
  webhookIpAllowlist?: string[];
}

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
  inflight?: Promise<string>;
}

interface ClickPesaInitiateResponse {
  id: string;
  status: string;
  channel?: string;
  orderReference: string;
  collectedAmount?: string | number;
  collectedCurrency?: string;
  createdAt?: string;
  clientId?: string;
  message?: string;
}

interface ClickPesaPreviewMethod {
  name: string;
  status: 'AVAILABLE' | 'UNAVAILABLE' | string;
  fee?: number | string;
  message?: string;
}

interface ClickPesaPreviewResponse {
  activeMethods?: ClickPesaPreviewMethod[];
  sender?: Record<string, unknown>;
  message?: string;
}

interface ClickPesaQueryEntry {
  status: 'SUCCESS' | 'SETTLED' | 'PROCESSING' | 'PENDING' | 'FAILED' | string;
  paymentReference?: string;
  paymentPhoneNumber?: string;
  collectedAmount?: string | number;
  collectedCurrency?: string;
  message?: string;
  customer?: Record<string, unknown>;
  orderReference?: string;
  id?: string;
}

const MIXX_METHOD_NAME = 'TIGO-PESA';

/**
 * ClickPesa (Mixx by YAS, formerly Tigo Pesa) USSD-push collections provider.
 *
 * Docs: https://docs.clickpesa.com/
 *
 * Flow:
 *  1. POST /generate-token  → JWT valid 1 hour, cached per-tenant in memory.
 *  2. POST /payments/preview-ussd-push-request (optional) — abort if TIGO-PESA not AVAILABLE.
 *  3. POST /payments/initiate-ussd-push-request → customer gets USSD prompt.
 *  4. Webhook + reconciliation cron (30s) drive the terminal state.
 */
@Injectable()
export class ClickPesaProvider implements PaymentProvider {
  readonly code: ProviderCode = PROVIDER_CODES.CLICKPESA_MIXX;
  private readonly logger = new Logger(ClickPesaProvider.name);
  private readonly baseUrl: string;
  private readonly tokenTtlMinutes: number;

  // Per-tenant token cache — keyed by clientId so multiple tenants never collide.
  private readonly tokenCache: Map<string, TokenCacheEntry> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      'CLICKPESA_BASE_URL',
      'https://api.clickpesa.com/third-parties',
    );
    this.tokenTtlMinutes = Number(
      this.configService.get<string>('CLICKPESA_TOKEN_TTL_MINUTES', '55'),
    );
    this.logger.log(
      `ClickPesa provider initialized (base: ${this.baseUrl}, token TTL: ${this.tokenTtlMinutes}m)`,
    );
  }

  // ─── PaymentProvider interface ──────────────────────────────────────────

  async initiatePayment(
    request: GatewayInitiateRequest,
    creds?: ClickPesaCredentials,
  ): Promise<GatewayInitiateResult> {
    const c = this.requireCreds(creds);

    if (request.method !== 'MOBILE_MONEY') {
      return {
        success: false,
        message: 'ClickPesa Mixx integration only supports MOBILE_MONEY',
      };
    }

    const phone = normalizePhone(request.phoneNumber || '');
    if (!isMixxMsisdn(phone)) {
      throw new BadRequestException(
        'Mixx by YAS only accepts 071/065/067/077 numbers. Please use a Tigo/Yas line.',
      );
    }

    // ClickPesa orderReference must be alphanumeric + unique. The caller
    // already generates a transaction ref like "NARO-171..." — strip the
    // hyphens to comply with the alphanumeric rule.
    const orderReference = this.sanitizeReference(request.orderId);

    if (c.usePreview !== false) {
      await this.previewUssdPush(c, {
        amount: request.amount,
        orderReference,
        phoneNumber: phone,
      });
    }

    try {
      const res = await this.initiateUssdPush(c, {
        amount: request.amount,
        orderReference,
        phoneNumber: phone,
      });

      this.logger.log(
        `ClickPesa initiate OK — ref=${orderReference}, id=${res.id}, phone=${maskPhone(phone)}`,
      );

      return {
        success: true,
        transactionId: res.id,
        reference: orderReference,
        message: 'USSD push sent. Enter your Mixx PIN on the prompt.',
        rawResponse: res,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`ClickPesa initiate failed (${orderReference}): ${msg}`);
      return {
        success: false,
        message: msg,
      };
    }
  }

  async checkPaymentStatus(
    transactionRef: string,
    creds?: ClickPesaCredentials,
  ): Promise<GatewayStatusResult> {
    const c = this.requireCreds(creds);
    const orderReference = this.sanitizeReference(transactionRef);

    try {
      const token = await this.getToken(c);
      const url = `${this.baseUrl}/payments/${encodeURIComponent(orderReference)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        this.invalidateToken(c.clientId);
        return this.checkPaymentStatus(transactionRef, c);
      }

      const data = (await response.json()) as
        | ClickPesaQueryEntry[]
        | ClickPesaQueryEntry
        | { message?: string };

      if (!response.ok) {
        return {
          success: false,
          status: 'PENDING',
          message:
            (data as any)?.message ||
            `ClickPesa query failed (${response.status})`,
          rawResponse: data,
        };
      }

      const entries: ClickPesaQueryEntry[] = Array.isArray(data)
        ? (data as ClickPesaQueryEntry[])
        : [data as ClickPesaQueryEntry];

      // Prefer a terminal entry if one exists (SETTLED > SUCCESS > FAILED > PROCESSING > PENDING).
      const picked = this.pickMostProgressedEntry(entries);

      if (!picked) {
        return {
          success: true,
          status: 'PENDING',
          message: 'No payment record yet at ClickPesa',
          rawResponse: data,
        };
      }

      return {
        success: true,
        status: this.mapStatus(picked.status),
        transactionId: picked.id,
        message: picked.message,
        rawResponse: data,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`ClickPesa status check failed: ${msg}`);
      return { success: false, status: 'PENDING', message: msg };
    }
  }

  verifyWebhookSignature(
    rawBody: string,
    signature: string | undefined,
    creds?: ClickPesaCredentials,
  ): boolean {
    const c = this.requireCreds(creds);
    if (!signature) {
      this.logger.warn('ClickPesa webhook: missing checksum');
      return false;
    }
    try {
      const payload = JSON.parse(rawBody);
      return verifyChecksum(payload, c.checksumSecret, signature);
    } catch (err) {
      this.logger.warn(`ClickPesa webhook: invalid JSON — ${err}`);
      return false;
    }
  }

  // ─── ClickPesa HTTP calls ───────────────────────────────────────────────

  async getToken(creds: ClickPesaCredentials): Promise<string> {
    const key = creds.clientId;
    const now = Date.now();
    const cached = this.tokenCache.get(key);

    if (cached && cached.expiresAt > now + 30_000) {
      return cached.token;
    }

    if (cached?.inflight) {
      return cached.inflight;
    }

    const inflight = (async () => {
      const url = `${this.baseUrl}/generate-token`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'client-id': creds.clientId,
          'api-key': creds.apiKey,
        },
      });

      const data = (await response.json()) as {
        success?: boolean;
        token?: string;
        message?: string;
      };

      if (!response.ok || !data.token) {
        throw new Error(
          `ClickPesa token generation failed (${response.status}): ${data.message ?? 'no token in response'}`,
        );
      }

      // Strip leading "Bearer " if the API returns it prefixed.
      const token = data.token.replace(/^Bearer\s+/i, '');
      const expiresAt = now + this.tokenTtlMinutes * 60_000;
      this.tokenCache.set(key, { token, expiresAt });
      return token;
    })();

    this.tokenCache.set(key, {
      token: cached?.token ?? '',
      expiresAt: cached?.expiresAt ?? 0,
      inflight,
    });

    try {
      return await inflight;
    } catch (err) {
      this.tokenCache.delete(key);
      throw err;
    }
  }

  invalidateToken(clientId: string) {
    this.tokenCache.delete(clientId);
  }

  private async previewUssdPush(
    creds: ClickPesaCredentials,
    req: { amount: number; orderReference: string; phoneNumber: string },
  ): Promise<ClickPesaPreviewResponse> {
    const token = await this.getToken(creds);
    const url = `${this.baseUrl}/payments/preview-ussd-push-request`;
    const body = {
      amount: String(req.amount),
      currency: 'TZS',
      orderReference: req.orderReference,
      phoneNumber: req.phoneNumber,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      this.invalidateToken(creds.clientId);
      return this.previewUssdPush(creds, req);
    }

    const data = (await response.json()) as ClickPesaPreviewResponse;

    if (!response.ok) {
      throw new Error(
        `ClickPesa preview failed (${response.status}): ${data.message ?? 'unknown error'}`,
      );
    }

    const mixx = (data.activeMethods ?? []).find(
      (m) => m.name === MIXX_METHOD_NAME,
    );

    if (!mixx || mixx.status !== 'AVAILABLE') {
      throw new Error(
        mixx?.message ??
          'Mixx by YAS is currently unavailable for this number. Please try again later.',
      );
    }

    return data;
  }

  private async initiateUssdPush(
    creds: ClickPesaCredentials,
    req: { amount: number; orderReference: string; phoneNumber: string },
  ): Promise<ClickPesaInitiateResponse> {
    const token = await this.getToken(creds);
    const url = `${this.baseUrl}/payments/initiate-ussd-push-request`;
    const body = {
      amount: String(req.amount),
      currency: 'TZS',
      orderReference: req.orderReference,
      phoneNumber: req.phoneNumber,
    };

    let response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      this.invalidateToken(creds.clientId);
      const retryToken = await this.getToken(creds);
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${retryToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    }

    if (response.status === 409) {
      // Reference already used — regenerate with a salt and retry once.
      const salted = `${req.orderReference}R${Math.floor(Math.random() * 1e6)}`;
      const retryBody = { ...body, orderReference: salted };
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.getToken(creds)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(retryBody),
      });
      if (response.ok) {
        const data = (await response.json()) as ClickPesaInitiateResponse;
        return { ...data, orderReference: salted };
      }
    }

    const data = (await response.json()) as
      | ClickPesaInitiateResponse
      | { message?: string };

    if (!response.ok) {
      throw new Error(
        `ClickPesa initiate failed (${response.status}): ${(data as any)?.message ?? 'unknown error'}`,
      );
    }

    return data as ClickPesaInitiateResponse;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private requireCreds(creds?: ClickPesaCredentials): ClickPesaCredentials {
    if (!creds || !creds.clientId || !creds.apiKey || !creds.checksumSecret) {
      throw new BadRequestException(
        'ClickPesa credentials not configured for this tenant. Add a PaymentMethod with code CLICKPESA_MIXX and integrationParams { clientId, apiKey, checksumSecret }.',
      );
    }
    return creds;
  }

  private sanitizeReference(ref: string): string {
    return ref.replace(/[^A-Za-z0-9]/g, '');
  }

  private pickMostProgressedEntry(
    entries: ClickPesaQueryEntry[],
  ): ClickPesaQueryEntry | undefined {
    const rank = (s: string): number => {
      switch (s?.toUpperCase()) {
        case 'SETTLED':
          return 5;
        case 'SUCCESS':
          return 4;
        case 'FAILED':
          return 3;
        case 'PROCESSING':
          return 2;
        case 'PENDING':
          return 1;
        default:
          return 0;
      }
    };
    return [...entries].sort((a, b) => rank(b.status) - rank(a.status))[0];
  }

  /**
   * Map a ClickPesa payment status string to our internal status enum.
   */
  mapStatus(clickpesaStatus: string | undefined): GatewayStatusResult['status'] {
    if (!clickpesaStatus) return 'PENDING';
    const s = clickpesaStatus.toUpperCase();
    if (s === 'SUCCESS' || s === 'SETTLED') return 'COMPLETED';
    if (s === 'PROCESSING' || s === 'PENDING') return 'PROCESSING';
    if (s === 'FAILED') return 'FAILED';
    return 'PENDING';
  }
}
