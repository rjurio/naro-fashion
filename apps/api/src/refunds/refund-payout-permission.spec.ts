import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/requires-permission.decorator';
import { PERMISSIONS, MANAGER_DEFAULT_GRANTS } from '../permissions/permissions.service';
import { MANAGER_EXCLUDED, STAFF_CODES } from '../roles/system-roles.seeder';
import { RefundRequestsController } from './refund-requests.controller';
import { RefundRequestsService } from './refund-requests.service';
import { RentalMoneyController } from '../rentals/rental-money.controller';
import { RentalMoneyService } from '../rentals/rental-money.service';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentMethodsController } from '../payment-methods/payment-methods.controller';
import { PosController } from '../pos/pos.controller';
import { OrderRefundsController } from '../orders/order-refunds.controller';
import { REFUND_PAYOUT_PERMISSIONS } from './payout-permission';

// refunds:payout — the cashier's payout-only permission (owner: no unrestricted
// payments:manage at the till). It records the payout / payout failure of a
// refund that SOMEONE ELSE requested and a THIRD person approved, and nothing
// else. The separation rules are about who acts, so they bind a refunds:payout
// holder exactly as they bind a payments:manage holder or a SUPER_ADMIN.

const T = 'tenant-a';
beforeAll(() => { jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined); jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });

describe('refunds:payout is seeded, never auto-granted', () => {
  it('is in the permission catalogue (module payments)', () => {
    expect(PERMISSIONS.find((p) => p.code === 'refunds:payout')).toMatchObject({ module: 'payments', action: 'payout-refund' });
  });
  it('is excluded from MANAGER (fresh database), not a MANAGER default grant, not a STAFF code', () => {
    expect(MANAGER_EXCLUDED).toContain('refunds:payout');
    expect(MANAGER_DEFAULT_GRANTS).not.toContain('refunds:payout');
    expect(STAFF_CODES).not.toContain('refunds:payout');
  });
  it('payout routes accept payments:manage OR refunds:payout (nothing else)', () => {
    expect([...REFUND_PAYOUT_PERMISSIONS].sort()).toEqual(['payments:manage', 'refunds:payout']);
  });
});

