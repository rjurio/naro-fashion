import { ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';
import { SelcomProvider } from './selcom.provider';

/**
 * Regression: Selcom used to FAIL OPEN when SELCOM_* env vars were unset —
 * initiate returned a simulated success, status checks auto-COMPLETED any
 * payment after 10s, and verifyWebhookSignature returned true for any body.
 * In production that is now fail-closed; simulation stays dev-only.
 */
function makeProvider(env: Record<string, string | undefined>) {
  const config = {
    get: (key: string, def?: any) => (env[key] !== undefined ? env[key] : def),
  };
  return new SelcomProvider(config as any);
}

const UNCONFIGURED_PROD = { NODE_ENV: 'production' };
const UNCONFIGURED_DEV = { NODE_ENV: 'development' };
const CONFIGURED = {
  NODE_ENV: 'production',
  SELCOM_API_KEY: 'key',
  SELCOM_API_SECRET: 'super-secret',
  SELCOM_VENDOR: 'vendor',
};

const oldRef = `NARO-${Date.now() - 60_000}-1234`;

describe('SelcomProvider — fail closed in production', () => {
  it('initiatePayment throws ServiceUnavailable when unconfigured in production', async () => {
    const p = makeProvider(UNCONFIGURED_PROD);
    await expect(
      p.initiatePayment({ orderId: 'x', amount: 1000, method: 'MOBILE_MONEY', phoneNumber: '0712345678' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      p.initiatePayment({ orderId: 'x', amount: 1000, method: 'CARD' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('checkPaymentStatus never simulates COMPLETED in production', async () => {
    const p = makeProvider(UNCONFIGURED_PROD);
    const res = await p.checkPaymentStatus(oldRef);
    expect(res.success).toBe(false);
    expect(res.status).not.toBe('COMPLETED');
  });

  it('verifyWebhookSignature returns false when unconfigured in production', () => {
    const p = makeProvider(UNCONFIGURED_PROD);
    expect(p.verifyWebhookSignature('{"status":"SUCCESS"}', undefined)).toBe(false);
    expect(p.verifyWebhookSignature('{"status":"SUCCESS"}', 'anything')).toBe(false);
  });

  it('still simulates outside production (dev convenience)', async () => {
    const p = makeProvider(UNCONFIGURED_DEV);
    const init = await p.initiatePayment({ orderId: 'x', amount: 1000, method: 'MOBILE_MONEY', phoneNumber: '0712345678' });
    expect(init.success).toBe(true);
    const status = await p.checkPaymentStatus(oldRef);
    expect(status.status).toBe('COMPLETED');
    expect(p.verifyWebhookSignature('{}', undefined)).toBe(true);
  });

  it('configured: verifies HMAC over the exact raw bytes', () => {
    const p = makeProvider(CONFIGURED);
    const raw = '{"order_id":"NARO-1-2", "status":"SUCCESS","amount":1000}';
    const sig = crypto.createHmac('sha256', 'super-secret').update(raw).digest('base64');
    expect(p.verifyWebhookSignature(raw, sig)).toBe(true);
    // A re-serialised body (different whitespace) does not match the signature.
    expect(p.verifyWebhookSignature(JSON.stringify(JSON.parse(raw)), sig)).toBe(false);
    expect(p.verifyWebhookSignature(raw, undefined)).toBe(false);
  });
});
