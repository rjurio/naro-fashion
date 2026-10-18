import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap, switchMap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_REGEX,
  IDEMPOTENCY_REPLAYED_HEADER,
  IDEMPOTENCY_STALE_MS,
  IDEMPOTENT_METHODS,
  requestHash,
} from './idempotency.util';

type Begin =
  | { kind: 'execute'; rowId: string; tenantId: string | null }
  | { kind: 'replay'; status: number; body: unknown };

/**
 * Global idempotency for ADMIN mutations (admin offline mode + sync).
 *
 * Acts only when ALL hold: method is POST/PUT/PATCH/DELETE, the
 * `Idempotency-Key` header is present, and `req.user` is an authenticated
 * tenant admin or platform admin (interceptors run after guards, so the JWT
 * strategy has populated req.user). Everything else — storefront/customer
 * calls, public routes, requests without the header — passes through
 * untouched.
 *
 *  - first call: inserts an IN_PROGRESS row keyed (principalId, key); on a
 *    2xx result stores status + body and marks it COMPLETED; on an error
 *    deletes the row so the client can retry, and rethrows.
 *  - replay with the same request hash: returns the stored body/status and
 *    sets `Idempotency-Replayed: true` — the handler does NOT run again.
 *  - same key, different method/path/body: 422 IDEMPOTENCY_KEY_REUSED.
 *  - same key still running: 409 IDEMPOTENCY_IN_PROGRESS (retry later). An
 *    IN_PROGRESS row older than 5 min is treated as abandoned and taken over.
 *
 * Singleton by design (PrismaService + Reflector only, never TenantContext).
 * Every query carries tenantId so the runtime tenant-scope guard is satisfied
 * (platform-admin requests are skipped by the guard anyway).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const method = String(req?.method || '').toUpperCase();
    if (!IDEMPOTENT_METHODS.has(method)) return next.handle();

    const rawKey = req?.headers?.[IDEMPOTENCY_HEADER];
    if (rawKey === undefined) return next.handle();

    const user = req.user;
    if (!user || !(user.isAdmin || user.isPlatformAdmin) || !user.id) return next.handle();

    const key = Array.isArray(rawKey) ? rawKey[0] : String(rawKey);
    if (!IDEMPOTENCY_KEY_REGEX.test(key)) {
      return throwError(
        () =>
          new BadRequestException({
            statusCode: 400,
            code: 'IDEMPOTENCY_KEY_INVALID',
            message: 'Idempotency-Key must be 8–128 characters of A–Z, a–z, 0–9, "_" or "-".',
          }),
      );
    }

    const principalId = String(user.id);
    const tenantId: string | null = user.isPlatformAdmin ? null : (user.tenantId ?? null);
    const path = String(req.originalUrl || req.url || '');
    const hash = requestHash(method, path, req.body);
    const successStatus =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (method === 'POST' ? 201 : 200);

    return from(this.begin({ tenantId, principalId, key, method, path, hash })).pipe(
      switchMap((begin) => {
        if (begin.kind === 'replay') {
          res?.setHeader?.(IDEMPOTENCY_REPLAYED_HEADER, 'true');
          res?.status?.(begin.status);
          return of(begin.body);
        }
        return next.handle().pipe(
          mergeMap((body) => from(this.complete(begin, successStatus, body))),
          catchError((err) => from(this.release(begin)).pipe(mergeMap(() => throwError(() => err)))),
        );
      }),
    );
  }

  /** Claim the key, or decide replay / reject. */
  private async begin(args: {
    tenantId: string | null;
    principalId: string;
    key: string;
    method: string;
    path: string;
    hash: string;
  }): Promise<Begin> {
    const { tenantId, principalId, key, method, path, hash } = args;
    try {
      const row = await this.prisma.idempotencyKey.create({
        data: { tenantId, principalId, key, method, path, requestHash: hash, status: 'IN_PROGRESS' },
        select: { id: true },
      });
      return { kind: 'execute', rowId: row.id, tenantId };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }

    const existing = await this.prisma.idempotencyKey.findFirst({
      where: { principalId, key, tenantId },
    });
    if (!existing) {
      // Lost a race with a release (row deleted between create and read) —
      // ask the client to retry rather than executing blind.
      throw this.inProgress();
    }

    if (existing.status === 'COMPLETED') {
      if (existing.requestHash !== hash) throw this.reused();
      return {
        kind: 'replay',
        status: existing.responseStatus ?? 200,
        body: existing.responseBody ?? undefined,
      };
    }

    // IN_PROGRESS: take over only if abandoned (> 5 min), atomically.
    const cutoff = new Date(Date.now() - IDEMPOTENCY_STALE_MS);
    if (existing.createdAt < cutoff) {
      const taken = await this.prisma.idempotencyKey.updateMany({
        where: { id: existing.id, tenantId, status: 'IN_PROGRESS', createdAt: existing.createdAt },
        data: { createdAt: new Date(), method, path, requestHash: hash },
      });
      if (taken.count === 1) return { kind: 'execute', rowId: existing.id, tenantId };
    }
    throw this.inProgress();
  }

  private async complete(
    begin: Extract<Begin, { kind: 'execute' }>,
    status: number,
    body: unknown,
  ): Promise<unknown> {
    // Streams/files can't be replayed — don't keep a row that would lie.
    if (body instanceof StreamableFile) {
      await this.release(begin);
      return body;
    }
    let stored: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    try {
      // Same serialisation the client receives (Decimal → string, Date → ISO).
      stored = body === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(body));
      if (stored === null) stored = Prisma.JsonNull;
    } catch {
      await this.release(begin);
      return body;
    }
    try {
      await this.prisma.idempotencyKey.updateMany({
        where: { id: begin.rowId, tenantId: begin.tenantId },
        data: { status: 'COMPLETED', responseStatus: status, responseBody: stored, completedAt: new Date() },
      });
    } catch (err) {
      // The mutation already succeeded — never fail the response over the
      // bookkeeping row. Worst case a replay re-executes (pre-feature behaviour).
      this.logger.error(`Failed to store idempotent response: ${(err as Error).message}`);
    }
    return body;
  }

  private async release(begin: Extract<Begin, { kind: 'execute' }>): Promise<void> {
    try {
      await this.prisma.idempotencyKey.deleteMany({
        where: { id: begin.rowId, tenantId: begin.tenantId, status: 'IN_PROGRESS' },
      });
    } catch (err) {
      this.logger.error(`Failed to release idempotency key: ${(err as Error).message}`);
    }
  }

  private inProgress(): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: 'IDEMPOTENCY_IN_PROGRESS',
      message: 'A request with this Idempotency-Key is still being processed. Retry shortly.',
    });
  }

  private reused(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      statusCode: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This Idempotency-Key was already used for a different request.',
    });
  }
}
