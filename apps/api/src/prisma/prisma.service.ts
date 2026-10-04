import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantScopeExtension, tenantScopeMode } from '../tenant-scope/tenant-scope.guard';

/** Marks instances produced by PrismaService (the extended client isn't a real subclass instance). */
const PRISMA_SERVICE_BRAND = Symbol.for('naro.PrismaService');

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * Returns the client wrapped with the tenant-scope query extension
   * (`src/tenant-scope/`). Returning an object from a constructor makes
   * `new PrismaService()` — and therefore Nest's DI — yield that object, so
   * every injector transparently gets the guarded client with zero changes.
   * The extended client proxies through to this instance, so PrismaService's
   * own methods (onModuleInit/onModuleDestroy), `$transaction` (incl.
   * interactive `tx` clients, which inherit the extension), `$queryRaw` etc.
   * all keep working.
   *
   * `TENANT_SCOPE_ENFORCEMENT=off` at boot skips the extension entirely
   * (break-glass; zero overhead). Otherwise the mode is re-read on every
   * query, so warn/strict/off can be flipped at runtime (e.g. in tests).
   */
  constructor() {
    super();
    (this as any)[PRISMA_SERVICE_BRAND] = true;
    if (tenantScopeMode() === 'off') return;
    this.tenantScopeGuardInstalled = true;
    return this.$extends(tenantScopeExtension) as unknown as PrismaService;
  }

  /** True when the tenant-scope query extension wraps this client. */
  readonly tenantScopeGuardInstalled: boolean = false;

  /** Keep `x instanceof PrismaService` true for the extended client. */
  static [Symbol.hasInstance](instance: unknown): boolean {
    return (
      Function.prototype[Symbol.hasInstance].call(this, instance) ||
      (typeof instance === 'object' && instance !== null && (instance as any)[PRISMA_SERVICE_BRAND] === true)
    );
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
