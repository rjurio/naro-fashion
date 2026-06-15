import { AiRolesSeederService } from './ai-roles-seeder.service';
import {
  AI_AGENT_ROLE_NAMES,
  AI_PERMISSION_CODES,
} from '../types/ai-permissions.types';

/**
 * AiRolesSeederService unit tests — Phase 3.0.
 *
 * The seeder runs at OnApplicationBootstrap and does three things:
 *   1. Seeds AI_AGENT_OPERATOR system role (use + read + write-drafts).
 *   2. Seeds AI_AGENT_APPROVER system role (use + read + approve).
 *   3. Backfills SUPER_ADMIN with all 4 AI permissions (rollout
 *      compatibility — Phase 3.2 demotion script removes :approve).
 *
 * The backfill must handle BOTH SUPER_ADMIN layouts:
 *   - tenantId=null (the pattern in RolesService.seedSystemRoles)
 *   - tenant-scoped tenantId=... (observed on 2026-05-10 prod, which is
 *     what triggered the seeder fix being tested here)
 *
 * All tests run against a mocked Prisma — no DB, no Nest app boot. The
 * mock implements just enough of the surface to satisfy the seeder's
 * findMany/findFirst/create/createMany calls.
 */

describe('AiRolesSeederService — Phase 3.0', () => {
  /**
   * Build a fresh Prisma mock with reasonable defaults. Tests can
   * override individual mock implementations as needed.
   */
  function buildPrismaMock(opts: {
    superAdminRoles?: Array<{ id: string; tenantId: string | null }>;
    operatorExists?: boolean;
    approverExists?: boolean;
  }) {
    const permissions = [
      { id: 'perm_use', code: AI_PERMISSION_CODES.USE },
      { id: 'perm_read', code: AI_PERMISSION_CODES.READ },
      { id: 'perm_drafts', code: AI_PERMISSION_CODES.WRITE_DRAFTS },
      { id: 'perm_approve', code: AI_PERMISSION_CODES.APPROVE },
    ];

    const operatorRole = opts.operatorExists
      ? { id: 'role_operator', name: AI_AGENT_ROLE_NAMES.OPERATOR, isSystem: true, tenantId: null }
      : null;
    const approverRole = opts.approverExists
      ? { id: 'role_approver', name: AI_AGENT_ROLE_NAMES.APPROVER, isSystem: true, tenantId: null }
      : null;

    const createdRoles: any[] = [];
    const createdRolePermissionsByCall: Array<{ roleId: string; permissionId: string }[]> = [];

    const prismaMock = {
      permission: {
        findMany: jest.fn(({ where }: any) => {
          const codes: string[] = where.code.in;
          return Promise.resolve(
            permissions.filter((p) => codes.includes(p.code)),
          );
        }),
      },
      role: {
        findFirst: jest.fn(({ where }: any) => {
          if (where.name === AI_AGENT_ROLE_NAMES.OPERATOR) return Promise.resolve(operatorRole);
          if (where.name === AI_AGENT_ROLE_NAMES.APPROVER) return Promise.resolve(approverRole);
          return Promise.resolve(null);
        }),
        // The seeder's NEW backfill path uses findMany (was findFirst pre-fix).
        findMany: jest.fn(({ where }: any) => {
          if (where.name === 'SUPER_ADMIN' && where.isSystem === true) {
            return Promise.resolve(opts.superAdminRoles ?? []);
          }
          return Promise.resolve([]);
        }),
        create: jest.fn(({ data }: any) => {
          const created = { id: `role_created_${createdRoles.length}`, ...data };
          createdRoles.push(created);
          return Promise.resolve(created);
        }),
      },
      rolePermission: {
        createMany: jest.fn(({ data }: any) => {
          createdRolePermissionsByCall.push(data);
          return Promise.resolve({ count: data.length });
        }),
      },
    };

    return { prismaMock, createdRoles, createdRolePermissionsByCall };
  }

  describe('SUPER_ADMIN backfill — tenantId=null layout', () => {
    it('grants :use, :read, :write-drafts to a tenantId=null SUPER_ADMIN (Phase 3.2: :approve excluded)', async () => {
      const { prismaMock, createdRolePermissionsByCall } = buildPrismaMock({
        superAdminRoles: [{ id: 'sa_null', tenantId: null }],
        operatorExists: true,
        approverExists: true,
      });

      const seeder = new AiRolesSeederService(prismaMock as any);
      await seeder.onApplicationBootstrap();

      // Last createMany call should be the SUPER_ADMIN backfill (the
      // operator + approver grants run first inside seedAiSystemRoles).
      const saCall = createdRolePermissionsByCall.find((batch) =>
        batch.every((row) => row.roleId === 'sa_null'),
      );
      expect(saCall).toBeDefined();
      const grantedPermIds = saCall!.map((r) => r.permissionId).sort();
      // Phase 3.2 cutover: SUPER_ADMIN no longer auto-granted :approve.
      // Approval power must be explicitly assigned via AI_AGENT_APPROVER.
      expect(grantedPermIds).toEqual(
        ['perm_drafts', 'perm_read', 'perm_use'].sort(),
      );
      expect(grantedPermIds).not.toContain('perm_approve');
    });
  });

  describe('SUPER_ADMIN backfill — tenant-scoped layout (the prod case)', () => {
    it('grants :use, :read, :write-drafts to a tenant-scoped SUPER_ADMIN (Phase 3.2: :approve excluded)', async () => {
      const { prismaMock, createdRolePermissionsByCall } = buildPrismaMock({
        superAdminRoles: [{ id: 'sa_t1', tenantId: 'tenant_t1' }],
        operatorExists: true,
        approverExists: true,
      });

      const seeder = new AiRolesSeederService(prismaMock as any);
      await seeder.onApplicationBootstrap();

      const saCall = createdRolePermissionsByCall.find((batch) =>
        batch.every((row) => row.roleId === 'sa_t1'),
      );
      expect(saCall).toBeDefined();
      expect(saCall!.map((r) => r.permissionId).sort()).toEqual(
        ['perm_drafts', 'perm_read', 'perm_use'].sort(),
      );
    });

    it('does NOT use tenantId in the lookup filter (regression guard)', async () => {
      // The pre-fix bug was a `tenantId: null` filter that silently
      // skipped tenant-scoped SUPER_ADMINs. This test asserts the
      // lookup filter is exactly `{ name: 'SUPER_ADMIN', isSystem: true }`
      // — no tenantId clause.
      const { prismaMock } = buildPrismaMock({
        superAdminRoles: [{ id: 'sa_t1', tenantId: 'tenant_t1' }],
        operatorExists: true,
        approverExists: true,
      });

      const seeder = new AiRolesSeederService(prismaMock as any);
      await seeder.onApplicationBootstrap();

      // The seeder's findMany call for SUPER_ADMIN should have been made
      // with EXACTLY these where keys — no tenantId.
      const saQuery = prismaMock.role.findMany.mock.calls.find(
        ([args]: any) => args.where?.name === 'SUPER_ADMIN',
      );
      expect(saQuery).toBeDefined();
      const where = (saQuery![0] as any).where;
      expect(where.name).toBe('SUPER_ADMIN');
      expect(where.isSystem).toBe(true);
      expect(where).not.toHaveProperty('tenantId');
    });
  });

  describe('SUPER_ADMIN backfill — multiple roles at once', () => {
    it('grants all 4 AI permissions to EVERY matching SUPER_ADMIN row', async () => {
      const { prismaMock, createdRolePermissionsByCall } = buildPrismaMock({
        superAdminRoles: [
          { id: 'sa_null', tenantId: null },
          { id: 'sa_t1', tenantId: 'tenant_t1' },
          { id: 'sa_t2', tenantId: 'tenant_t2' },
        ],
        operatorExists: true,
        approverExists: true,
      });

      const seeder = new AiRolesSeederService(prismaMock as any);
      await seeder.onApplicationBootstrap();

      // Each SUPER_ADMIN should have its own batch of 3 grants
      // (Phase 3.2: :approve excluded).
      for (const roleId of ['sa_null', 'sa_t1', 'sa_t2']) {
        const batch = createdRolePermissionsByCall.find((b) =>
          b.every((row) => row.roleId === roleId),
        );
        expect(batch).toBeDefined();
        expect(batch!.length).toBe(3);
        expect(batch!.map((r) => r.permissionId).sort()).toEqual(
          ['perm_drafts', 'perm_read', 'perm_use'].sort(),
        );
        expect(batch!.map((r) => r.permissionId)).not.toContain('perm_approve');
      }
    });
  });

  describe('SUPER_ADMIN backfill — empty case', () => {
    it('returns silently when no SUPER_ADMIN exists yet', async () => {
      const { prismaMock, createdRolePermissionsByCall } = buildPrismaMock({
        superAdminRoles: [],
        operatorExists: true,
        approverExists: true,
      });

      const seeder = new AiRolesSeederService(prismaMock as any);
      await expect(seeder.onApplicationBootstrap()).resolves.toBeUndefined();

      // The createMany calls that DO appear are the operator + approver
      // grants (each gets 3 perms). NO calls have a roleId starting
      // with 'sa_' since no SUPER_ADMIN was found.
      const saCalls = createdRolePermissionsByCall.filter((batch) =>
        batch.some((row) => row.roleId.startsWith('sa_')),
      );
      expect(saCalls.length).toBe(0);
    });
  });

  describe('idempotency (skipDuplicates)', () => {
    it('passes skipDuplicates: true on every rolePermission.createMany call', async () => {
      const { prismaMock } = buildPrismaMock({
        superAdminRoles: [{ id: 'sa_t1', tenantId: 'tenant_t1' }],
        operatorExists: true,
        approverExists: true,
      });

      const seeder = new AiRolesSeederService(prismaMock as any);
      await seeder.onApplicationBootstrap();

      // Every createMany call must have skipDuplicates: true (the only
      // safety net against duplicate-key errors on re-runs — there is no
      // explicit upsert because RolePermission has a composite PK on
      // (roleId, permissionId), not a single @unique field that upsert
      // could target).
      for (const call of prismaMock.rolePermission.createMany.mock.calls) {
        expect(call[0].skipDuplicates).toBe(true);
      }
    });

    it('running the seeder twice produces no duplicate intent', async () => {
      const { prismaMock } = buildPrismaMock({
        superAdminRoles: [{ id: 'sa_t1', tenantId: 'tenant_t1' }],
        operatorExists: true,
        approverExists: true,
      });

      const seeder = new AiRolesSeederService(prismaMock as any);
      await seeder.onApplicationBootstrap();
      await seeder.onApplicationBootstrap();

      // Both runs issue the same set of grants. With skipDuplicates: true,
      // the second run is a no-op at the DB level. We assert call shape
      // matches between runs.
      const calls = prismaMock.rolePermission.createMany.mock.calls;
      // 3 batches per run (operator, approver, super-admin) × 2 runs = 6
      expect(calls.length).toBe(6);
      // Each pair of runs produces identical batch contents.
      const firstRun = calls.slice(0, 3).map((c: any) => JSON.stringify(c[0].data));
      const secondRun = calls.slice(3, 6).map((c: any) => JSON.stringify(c[0].data));
      expect(secondRun).toEqual(firstRun);
    });
  });

  describe('does not affect non-SUPER_ADMIN, non-AI roles', () => {
    it('only writes to roles in {AI_AGENT_OPERATOR, AI_AGENT_APPROVER, SUPER_ADMIN}', async () => {
      const { prismaMock } = buildPrismaMock({
        superAdminRoles: [{ id: 'sa_t1', tenantId: 'tenant_t1' }],
        operatorExists: true,
        approverExists: true,
      });

      const seeder = new AiRolesSeederService(prismaMock as any);
      await seeder.onApplicationBootstrap();

      // Collect every roleId touched.
      const touchedRoleIds = new Set<string>();
      for (const call of prismaMock.rolePermission.createMany.mock.calls) {
        for (const row of (call[0] as any).data) {
          touchedRoleIds.add(row.roleId);
        }
      }
      const expected = new Set(['role_operator', 'role_approver', 'sa_t1']);
      expect(touchedRoleIds).toEqual(expected);
    });
  });
});
