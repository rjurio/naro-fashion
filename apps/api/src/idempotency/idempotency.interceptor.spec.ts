import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyRetentionService } from './idempotency-retention.service';
import { canonicalJson, requestHash, resolveIdempotencyRetentionDays } from './idempotency.util';

/** Minimal in-memory IdempotencyKey table honouring the (principalId, key) unique. */
function makePrisma() {
  const rows: any[] = [];
  let seq = 0;
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => {
      if (v instanceof Date) return row[k]?.getTime() === v.getTime();
      return row[k] === v;
    });
  const idempotencyKey = {
    create: jest.fn(async ({ data }: any) => {
      if (rows.some((r) => r.principalId === data.principalId && r.key === data.key)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['principalId', 'key'] },
        });
      }
      const row = { id: `row${++seq}`, createdAt: new Date(), responseStatus: null, responseBody: null, ...data };
      rows.push(row);
      return { id: row.id };
    }),
    findFirst: jest.fn(async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i], where)) {
          rows.splice(i, 1);
          count++;
        }
      }
      return { count };
    }),
  };
  return { prisma: { idempotencyKey } as any, rows };
}

const ADMIN = { id: 'admin-1', isAdmin: true, tenantId: 't1' };

function makeCtx(opts: { method?: string; key?: string | null; user?: any; body?: any; url?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.key !== null) headers['idempotency-key'] = opts.key ?? 'offline-key-0001';
  const req = {
    method: opts.method ?? 'POST',
    originalUrl: opts.url ?? '/api/v1/pos/sales',
    headers,
    user: opts.user === undefined ? ADMIN : opts.user,
    body: opts.body ?? { total: 100, items: [{ a: 1, b: 2 }] },
  };
  const resHeaders: Record<string, string> = {};
  const res = {
    statusCode: 200,
    setHeader: jest.fn((k: string, v: string) => (resHeaders[k] = v)),
    status: jest.fn(function (this: any, s: number) {
      this.statusCode = s;
      return this;
    }),
  };
  const handler = () => undefined;
  const ctx: any = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => handler,
    getClass: () => class {},
  };
  return { ctx, req, res, resHeaders };
}

function handlerReturning(body: any) {
  const handle = jest.fn(() => of(body));
  return { handle };
}