// ---------------------------------------------------------------- route matrix (real PermissionGuard)
function guardFor(codes: string[]) {
  const prisma: any = {
    adminUserRole: { findMany: jest.fn().mockResolvedValue([{ role: { permissions: codes.map((code) => ({ permission: { code } })) } }]) },
    adminActivityLog: { create: jest.fn() },
  };
  return new PermissionGuard(new Reflector(), prisma);
}
function ctx(controller: any, handler: string, user: any) {
  const fn = controller.prototype[handler];
  if (typeof fn !== 'function') throw new Error(`${controller.name}.${handler} does not exist`);
  return {
    getHandler: () => fn,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user, method: 'PATCH', originalUrl: `/${handler}`, params: {} }) }),
  } as any;
}
async function allowed(codes: string[], controller: any, handler: string, user: any = { id: 'cashier', isAdmin: true, role: 'STAFF', tenantId: T }) {
  try {
    return await guardFor(codes).canActivate(ctx(controller, handler, user));
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

const PAYOUT_ONLY = ['refunds:payout'];
const ALLOWED: Array<[any, string]> = [
  [RefundRequestsController, 'list'],
  [RefundRequestsController, 'get'],
  [RefundRequestsController, 'pay'],
  [RefundRequestsController, 'fail'],
  [RentalMoneyController, 'list'],
  [RentalMoneyController, 'pay'],
  [RentalMoneyController, 'fail'],
];
const FORBIDDEN: Array<[any, string, string]> = [
  [RefundRequestsController, 'approve', 'approve a refund'],
  [RefundRequestsController, 'reject', 'reject a refund'],
  [RefundRequestsController, 'retry', 'retry = create a NEW request'],
  [RentalMoneyController, 'createRequest', 'request a rental refund'],
  [RentalMoneyController, 'approve', 'approve a rental refund'],
  [RentalMoneyController, 'reject', 'reject a rental refund'],
  [RentalMoneyController, 'ledger', 'read the rental ledger'],
  [RentalMoneyController, 'requestLateFeeWaiver', 'request a late-fee waiver'],
  [RentalMoneyController, 'approveLateFeeWaiver', 'approve a late-fee waiver'],
  [PaymentsController, 'create', 'POST /payments (manual payment record)'],
  [PaymentsController, 'updateStatus', 'PATCH /payments/:id (mark paid etc.)'],
  [PaymentMethodsController, 'create', 'add a payment method'],
  [PaymentMethodsController, 'update', 'change payment-method / gateway settings'],
  [PaymentMethodsController, 'toggleActive', 'switch a payment method on/off'],
  [PaymentMethodsController, 'findAllAdmin', 'read gateway configuration'],
  [PosController, 'reversePayment', 'reverse a POS payment'],
  [PosController, 'refundSale', 'request a POS refund'],
  [PosController, 'createExchange', 'POS exchange'],
  [PosController, 'cancelLayaway', 'cancel a layaway'],
  [OrderRefundsController, 'createRefund', 'request an order refund'],
];

describe('route matrix for a holder of ONLY refunds:payout', () => {
  it.each(ALLOWED.map(([c, h]) => [`${c.name}.${h}`, c, h]))('%s → allowed', async (_n, c, h) => {
    expect(await allowed(PAYOUT_ONLY, c, h)).toBe(true);
  });
  it.each(FORBIDDEN.map(([c, h, what]) => [`${c.name}.${h} (${what})`, c, h]))('%s → 403', async (_n, c, h) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, (c as any).prototype[h as string])?.length).toBeGreaterThan(0);
    expect(await allowed(PAYOUT_ONLY, c, h)).toBe(false);
  });
  it('payments:manage keeps the same payout routes (backward compatibility)', async () => {
    for (const [c, h] of ALLOWED) expect(await allowed(['payments:manage'], c, h)).toBe(true);
  });
  it('SUPER_ADMIN is unchanged: passes the route guard without any grant (the service separation rules still apply, below)', async () => {
    for (const [c, h] of ALLOWED) expect(await allowed([], c, h, { id: 'owner', isAdmin: true, role: 'SUPER_ADMIN', tenantId: T })).toBe(true);
  });
  it('an admin with neither code cannot pay or fail (403)', async () => {
    for (const h of ['pay', 'fail']) {
      expect(await allowed(['refunds:approve', 'pos:refund', 'orders:refund'], RefundRequestsController, h)).toBe(false);
      expect(await allowed(['refunds:approve', 'rentals:refund-request'], RentalMoneyController, h)).toBe(false);
    }
  });
});

