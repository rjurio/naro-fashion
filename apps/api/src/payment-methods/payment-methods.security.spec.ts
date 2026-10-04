import * as fs from 'fs';
import * as path from 'path';
import {
  maskIntegrationParams,
  maskPaymentMethod,
  restoreMaskedSecrets,
  isMaskedValue,
} from './secret-mask.util';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * Regression: any STAFF admin could GET integrationParams (gateway secrets)
 * in clear and PATCH them. Now: admin routes need 'payment-methods:manage',
 * secrets are masked on every admin read, and a masked value on update keeps
 * the stored secret instead of overwriting it with the mask.
 */

const creds = {
  clientId: 'CLIENT-123',
  apiKey: 'sk_live_abcdef123456',
  checksumSecret: 'chk_secret_998877',
  usePreview: true,
  nested: { clientSecret: 'nested-secret-0001', label: 'x' },
};

describe('secret masking', () => {
  it('masks secret-named keys (incl. nested), keeps the rest', () => {
    const m: any = maskIntegrationParams(creds);
    expect(m.clientId).toBe('CLIENT-123');
    expect(m.usePreview).toBe(true);
    expect(m.apiKey).toBe('••••3456');
    expect(m.checksumSecret).toBe('••••8877');
    expect(m.nested.clientSecret).toBe('••••0001');
    expect(m.nested.label).toBe('x');
    expect(JSON.stringify(m)).not.toContain('abcdef');
  });

  it('masks integrationKey on the row', () => {
    const row = maskPaymentMethod({ id: '1', integrationKey: 'very-secret-key', integrationParams: creds });
    expect(row.integrationKey).toBe('••••-key');
    expect(isMaskedValue(row.integrationKey)).toBe(true);
  });

  it('restoreMaskedSecrets keeps stored secrets for masked values, applies real edits', () => {
    const roundTrip: any = maskIntegrationParams(creds);
    roundTrip.clientId = 'CLIENT-NEW';
    roundTrip.apiKey = 'sk_live_rotated_0000';
    const merged: any = restoreMaskedSecrets(roundTrip, creds);
    expect(merged.clientId).toBe('CLIENT-NEW');
    expect(merged.apiKey).toBe('sk_live_rotated_0000');
    expect(merged.checksumSecret).toBe(creds.checksumSecret);
    expect(merged.nested.clientSecret).toBe(creds.nested.clientSecret);
  });
});

describe('PaymentMethodsService masking', () => {
  function make() {
    const prisma: any = {
      paymentMethod: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pm1', integrationParams: creds, integrationKey: 'very-secret-key' }]),
        findFirst: jest.fn().mockResolvedValue({ id: 'pm1', integrationParams: creds, integrationKey: 'very-secret-key' }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'pm1', integrationKey: 'very-secret-key', integrationParams: creds, ...data })),
      },
    };
    return { prisma, svc: new PaymentMethodsService(prisma, { id: 't1' } as any) };
  }

  it('admin list never returns secrets in clear', async () => {
    const { svc } = make();
    const rows: any[] = await svc.findAllAdmin();
    expect(JSON.stringify(rows)).not.toContain('sk_live_abcdef123456');
    expect(JSON.stringify(rows)).not.toContain('very-secret-key');
  });

  it('update with the masked round-trip does not overwrite stored secrets', async () => {
    const { svc, prisma } = make();
    const masked: any = maskIntegrationParams(creds);
    await svc.update('pm1', { integrationParams: masked, integrationKey: '••••-key' });
    const data = prisma.paymentMethod.update.mock.calls[0][0].data;
    expect(data.integrationParams.apiKey).toBe(creds.apiKey);
    expect(data.integrationParams.checksumSecret).toBe(creds.checksumSecret);
    expect(data).not.toHaveProperty('integrationKey');
  });
});

describe('RBAC wiring (shape)', () => {
  function routesWithoutPermission(file: string, code: string) {
    const src = fs.readFileSync(file, 'utf8');
    const blocks = src.split(/\n(?=\s*@UseGuards\(|\s*@Public\(\))/);
    return blocks.filter(
      (b) => /@UseGuards\([^)]*AdminGuard/.test(b) && !(b.includes('PermissionGuard') && b.includes(`@RequiresPermission('${code}')`)),
    );
  }

  it("every admin payment-methods route requires 'payment-methods:manage'", () => {
    const file = path.join(__dirname, 'payment-methods.controller.ts');
    expect(routesWithoutPermission(file, 'payment-methods:manage')).toEqual([]);
  });

  it("every admin payments route requires 'payments:manage'", () => {
    const file = path.join(__dirname, '..', 'payments', 'payments.controller.ts');
    expect(routesWithoutPermission(file, 'payments:manage')).toEqual([]);
  });
});
