import { addMonthsClamped } from './billing-date.util';
import { TenantsService } from './tenants.service';

describe('addMonthsClamped', () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it('clamps to the end of shorter months', () => {
    expect(iso(addMonthsClamped(new Date('2026-01-31T10:00:00Z'), 1))).toBe('2026-02-28');
    expect(iso(addMonthsClamped(new Date('2028-01-31T10:00:00Z'), 1))).toBe('2028-02-29'); // leap
    expect(iso(addMonthsClamped(new Date('2026-03-31T10:00:00Z'), 1))).toBe('2026-04-30');
  });

  it('handles yearly and year rollover', () => {
    expect(iso(addMonthsClamped(new Date('2028-02-29T00:00:00Z'), 12))).toBe('2029-02-28');
    expect(iso(addMonthsClamped(new Date('2026-12-15T00:00:00Z'), 1))).toBe('2027-01-15');
  });

  it('preserves time of day', () => {
    expect(addMonthsClamped(new Date('2026-01-31T13:45:00Z'), 1).toISOString()).toBe(
      '2026-02-28T13:45:00.000Z',
    );
  });
});

describe('TenantsService.subscribeTenant', () => {
  function make(tenantStatus: string) {
    const tx: any = {
      tenantSubscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
      },
      tenant: { update: jest.fn() },
      tenantModule: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const prisma: any = {
      subscriptionPlan: {
        findUnique: jest.fn().mockResolvedValue({ id: 'plan', enabledModules: ['pos'] }),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1', status: tenantStatus }) },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
    };
    return { svc: new TenantsService(prisma), tx, prisma };
  }

  it('runs in one transaction and cancels GRACE as well as ACTIVE subscriptions', async () => {
    const { svc, tx, prisma } = make('ACTIVE');
    await svc.subscribeTenant('t1', 'plan');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const where = tx.tenantSubscription.updateMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(expect.arrayContaining(['ACTIVE', 'GRACE']));
    expect(tx.tenant.update).not.toHaveBeenCalled();
  });

  it.each(['TRIAL', 'SUSPENDED'])('reactivates a %s tenant', async (status) => {
    const { svc, tx } = make(status);
    await svc.subscribeTenant('t1', 'plan');
    expect(tx.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'ACTIVE' } });
  });

  it('does not reactivate a DEACTIVATED tenant', async () => {
    const { svc, tx } = make('DEACTIVATED');
    await svc.subscribeTenant('t1', 'plan');
    expect(tx.tenant.update).not.toHaveBeenCalled();
  });

  it('monthly end date is clamped (Jan 31 → Feb 28)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-31T09:00:00Z'));
    const { svc, tx } = make('ACTIVE');
    await svc.subscribeTenant('t1', 'plan', 'MONTHLY');
    const data = tx.tenantSubscription.create.mock.calls[0][0].data;
    expect(data.endDate.toISOString().slice(0, 10)).toBe('2026-02-28');
    jest.useRealTimers();
  });
});