describe('IdempotencyInterceptor', () => {
  it('first call executes the handler and stores the response as COMPLETED', async () => {
    const { prisma, rows } = makePrisma();
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    const { ctx } = makeCtx();
    const next = handlerReturning({ order: { id: 'o1', total: 100 } });

    const out = await lastValueFrom(icpt.intercept(ctx, next));
    expect(out).toEqual({ order: { id: 'o1', total: 100 } });
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: 't1',
      principalId: 'admin-1',
      key: 'offline-key-0001',
      status: 'COMPLETED',
      responseStatus: 201,
      responseBody: { order: { id: 'o1', total: 100 } },
    });
    expect(rows[0].completedAt).toBeInstanceOf(Date);
  });

  it('replay with the same request returns the stored body without re-running the handler', async () => {
    const { prisma } = makePrisma();
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    await lastValueFrom(icpt.intercept(makeCtx().ctx, handlerReturning({ order: { id: 'o1' } })));

    const second = makeCtx();
    const next = handlerReturning({ order: { id: 'DUPLICATE' } });
    const out = await lastValueFrom(icpt.intercept(second.ctx, next));
    expect(out).toEqual({ order: { id: 'o1' } });
    expect(next.handle).not.toHaveBeenCalled();
    expect(second.resHeaders['Idempotency-Replayed']).toBe('true');
    expect(second.res.status).toHaveBeenCalledWith(201);
  });

  it('body key order does not matter for the request hash', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(requestHash('post', '/x', { b: 1, a: 2 })).toBe(requestHash('POST', '/x', { a: 2, b: 1 }));
    expect(requestHash('POST', '/x', { a: 1 })).not.toBe(requestHash('POST', '/y', { a: 1 }));
  });

  it('same key with a different body → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const { prisma } = makePrisma();
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    await lastValueFrom(icpt.intercept(makeCtx().ctx, handlerReturning({ ok: 1 })));

    const next = handlerReturning({ ok: 2 });
    const err: any = await lastValueFrom(icpt.intercept(makeCtx({ body: { total: 999 } }).ctx, next)).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('same key still IN_PROGRESS → 409 IDEMPOTENCY_IN_PROGRESS', async () => {
    const { prisma, rows } = makePrisma();
    rows.push({
      id: 'r0',
      tenantId: 't1',
      principalId: 'admin-1',
      key: 'offline-key-0001',
      status: 'IN_PROGRESS',
      requestHash: 'x',
      createdAt: new Date(),
    });
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    const next = handlerReturning({ ok: 1 });
    const err: any = await lastValueFrom(icpt.intercept(makeCtx().ctx, next)).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('an IN_PROGRESS row older than 5 minutes is taken over', async () => {
    const { prisma, rows } = makePrisma();
    rows.push({
      id: 'r0',
      tenantId: 't1',
      principalId: 'admin-1',
      key: 'offline-key-0001',
      status: 'IN_PROGRESS',
      requestHash: 'x',
      createdAt: new Date(Date.now() - 6 * 60 * 1000),
    });
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    const next = handlerReturning({ ok: 1 });
    await expect(lastValueFrom(icpt.intercept(makeCtx().ctx, next))).resolves.toEqual({ ok: 1 });
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe('COMPLETED');
  });

  it('handler error deletes the row (so a retry can run) and rethrows', async () => {
    const { prisma, rows } = makePrisma();
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    const boom = new BadRequestException('Insufficient stock');
    const err = await lastValueFrom(
      icpt.intercept(makeCtx().ctx, { handle: () => throwError(() => boom) }),
    ).catch((e) => e);
    expect(err).toBe(boom);
    expect(rows).toHaveLength(0);

    // Retry with the same key now executes.
    const next = handlerReturning({ ok: true });
    await expect(lastValueFrom(icpt.intercept(makeCtx().ctx, next))).resolves.toEqual({ ok: true });
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('no Idempotency-Key header → passthrough, nothing stored', async () => {
    const { prisma, rows } = makePrisma();
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    const next = handlerReturning({ ok: 1 });
    await lastValueFrom(icpt.intercept(makeCtx({ key: null }).ctx, next));
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(0);
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('customer JWT → passthrough even with the header', async () => {
    const { prisma, rows } = makePrisma();
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    const next = handlerReturning({ ok: 1 });
    const user = { id: 'cust-1', tenantId: 't1' };
    await lastValueFrom(icpt.intercept(makeCtx({ user }).ctx, next));
    await lastValueFrom(icpt.intercept(makeCtx({ user }).ctx, next));
    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(0);
  });

  it('unauthenticated and GET requests → passthrough', async () => {
    const { prisma } = makePrisma();
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    const next = handlerReturning({ ok: 1 });
    await lastValueFrom(icpt.intercept(makeCtx({ user: null }).ctx, next));
    await lastValueFrom(icpt.intercept(makeCtx({ method: 'GET' }).ctx, next));
    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('invalid key format → 400 for admins', async () => {
    const { prisma } = makePrisma();
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    const next = handlerReturning({ ok: 1 });
    for (const key of ['short', 'has space in it', 'x'.repeat(129), 'bad/chars!!']) {
      const err: any = await lastValueFrom(icpt.intercept(makeCtx({ key }).ctx, next)).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
    }
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('keys are per principal: another admin may reuse the same key string', async () => {
    const { prisma, rows } = makePrisma();
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    await lastValueFrom(icpt.intercept(makeCtx().ctx, handlerReturning({ a: 1 })));
    const next = handlerReturning({ b: 2 });
    const out = await lastValueFrom(
      icpt.intercept(makeCtx({ user: { id: 'admin-2', isAdmin: true, tenantId: 't2' } }).ctx, next),
    );
    expect(out).toEqual({ b: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[1].tenantId).toBe('t2');
  });

  it('platform admins are supported (tenantId null)', async () => {
    const { prisma, rows } = makePrisma();
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    await lastValueFrom(
      icpt.intercept(makeCtx({ user: { id: 'pa-1', isPlatformAdmin: true } }).ctx, handlerReturning({ ok: 1 })),
    );
    expect(rows[0]).toMatchObject({ tenantId: null, principalId: 'pa-1', status: 'COMPLETED' });
  });

  it('multipart photo upload (body not parsed yet at interceptor time) replays the stored { url }', async () => {
    // Offline photos (admin offline mode, Phase 4): the sync engine uploads each
    // photo with its own Idempotency-Key; a retry after a dropped response must
    // return the first upload's URL instead of storing the file twice.
    const { prisma } = makePrisma();
    const icpt = new IdempotencyInterceptor(prisma, new Reflector());
    const first = makeCtx({ url: '/api/v1/upload/image', key: 'blob-b0123456789abcdef' });
    (first.req as any).body = undefined;
    await lastValueFrom(icpt.intercept(first.ctx, handlerReturning({ url: '/uploads/products/a.jpg', filename: 'a.jpg' })));

    const retry = makeCtx({ url: '/api/v1/upload/image', key: 'blob-b0123456789abcdef' });
    (retry.req as any).body = undefined;
    const next = handlerReturning({ url: '/uploads/products/DUPLICATE.jpg' });
    const out = await lastValueFrom(icpt.intercept(retry.ctx, next));
    expect(out).toEqual({ url: '/uploads/products/a.jpg', filename: 'a.jpg' });
    expect(next.handle).not.toHaveBeenCalled();
    expect(retry.resHeaders['Idempotency-Replayed']).toBe('true');
  });
});

describe('IdempotencyRetentionService', () => {
  it('deletes rows older than the retention window (default 30 days)', async () => {
    const prisma: any = {
      idempotencyKey: {
        findMany: jest.fn().mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const svc = new IdempotencyRetentionService(prisma);
    const now = new Date('2026-10-18T00:00:00Z');
    const n = await svc.prune(now);
    expect(n).toBe(2);
    const cutoff: Date = prisma.idempotencyKey.findMany.mock.calls[0][0].where.createdAt.lt;
    expect(now.getTime() - cutoff.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(prisma.idempotencyKey.deleteMany.mock.calls[0][0].where.id.in).toEqual(['a', 'b']);
  });

  it('resolveIdempotencyRetentionDays falls back to 30 on junk', () => {
    expect(resolveIdempotencyRetentionDays(undefined)).toBe(30);
    expect(resolveIdempotencyRetentionDays('abc')).toBe(30);
    expect(resolveIdempotencyRetentionDays('0')).toBe(30);
    expect(resolveIdempotencyRetentionDays('45')).toBe(45);
  });
});
