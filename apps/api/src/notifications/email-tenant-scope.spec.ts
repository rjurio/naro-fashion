import { BadRequestException } from '@nestjs/common';
import { EmailService } from './email.service';
import { requestContextStorage } from '../tenant/request-context';
import { __resetDefaultTenantCache } from '../tenant/default-tenant';
import { PERMISSIONS_KEY } from '../auth/decorators/requires-permission.decorator';
import { NewsletterController } from '../newsletter/newsletter.controller';
import { IdVerificationService } from '../id-verification/id-verification.service';

function makePrisma() {
  const rows = [
    { tenantId: 'A', key: 'site_name', value: 'Shop A' },
    { tenantId: 'A', key: 'business_domain', value: 'a.co.tz' },
    { tenantId: 'B', key: 'site_name', value: 'Shop B' },
    { tenantId: 'B', key: 'business_domain', value: 'b.co.tz' },
  ];
  return {
    siteSetting: {
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((r) => r.tenantId === where.tenantId && where.key.in.includes(r.key)),
      ),
      findFirst: jest.fn(async () => rows[0]), // the old unscoped bug path — must NOT be used
    },
    tenant: {
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => [{ id: 'A' }, { id: 'B' }]), // 2 tenants → no default
    },
  } as any;
}

const config: any = { get: jest.fn((_k: string, d?: any) => d) };

describe('EmailService tenant-scoped branding', () => {
  beforeEach(() => __resetDefaultTenantCache());

  it('uses the explicit tenantId', async () => {
    const svc = new EmailService(config, makePrisma());
    expect(await svc.getBranding('B')).toEqual({ businessName: 'Shop B', domain: 'b.co.tz' });
  });

  it('falls back to the in-flight request tenant (AsyncLocalStorage)', async () => {
    const prisma = makePrisma();
    const svc = new EmailService(config, prisma);
    const branding = await requestContextStorage.run({ req: { tenantId: 'B' } }, () => svc.getBranding());
    expect(branding.businessName).toBe('Shop B');
    expect(prisma.siteSetting.findFirst).not.toHaveBeenCalled();
  });

  it('never picks an arbitrary tenant when none is known (multi-tenant, no default)', async () => {
    const prisma = makePrisma();
    const svc = new EmailService(config, prisma);
    expect(await svc.getBranding()).toEqual({ businessName: 'Naro Fashion', domain: 'narofashion.co.tz' });
    expect(prisma.siteSetting.findFirst).not.toHaveBeenCalled();
  });
});

describe('abandoned-cart reminder', () => {
  it('sends the tenant-branded abandoned-cart template with items + cart link', async () => {
    const { NotificationsService } = await import('./notifications.service');
    const email: any = {
      getBranding: jest.fn(async (t: string) => ({ businessName: `Shop ${t}`, domain: 'x' })),
      send: jest.fn(async () => ({ sent: true, channel: 'smtp' })),
    };
    const svc = new NotificationsService({} as any, email, {} as any);
    const items = Array.from({ length: 7 }, (_, i) => ({ name: `Gown ${i}`, quantity: 1, price: '350000' }));
    await svc.sendAbandonedCartReminder({ tenantId: 'B', to: 'c@x.tz', items, cartUrl: 'https://b.tz/cart' });
    const call = email.send.mock.calls[0][0];
    expect(call.template).toBe('abandoned-cart');
    expect(call.tenantId).toBe('B');
    expect(call.subject).toContain('Shop B');
    expect(call.context.items).toHaveLength(5);
    expect(call.context.moreCount).toBe(2);
    expect(call.context.items[0].price).toBe('350,000');
  });

  it('the template renders the item list and the CTA', () => {
    const hb = require('handlebars');
    const src = require('fs').readFileSync(require('path').join(__dirname, 'templates', 'abandoned-cart.hbs'), 'utf8');
    const html = hb.compile(src)({
      customerName: 'Amina',
      businessName: 'Shop B',
      items: [{ name: 'Ball Gown', quantity: 2, price: '350,000' }],
      cartUrl: 'https://b.tz/cart',
    });
    expect(html).toContain('Ball Gown');
    expect(html).toContain('https://b.tz/cart');
    expect(html).toContain('Shop B');
  });
});

describe('newsletter send RBAC', () => {
  it.each(['sendNewsletter', 'resendFailed'] as const)('%s requires newsletter:send', (m) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, (NewsletterController.prototype as any)[m])).toEqual([
      'newsletter:send',
    ]);
  });
});

describe('ID verification submit only accepts private refs of the caller tenant', () => {
  const okRef = (t: string) => `private://id-documents/${t}/${'a'.repeat(32)}.png`;
  function svc() {
    const prisma: any = {
      customerIDDocument: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => data),
      },
    };
    return new IdVerificationService(prisma, {} as any, { requireId: 'A' } as any);
  }

  it('accepts refs produced for the caller tenant', async () => {
    await expect(
      svc().submit('u1', { frontImageUrl: okRef('A'), backImageUrl: okRef('A'), idNumber: '123' }),
    ).resolves.toBeTruthy();
  });

  it.each([
    'https://evil.example/pixel.png',
    okRef('B'),
    `A/${'a'.repeat(32)}.png`,
  ])('rejects %s', async (bad) => {
    await expect(
      svc().submit('u1', { frontImageUrl: bad, backImageUrl: okRef('A'), idNumber: '123' }),
    ).rejects.toThrow(BadRequestException);
  });
});
