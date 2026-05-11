import { AuditService } from './audit.service';

/**
 * AuditService — identity attribution regression coverage (2026-05-11).
 *
 * Background: AuditService.log() previously read req.user?.sub to derive
 * adminUserId. JwtStrategy.validate() returns the resolved AdminUser/User
 * row which exposes `id`, not `sub` — so `req.user.sub` was always
 * undefined and EVERY row in AdminActivityLog across all 29 log points
 * had `adminUserId: null`. The entire admin audit trail was anonymous.
 *
 * Fix: read `req.user?.id`. These tests pin the attribution behaviour
 * (populated when authenticated, skipped when not).
 */
describe('AuditService — adminUserId attribution', () => {
  function makeService(opts: {
    user?: { id?: string } | null;
    tenantId?: string;
    prismaCreate?: jest.Mock;
  }) {
    const request: any = {
      user: opts.user === undefined ? { id: 'admin-1' } : opts.user,
      ip: '203.0.113.7',
      headers: {},
    };
    const prisma: any = {
      adminActivityLog: {
        create: opts.prismaCreate ?? jest.fn().mockResolvedValue({}),
      },
    };
    const tenantContext: any = { id: opts.tenantId ?? 'tenant-1' };
    return {
      service: new AuditService(request, prisma, tenantContext),
      prisma,
      request,
    };
  }

  it('populates AdminActivityLog.adminUserId from req.user.id when authenticated', async () => {
    const { service, prisma } = makeService({ user: { id: 'admin-42' } });
    await service.log('CREATE', 'Product', 'prod-1', { name: 'Test' });
    expect(prisma.adminActivityLog.create).toHaveBeenCalledTimes(1);
    const call = prisma.adminActivityLog.create.mock.calls[0][0];
    expect(call.data.adminUserId).toBe('admin-42');
    expect(call.data.tenantId).toBe('tenant-1');
    expect(call.data.action).toBe('CREATE');
    expect(call.data.entity).toBe('Product');
    expect(call.data.entityId).toBe('prod-1');
    expect(call.data.details).toEqual({ name: 'Test' });
  });

  it('does NOT fall back to req.user.sub (the bug we are fixing — defence in depth)', async () => {
    // If a stray code path ever sets req.user.sub instead of req.user.id,
    // the log call MUST treat it as anonymous and skip. We never want the
    // pre-fix bug to silently revive.
    const { service, prisma } = makeService({ user: { sub: 'old-jwt-payload' } as any });
    await service.log('CREATE', 'Product');
    expect(prisma.adminActivityLog.create).not.toHaveBeenCalled();
  });

  it('skips the write when no user is on the request (system / customer flows)', async () => {
    const { service, prisma } = makeService({ user: null });
    await service.log('CREATE', 'Order', 'order-1');
    expect(prisma.adminActivityLog.create).not.toHaveBeenCalled();
  });

  it('skips the write when user is present but has no id (defensive)', async () => {
    const { service, prisma } = makeService({ user: {} });
    await service.log('UPDATE', 'Product', 'prod-1');
    expect(prisma.adminActivityLog.create).not.toHaveBeenCalled();
  });

  it('overrideAdminUserId takes precedence over req.user.id', async () => {
    const { service, prisma } = makeService({ user: { id: 'admin-from-jwt' } });
    await service.log('CREATE', 'Product', 'prod-1', undefined, 'admin-override');
    const call = prisma.adminActivityLog.create.mock.calls[0][0];
    expect(call.data.adminUserId).toBe('admin-override');
  });

  it('does not throw when Prisma rejects — audit must never break the main flow', async () => {
    const prismaCreate = jest.fn().mockRejectedValue(new Error('DB down'));
    const { service } = makeService({ user: { id: 'admin-1' }, prismaCreate });
    await expect(service.log('CREATE', 'X')).resolves.toBeUndefined();
  });
});
