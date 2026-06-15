import { AiSuperAdminDemotionService } from './ai-super-admin-demotion.service';
import {
  AI_AGENT_ROLE_NAMES,
  AI_PERMISSION_CODES,
} from '../types/ai-permissions.types';

/**
 * AiSuperAdminDemotionService — Phase 3.2.
 *
 * Removes `ai-agent:approve` from every SUPER_ADMIN role at boot. Should be
 * idempotent, must not touch AI_AGENT_APPROVER's :approve grant, must not
 * touch SUPER_ADMIN's other AI permissions, and must surface a WARN when
 * no admin holds AI_AGENT_APPROVER (without blocking).
 *
 * All tests use a mocked Prisma client — no DB, no Nest boot.
 */

describe('AiSuperAdminDemotionService — Phase 3.2', () => {
  /**
   * Mock factory. `superAdmins` and `approverAdmins` shape the world the
   * service sees; the test inspects the deleteMany call to assert effect.
   */
  function buildPrismaMock(opts: {
    /** Set null to simulate Phase 3.0 not seeded yet (no :approve permission). */
    approvePermissionExists?: boolean;
    superAdmins?: Array<{ id: string; tenantId: string | null }>;
    /** Number of distinct admin users assigned AI_AGENT_APPROVER. */
    approverAdminCount?: number;
    /** Whether AI_AGENT_APPROVER role exists at all. */
    approverRoleExists?: boolean;
  }) {
    const approvePermissionExists = opts.approvePermissionExists ?? true;
    const superAdmins = opts.superAdmins ?? [
      { id: 'role_super_admin_global', tenantId: null },
    ];
    const approverRoleExists = opts.approverRoleExists ?? true;
    const approverAdminCount = opts.approverAdminCount ?? 1;

    const deleteManyCalls: any[] = [];

    const prismaMock = {
      permission: {
        findUnique: jest.fn(({ where }: any) => {
          if (
            where.code === AI_PERMISSION_CODES.APPROVE &&
            approvePermissionExists
          ) {
            return Promise.resolve({ id: 'perm_approve' });
          }
          return Promise.resolve(null);
        }),
      },
      role: {
        findMany: jest.fn(({ where }: any) => {
          if (where.name === 'SUPER_ADMIN' && where.isSystem === true) {
            return Promise.resolve(superAdmins);
          }
          if (
            where.name === AI_AGENT_ROLE_NAMES.APPROVER &&
            where.isSystem === true
          ) {
            return Promise.resolve(
              approverRoleExists ? [{ id: 'role_approver' }] : [],
            );
          }
          return Promise.resolve([]);
        }),
      },
      adminUserRole: {
        findMany: jest.fn(() => {
          return Promise.resolve(
            Array.from({ length: approverAdminCount }, (_, i) => ({
              adminUserId: `admin_${i}`,
            })),
          );
        }),
      },
      rolePermission: {
        deleteMany: jest.fn((args: any) => {
          deleteManyCalls.push(args);
          // Simulate a successful delete returning count = N when there's
          // something to delete on the first call; subsequent calls (same
          // service instance re-run) would return 0 — but each test
          // exercises a single run, so we return rows × superAdmins as if
          // all were present pre-demotion.
          return Promise.resolve({ count: superAdmins.length });
        }),
      },
    };

    return { prismaMock, deleteManyCalls };
  }

  it('revokes :approve from every SUPER_ADMIN role (global + tenant-scoped)', async () => {
    const { prismaMock, deleteManyCalls } = buildPrismaMock({
      superAdmins: [
        { id: 'role_super_global', tenantId: null },
        { id: 'role_super_t1', tenantId: 'tenant_1' },
        { id: 'role_super_t2', tenantId: 'tenant_2' },
      ],
    });

    const service = new AiSuperAdminDemotionService(prismaMock as any);
    await service.onApplicationBootstrap();

    expect(deleteManyCalls).toHaveLength(1);
    const call = deleteManyCalls[0];
    expect(call.where.permissionId).toBe('perm_approve');
    // All three SUPER_ADMIN role ids should be in the IN clause
    expect(call.where.roleId.in).toEqual([
      'role_super_global',
      'role_super_t1',
      'role_super_t2',
    ]);
  });

  it('is idempotent — second run on already-demoted state issues a deleteMany that affects zero rows', async () => {
    const { prismaMock, deleteManyCalls } = buildPrismaMock({
      superAdmins: [{ id: 'role_super', tenantId: null }],
    });
    // Override the deleteMany to return count=0 (rows already gone)
    prismaMock.rolePermission.deleteMany = jest.fn((args: any) => {
      deleteManyCalls.push(args);
      return Promise.resolve({ count: 0 });
    });

    const service = new AiSuperAdminDemotionService(prismaMock as any);
    await service.onApplicationBootstrap();

    // The call still happened (the service has no completion flag) but
    // affected zero rows — which is the steady state after first demotion.
    expect(deleteManyCalls).toHaveLength(1);
  });

  it('does NOT include AI_AGENT_APPROVER role id in the deletion target', async () => {
    const { prismaMock, deleteManyCalls } = buildPrismaMock({
      superAdmins: [{ id: 'role_super_admin', tenantId: null }],
    });

    const service = new AiSuperAdminDemotionService(prismaMock as any);
    await service.onApplicationBootstrap();

    const targetRoleIds: string[] = deleteManyCalls[0].where.roleId.in;
    expect(targetRoleIds).not.toContain('role_approver');
  });

  it('does NOT touch SUPER_ADMIN’s :use, :read, or :write-drafts grants', async () => {
    const { prismaMock, deleteManyCalls } = buildPrismaMock({});

    const service = new AiSuperAdminDemotionService(prismaMock as any);
    await service.onApplicationBootstrap();

    // The where-clause restricts permissionId to :approve only.
    expect(deleteManyCalls[0].where.permissionId).toBe('perm_approve');
    // No other deleteMany calls should fire (defence-in-depth).
    expect(prismaMock.rolePermission.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('proceeds with demotion when no admin holds AI_AGENT_APPROVER (intentional friction per Decision Log #2)', async () => {
    const warnSpy = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { prismaMock, deleteManyCalls } = buildPrismaMock({
      approverAdminCount: 0,
    });

    const service = new AiSuperAdminDemotionService(prismaMock as any);
    await service.onApplicationBootstrap();

    // Demotion still happens
    expect(deleteManyCalls).toHaveLength(1);
    // But a WARN is logged with the no-approver message
    const warnMessages = warnSpy.mock.calls.map((c) => c[0]).join(' | ');
    expect(warnMessages).toMatch(/NO admin currently holds AI_AGENT_APPROVER/);

    warnSpy.mockRestore();
  });

  it('quietly returns when the :approve permission does not exist yet (Phase 3.0 not seeded)', async () => {
    const { prismaMock, deleteManyCalls } = buildPrismaMock({
      approvePermissionExists: false,
    });

    const service = new AiSuperAdminDemotionService(prismaMock as any);
    await service.onApplicationBootstrap();

    expect(deleteManyCalls).toHaveLength(0);
    expect(prismaMock.role.findMany).not.toHaveBeenCalled();
  });

  it('skips the whole demotion when AI_PHASE_3_2_DEMOTION_ENABLED=false', async () => {
    const original = process.env.AI_PHASE_3_2_DEMOTION_ENABLED;
    process.env.AI_PHASE_3_2_DEMOTION_ENABLED = 'false';

    const { prismaMock, deleteManyCalls } = buildPrismaMock({});

    const service = new AiSuperAdminDemotionService(prismaMock as any);
    await service.onApplicationBootstrap();

    expect(deleteManyCalls).toHaveLength(0);
    expect(prismaMock.permission.findUnique).not.toHaveBeenCalled();

    process.env.AI_PHASE_3_2_DEMOTION_ENABLED = original;
  });

  it('does not throw when Prisma errors mid-run — boot must never fail because of this service', async () => {
    const { prismaMock } = buildPrismaMock({});
    prismaMock.rolePermission.deleteMany = jest.fn((_args: any) =>
      Promise.reject(new Error('simulated DB outage')),
    );
    const errorSpy = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const service = new AiSuperAdminDemotionService(prismaMock as any);
    // Must resolve without throwing
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
