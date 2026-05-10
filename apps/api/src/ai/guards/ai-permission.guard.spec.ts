import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AiPermissionGuard } from './ai-permission.guard';
import { AI_PERMISSION_CODES } from '../types/ai-permissions.types';

/**
 * Phase 3.0 invariant tests for AiPermissionGuard.
 *
 * The guard enforces:
 *   - Authentication required (throw on missing user).
 *   - Platform admins bypass.
 *   - `ai-agent:use` always required.
 *   - When `@RequiresAiPermission(scope)` metadata is present on the
 *     handler/class, ALSO require that scope permission. Composition rule:
 *     `:use` alone is not enough on annotated routes.
 *   - When the metadata is ABSENT, only `:use` is required (back-compat for
 *     existing Phase 1/2 routes — Phase 3.0 ships with zero behaviour change
 *     for those endpoints).
 */

describe('AiPermissionGuard — Phase 3.0', () => {
  let prismaMock: any;
  let reflectorMock: Reflector;
  let guard: AiPermissionGuard;

  function ctxWithUser(user: any): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  }

  function setRouteRequiresScope(scope: string | undefined) {
    (reflectorMock.getAllAndOverride as jest.Mock).mockReturnValue(scope);
  }

  /**
   * Mirrors what AiPermissionGuard's Prisma query returns: the rows for
   * permissions the user actually has, intersected with the required set.
   */
  function userHasPerms(...codes: string[]) {
    prismaMock.permission.findMany.mockImplementation((args: any) => {
      const requested: string[] = args.where.code.in;
      const intersection = requested.filter((c) => codes.includes(c));
      return Promise.resolve(intersection.map((c) => ({ code: c })));
    });
  }

  beforeEach(() => {
    prismaMock = {
      permission: { findMany: jest.fn() },
    };
    reflectorMock = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    guard = new AiPermissionGuard(prismaMock, reflectorMock);
  });

  describe('preconditions', () => {
    it('rejects when no user is on the request', async () => {
      await expect(
        guard.canActivate(ctxWithUser(undefined)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.permission.findMany).not.toHaveBeenCalled();
    });

    it('platform admins bypass entirely (no DB lookup)', async () => {
      const ok = await guard.canActivate(
        ctxWithUser({ id: 'pa', isPlatformAdmin: true }),
      );
      expect(ok).toBe(true);
      expect(prismaMock.permission.findMany).not.toHaveBeenCalled();
    });

    it('rejects when admin user has no id field', async () => {
      await expect(
        guard.canActivate(ctxWithUser({ isAdmin: true })),
      ).rejects.toThrow(/admin account/);
    });
  });

  describe('back-compat: routes without @RequiresAiPermission', () => {
    it('allows when user has ai-agent:use', async () => {
      userHasPerms(AI_PERMISSION_CODES.USE);
      setRouteRequiresScope(undefined);
      const ok = await guard.canActivate(
        ctxWithUser({ id: 'admin1', isAdmin: true }),
      );
      expect(ok).toBe(true);
    });

    it('rejects when user does NOT have ai-agent:use', async () => {
      userHasPerms(); // no perms at all
      setRouteRequiresScope(undefined);
      await expect(
        guard.canActivate(ctxWithUser({ id: 'admin1', isAdmin: true })),
      ).rejects.toThrow(/ai-agent:use/);
    });
  });

  describe('Phase 3 composition rule: routes with @RequiresAiPermission', () => {
    it('rejects when user has ai-agent:use but route requires ai-agent:read', async () => {
      userHasPerms(AI_PERMISSION_CODES.USE);
      setRouteRequiresScope(AI_PERMISSION_CODES.READ);
      await expect(
        guard.canActivate(ctxWithUser({ id: 'admin1', isAdmin: true })),
      ).rejects.toThrow(/ai-agent:read/);
    });

    it('allows ai-agent:read when user has :use + :read', async () => {
      userHasPerms(AI_PERMISSION_CODES.USE, AI_PERMISSION_CODES.READ);
      setRouteRequiresScope(AI_PERMISSION_CODES.READ);
      const ok = await guard.canActivate(
        ctxWithUser({ id: 'admin1', isAdmin: true }),
      );
      expect(ok).toBe(true);
    });

    it('allows ai-agent:write-drafts when user has :use + :write-drafts', async () => {
      userHasPerms(
        AI_PERMISSION_CODES.USE,
        AI_PERMISSION_CODES.WRITE_DRAFTS,
      );
      setRouteRequiresScope(AI_PERMISSION_CODES.WRITE_DRAFTS);
      const ok = await guard.canActivate(
        ctxWithUser({ id: 'admin1', isAdmin: true }),
      );
      expect(ok).toBe(true);
    });

    it('allows ai-agent:approve when user has :use + :approve', async () => {
      userHasPerms(AI_PERMISSION_CODES.USE, AI_PERMISSION_CODES.APPROVE);
      setRouteRequiresScope(AI_PERMISSION_CODES.APPROVE);
      const ok = await guard.canActivate(
        ctxWithUser({ id: 'admin1', isAdmin: true }),
      );
      expect(ok).toBe(true);
    });
  });

  describe('operator vs approver permission separation', () => {
    // The two seeded system roles:
    //   AI_AGENT_OPERATOR  → use + read + write-drafts (NO approve)
    //   AI_AGENT_APPROVER  → use + read + approve     (NO write-drafts)
    // These tests assert the boundary holds at the guard layer.

    it('operator (use+read+write-drafts) is REJECTED on a route requiring :approve', async () => {
      userHasPerms(
        AI_PERMISSION_CODES.USE,
        AI_PERMISSION_CODES.READ,
        AI_PERMISSION_CODES.WRITE_DRAFTS,
      );
      setRouteRequiresScope(AI_PERMISSION_CODES.APPROVE);
      await expect(
        guard.canActivate(ctxWithUser({ id: 'op1', isAdmin: true })),
      ).rejects.toThrow(/ai-agent:approve/);
    });

    it('approver (use+read+approve) is REJECTED on a route requiring :write-drafts', async () => {
      userHasPerms(
        AI_PERMISSION_CODES.USE,
        AI_PERMISSION_CODES.READ,
        AI_PERMISSION_CODES.APPROVE,
      );
      setRouteRequiresScope(AI_PERMISSION_CODES.WRITE_DRAFTS);
      await expect(
        guard.canActivate(ctxWithUser({ id: 'rev1', isAdmin: true })),
      ).rejects.toThrow(/ai-agent:write-drafts/);
    });

    it('operator can call read + write-drafts routes', async () => {
      userHasPerms(
        AI_PERMISSION_CODES.USE,
        AI_PERMISSION_CODES.READ,
        AI_PERMISSION_CODES.WRITE_DRAFTS,
      );
      setRouteRequiresScope(AI_PERMISSION_CODES.READ);
      await expect(
        guard.canActivate(ctxWithUser({ id: 'op1', isAdmin: true })),
      ).resolves.toBe(true);
      setRouteRequiresScope(AI_PERMISSION_CODES.WRITE_DRAFTS);
      await expect(
        guard.canActivate(ctxWithUser({ id: 'op1', isAdmin: true })),
      ).resolves.toBe(true);
    });

    it('approver can call read + approve routes', async () => {
      userHasPerms(
        AI_PERMISSION_CODES.USE,
        AI_PERMISSION_CODES.READ,
        AI_PERMISSION_CODES.APPROVE,
      );
      setRouteRequiresScope(AI_PERMISSION_CODES.READ);
      await expect(
        guard.canActivate(ctxWithUser({ id: 'rev1', isAdmin: true })),
      ).resolves.toBe(true);
      setRouteRequiresScope(AI_PERMISSION_CODES.APPROVE);
      await expect(
        guard.canActivate(ctxWithUser({ id: 'rev1', isAdmin: true })),
      ).resolves.toBe(true);
    });

    it('user without ai-agent:approve cannot approve', async () => {
      // Same user as operator — explicit re-test of the spec requirement.
      userHasPerms(
        AI_PERMISSION_CODES.USE,
        AI_PERMISSION_CODES.READ,
        AI_PERMISSION_CODES.WRITE_DRAFTS,
      );
      setRouteRequiresScope(AI_PERMISSION_CODES.APPROVE);
      await expect(
        guard.canActivate(ctxWithUser({ id: 'op1', isAdmin: true })),
      ).rejects.toThrow(/ai-agent:approve/);
    });
  });

  describe('error message includes the missing permission code(s)', () => {
    it('lists every missing perm in the rejection message', async () => {
      userHasPerms(); // user has nothing — should miss BOTH :use and the scope
      setRouteRequiresScope(AI_PERMISSION_CODES.READ);
      try {
        await guard.canActivate(
          ctxWithUser({ id: 'nobody', isAdmin: true }),
        );
        throw new Error('expected rejection');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(err.message).toContain(AI_PERMISSION_CODES.USE);
        expect(err.message).toContain(AI_PERMISSION_CODES.READ);
      }
    });
  });
});