describe('shape: refunds:payout appears on no other route in the API', () => {
  function controllers(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return controllers(p);
      return e.name.endsWith('.controller.ts') ? [p] : [];
    });
  }
  it('only the two refund controllers reference it, and only on pay / fail / list / get', () => {
    const root = path.join(__dirname, '..');
    const users = controllers(root).filter((f) => /refunds:payout|REFUND_PAYOUT_PERMISSIONS/.test(fs.readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(root, f).replace(/\\/g, '/')).sort()).toEqual(['refunds/refund-requests.controller.ts', 'rentals/rental-money.controller.ts']);
    // Every handler whose metadata includes refunds:payout is in ALLOWED.
    for (const c of [RefundRequestsController, RentalMoneyController]) {
      for (const h of Object.getOwnPropertyNames(c.prototype)) {
        if (h === 'constructor') continue;
        const req: string[] = Reflect.getMetadata(PERMISSIONS_KEY, (c.prototype as any)[h]) ?? [];
        if (req.includes('refunds:payout')) expect(ALLOWED.some(([cc, hh]) => cc === c && hh === h)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- service rules apply to the payer, whatever their permission
const audit = () => ({ log: jest.fn() });

describe('unified payout (/refund-requests): separation binds a refunds:payout holder', () => {
  function make(req: any) {
    const prisma: any = {
      refundRequest: { findFirst: jest.fn().mockResolvedValue(req), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      payment: { findMany: jest.fn().mockResolvedValue([{ method: 'CASH' }]) },
      posSession: { findFirst: jest.fn().mockResolvedValue({ id: 'shift-cashier' }) },
      layaway: { updateMany: jest.fn() },
      order: { updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const a = audit();
    const orderRefunds = { executeRefund: jest.fn().mockResolvedValue({ refund: { id: 'pay-1' } }) };
    const pos = { executeSaleRefund: jest.fn().mockResolvedValue({ paymentId: 'pay-2', refundAmount: 1000 }) };
    const s = new RefundRequestsService(prisma, { requireId: T } as any, a as any, orderRefunds as any, pos as any, {} as any);
    return { s, prisma, audit: a, orderRefunds };
  }
  // Staff-requested order refund: cashier requested, manager approved.
  const order = { id: 'r1', tenantId: T, subject: 'ORDER', kind: 'ORDER_REFUND', orderId: 'o1', layawayId: null, amount: 1000, reason: 'damaged', status: 'APPROVED', requestedById: 'cashier', approvedById: 'manager' };

  it('the requester (cashier) cannot pay their own request → 403 PAYOUT_BY_REQUESTER, nothing claimed', async () => {
    const { s, prisma } = make(order);
    const e: any = await s.pay('r1', { method: 'CASH' }, { id: 'cashier' }).catch((x) => x);
    expect(e.getResponse().code).toBe('PAYOUT_BY_REQUESTER');
    expect(prisma.refundRequest.updateMany).not.toHaveBeenCalled();
  });
  it('the approver cannot pay → 403 PAYOUT_BY_APPROVER, nothing claimed', async () => {
    const { s, prisma } = make(order);
    const e: any = await s.pay('r1', { method: 'CASH' }, { id: 'manager' }).catch((x) => x);
    expect(e.getResponse().code).toBe('PAYOUT_BY_APPROVER');
    expect(prisma.refundRequest.updateMany).not.toHaveBeenCalled();
  });
  it('a third person pays; the claim is tenant-scoped compare-and-swap from APPROVED', async () => {
    const { s, prisma, orderRefunds } = make(order);
    await s.pay('r1', { method: 'CASH' }, { id: 'owner' });
    expect(prisma.refundRequest.updateMany.mock.calls[0][0]).toEqual({ where: { id: 'r1', tenantId: T, status: 'APPROVED' }, data: { status: 'PAYING' } });
    expect(orderRefunds.executeRefund).toHaveBeenCalledTimes(1);
  });
  it('not yet approved (REQUESTED) → 409, nothing claimed', async () => {
    const { s, prisma } = make({ ...order, status: 'REQUESTED', approvedById: null });
    expect(await s.pay('r1', { method: 'CASH' }, { id: 'owner' }).catch((x) => x)).toBeInstanceOf(ConflictException);
    expect(prisma.refundRequest.updateMany).not.toHaveBeenCalled();
  });
  it('a double payout: the second claim finds nothing APPROVED → 409, executed once', async () => {
    const { s, prisma, orderRefunds } = make(order);
    prisma.refundRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await s.pay('r1', { method: 'CASH' }, { id: 'owner' }).catch((x) => x)).toBeInstanceOf(ConflictException);
    expect(orderRefunds.executeRefund).not.toHaveBeenCalled();
  });
  it('mobile money without a reference → 400 PAYOUT_INVALID (amount/method rules unchanged)', async () => {
    const { s } = make(order);
    const e: any = await s.pay('r1', { method: 'MOBILE_MONEY' }, { id: 'owner' }).catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.getResponse().code).toBe('PAYOUT_INVALID');
  });
  it('another shop\'s request → 404 (lookup is tenant-scoped)', async () => {
    const { s, prisma } = make(null);
    expect(await s.pay('r-other', { method: 'CASH' }, { id: 'owner' }).catch((x) => x)).toBeInstanceOf(NotFoundException);
    expect(prisma.refundRequest.findFirst.mock.calls[0][0].where).toEqual({ id: 'r-other', tenantId: T });
    expect(await s.fail('r-other', { reason: 'x' }, { id: 'owner' }).catch((x) => x)).toBeInstanceOf(NotFoundException);
  });
  it('a system-raised request (SYSTEM:*) needs only approver ≠ payer', async () => {
    const sys = { ...order, requestedById: 'SYSTEM:LATE_PAYMENT', approvedById: 'manager' };
    expect((await make(sys).s.pay('r1', { method: 'CASH' }, { id: 'manager' }).catch((x) => x)).getResponse().code).toBe('PAYOUT_BY_APPROVER');
    await expect(make(sys).s.pay('r1', { method: 'CASH' }, { id: 'cashier' })).resolves.toBeDefined();
  });
});

describe('rental payout (/rental-money): separation binds a refunds:payout holder', () => {
  function money(request: any, deciders: string[] = [], session: any = { id: 'shift-cashier' }) {
    const svc: any = Object.create(RentalMoneyService.prototype);
    svc.tenantContext = { requireId: T };
    svc.audit = audit();
    svc.prisma = {
      posSession: { findFirst: jest.fn().mockResolvedValue(session) },
      rentalDiscrepancy: { findMany: jest.fn().mockResolvedValue(deciders.map((resolvedById) => ({ resolvedById }))) },
      $transaction: jest.fn().mockResolvedValue(null),
    };
    svc.loadRequest = jest.fn().mockResolvedValue(request);
    return svc;
  }
  // Deposit return keeping 50,000: manager decided the deduction AND requested; owner approved.
  const deposit = {
    id: 'dr1', tenantId: T, rentalOrderId: 'r1', subject: 'RENTAL', kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', status: 'APPROVED',
    amount: 150000, retainedAmount: 50000, requestedById: 'manager', approvedById: 'owner',
  };

  it('the cashier (refunds:payout) is the payer left: passes every separation check and pays from their own shift', async () => {
    const svc = money(deposit, ['manager']);
    await svc.pay('dr1', { method: 'CASH', sessionId: 'shift-cashier' }, { id: 'cashier' });
    expect(svc.prisma.posSession.findFirst.mock.calls[0][0].where).toEqual({ id: 'shift-cashier', tenantId: T, adminUserId: 'cashier', status: 'OPEN' });
    expect(svc.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('the deduction decider can never pay it, even with a payout permission → 403 (requester / decider)', async () => {
    const e: any = await money(deposit, ['manager']).pay('dr1', { method: 'CASH', sessionId: 's' }, { id: 'manager' }).catch((x: any) => x);
    expect(e.getResponse().code).toBe('PAYOUT_BY_REQUESTER');
    // decider who did NOT request (someone else requested): still refused, as DEDUCTION_DECIDER
    const other = { ...deposit, requestedById: 'cashier2' };
    const d: any = await money(other, ['manager']).pay('dr1', { method: 'CASH', sessionId: 's' }, { id: 'manager' }).catch((x: any) => x);
    expect(d.getResponse().code).toBe('DEDUCTION_DECIDER');
  });
  it('the approver (owner, SUPER_ADMIN or not) cannot pay → 403 PAYOUT_BY_APPROVER', async () => {
    const e: any = await money(deposit, ['manager']).pay('dr1', { method: 'CASH', sessionId: 's' }, { id: 'owner' }).catch((x: any) => x);
    expect(e.getResponse().code).toBe('PAYOUT_BY_APPROVER');
  });
  it('cash needs the PAYER\'s own open shift → 400 before any money moves', async () => {
    const svc = money(deposit, ['manager'], null);
    expect(await svc.pay('dr1', { method: 'CASH', sessionId: 'someone-elses-shift' }, { id: 'cashier' }).catch((x: any) => x)).toBeInstanceOf(BadRequestException);
    expect(svc.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('mobile money without a reference → 400', async () => {
    const svc = money(deposit, ['manager']);
    expect(await svc.pay('dr1', { method: 'MOBILE_MONEY' }, { id: 'cashier' }).catch((x: any) => x)).toBeInstanceOf(BadRequestException);
  });
});

describe('database backstop is about people, not permissions', () => {
  it('naro_r3_refund_separation compares paidById / approvedById / requestedById / resolvedById only (no permission lookup)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'packages', 'database', 'prisma', 'migrations', '20261117120000_refund_separation', 'migration.sql'), 'utf8');
    expect(sql).toMatch(/"paidById" = NEW\."requestedById" OR NEW\."paidById" = NEW\."approvedById"/);
    expect(sql).not.toMatch(/Permission|payments:manage|refunds:payout/);
  });
});
