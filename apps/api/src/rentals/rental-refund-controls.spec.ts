import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { PosService } from '../pos/pos.service';
import { RentalMoneyService } from './rental-money.service';
import { SystemRolesSeeder, MANAGER_EXCLUDED } from '../roles/system-roles.seeder';

// Refund controls (2026-11-12 launch review, item D). A refund is money going
// back to a customer: it is only ever a NEW payout row written by the
// workflow that owns it (rental: request → independent approval → payout by
// someone other than the requester). No status edit or reversal may stand in
// for it, and no role gets the rental controls by default.

const T = 'tenant-a';

describe('PATCH /payments/:id can never mark a payment REFUNDED', () => {
  function svc(payment: any) {
    const prisma: any = {
      payment: {
        findFirst: jest.fn().mockResolvedValue(payment),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
    };
    const settlement = { settleParents: jest.fn() };
    return { s: new PaymentsService(prisma, {} as any, { requireId: T } as any, settlement as any), prisma, settlement };
  }
  const online = (extra: any) => ({ id: 'p1', tenantId: T, status: 'COMPLETED', method: 'MPESA', amount: 100000, gatewayResponse: { provider: 'clickpesa' }, ...extra });

  it.each([
    ['an online rental payment', { rentalOrderId: 'r1', orderId: null }, /refund request/],
    ['an online order payment', { rentalOrderId: null, orderId: 'o1' }, /orders\/:id\/refunds/],
    ['an unlinked payment', { rentalOrderId: null, orderId: null }, /refund workflow/],
  ])('%s → 409 USE_REFUND_WORKFLOW, nothing written, nothing settled', async (_n, extra, msg) => {
    const { s, prisma, settlement } = svc(online(extra));
    const err: any = await s.updateStatus('p1', { status: 'REFUNDED' } as any, 'admin-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().code).toBe('USE_REFUND_WORKFLOW');
    expect(err.getResponse().message).toMatch(msg);
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(settlement.settleParents).not.toHaveBeenCalled();
  });

  it('legitimate status edits still work (PENDING → COMPLETED on a rental payment)', async () => {
    const { s, prisma } = svc(online({ status: 'PENDING', rentalOrderId: 'r1' }));
    prisma.payment.findFirst.mockResolvedValueOnce(online({ status: 'PENDING', rentalOrderId: 'r1' })).mockResolvedValue(online({ rentalOrderId: 'r1' }));
    const r: any = await s.updateStatus('p1', { status: 'COMPLETED' } as any, 'admin-1');
    expect(r.status).toBe('COMPLETED');
    expect(prisma.payment.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'p1', tenantId: T });
  });
});

describe('POS "reverse payment" never touches a rental payment', () => {
  it('→ 409 USE_REFUND_WORKFLOW inside the transaction, before any write', async () => {
    const tx: any = {
      payment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'p1', tenantId: T, rentalOrderId: 'r1', status: 'COMPLETED', method: 'MPESA', amount: 300000,
          gatewayResponse: { verification: { evidence: 'manual' } },
        }),
        updateMany: jest.fn(),
      },
      order: { updateMany: jest.fn() },
      layaway: { updateMany: jest.fn() },
    };
    const pos: any = Object.create(PosService.prototype);
    pos.tenantContext = { requireId: T };
    pos.prisma = { $transaction: (fn: any) => fn(tx) };
    const err: any = await pos.reversePayment('p1', 'terminal report does not show it', 'admin-1').catch((e: any) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().code).toBe('USE_REFUND_WORKFLOW');
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });
});

describe('rental refund payout: the requester can never pay it out', () => {
  function money(request: any) {
    const svc: any = Object.create(RentalMoneyService.prototype);
    svc.tenantContext = { requireId: T };
    svc.audit = { log: jest.fn() };
    svc.prisma = { posSession: { findFirst: jest.fn() }, $transaction: jest.fn() };
    svc.loadRequest = jest.fn().mockResolvedValue(request);
    return svc;
  }
  const approved = { id: 'rr1', tenantId: T, rentalOrderId: 'r1', status: 'APPROVED', amount: 200000, retainedAmount: 0, requestedById: 'cashier-1', approvedById: 'owner-1' };

  it('payer == requester → 403 PAYOUT_BY_REQUESTER, audited, no money moved', async () => {
    const svc = money(approved);
    const err: any = await svc.pay('rr1', { method: 'CASH', sessionId: 's1' }, { id: 'cashier-1' }).catch((e: any) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().code).toBe('PAYOUT_BY_REQUESTER');
    expect(svc.audit.log).toHaveBeenCalledWith('REFUND_PAYOUT_DENIED', 'RentalRefundRequest', 'rr1', { reason: 'PAYOUT_BY_REQUESTER' });
    expect(svc.prisma.$transaction).not.toHaveBeenCalled();
    expect(svc.prisma.posSession.findFirst).not.toHaveBeenCalled();
  });

  it('a different person (here the approver) passes the separation check', async () => {
    const svc = money(approved);
    svc.prisma.posSession.findFirst.mockResolvedValue(null); // stops at the shift check, after the separation check
    const err: any = await svc.pay('rr1', { method: 'CASH', sessionId: 's1' }, { id: 'owner-1' }).catch((e: any) => e);
    expect(err?.getResponse?.().code).not.toBe('PAYOUT_BY_REQUESTER');
    expect(svc.prisma.posSession.findFirst).toHaveBeenCalled();
  });
});

describe('fresh database: no role gets the rental controls by default', () => {
  const CONTROL_CODES = [
    'rentals:create', 'rentals:record-payment', 'rentals:release', 'rentals:refund-request',
    'rentals:manage-inventory', 'refunds:approve', 'id-verification:review', 'payments:confirm-manual',
    'payments:reverse', 'payments:manage', 'rentals:approve-unit-tracking',
  ];

  it('MANAGER_EXCLUDED lists every rental / refund control', () => {
    for (const c of CONTROL_CODES) expect(MANAGER_EXCLUDED).toContain(c);
  });

  it('seeding an empty database gives MANAGER none of them (SUPER_ADMIN holds all)', async () => {
    const perms = [...CONTROL_CODES, 'rentals:view', 'rentals:update-status', 'products:view'].map((code, i) => ({ id: `perm-${i}`, code }));
    const created: Record<string, string[]> = {};
    let n = 0;
    const prisma: any = {
      permission: { findMany: jest.fn().mockResolvedValue(perms) },
      role: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: `role-${n++}`, ...data })),
      },
      rolePermission: {
        createMany: jest.fn().mockImplementation(({ data }: any) => {
          const roleId = data[0]?.roleId;
          created[roleId] = data.map((d: any) => perms.find((p) => p.id === d.permissionId)!.code);
          return { count: data.length };
        }),
      },
    };
    await new SystemRolesSeeder(prisma).seed();
    const roleIdOf = (name: string) => prisma.role.create.mock.results.find((r: any) => r.value.name === name)!.value.id;
    const manager = created[roleIdOf('MANAGER')] ?? [];
    const superAdmin = created[roleIdOf('SUPER_ADMIN')] ?? [];
    for (const c of CONTROL_CODES) {
      expect(manager).not.toContain(c);
      expect(superAdmin).toContain(c);
    }
    expect(manager).toEqual(expect.arrayContaining(['rentals:view', 'rentals:update-status']));
  });
});
