import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Shared helpers for the admin offline mode + sync contract
 * (optimistic concurrency + client-generated ids). See CLAUDE.md
 * "Admin offline mode" and C:\Users\rjurio\.claude\plans\admin-offline-sync.md.
 */

export const CONFLICT_MESSAGE = 'This record was changed by someone else since you last loaded it.';

/** 409 body the offline client turns into a "keep mine / keep online" conflict. */
export function conflictException(current: unknown): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: 'CONFLICT',
    message: CONFLICT_MESSAGE,
    current: current ?? null,
  });
}

/**
 * Internal marker thrown inside a transaction when the optimistic-concurrency
 * claim affected 0 rows. Rolls the transaction back; the caller catches it
 * OUTSIDE the transaction, loads the current record and throws
 * `conflictException(current)`.
 */
export class StaleWriteError extends Error {
  constructor() {
    super('STALE_WRITE');
    this.name = 'StaleWriteError';
  }
}

/**
 * Parse an `expectedUpdatedAt` DTO value. Returns undefined when absent
 * (today's behaviour — no check). Comparison is at ms precision, which is the
 * precision Prisma's DateTime (timestamp(3)) stores.
 */
export function parseExpectedUpdatedAt(raw: string | undefined | null): Date | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('expectedUpdatedAt must be a valid ISO date');
  }
  return d;
}

/** Client-generated id format (cuid / cuid2 / nanoid-ish, lower-case). */
export const CLIENT_ID_REGEX = /^[a-z0-9][a-z0-9_-]{19,40}$/;

export function idConflictException(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: 'ID_CONFLICT',
    message: 'A record with this id already exists.',
  });
}

/**
 * True when `err` is a unique-constraint violation on the primary key `id`.
 * Prisma reports the PK either as the field list (`['id']`) or as the
 * constraint name (`<Model>_pkey`) depending on the driver path.
 */
export function isPrimaryKeyConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = err.meta?.target as string[] | string | undefined;
  if (Array.isArray(target)) return target.length === 1 && target[0] === 'id';
  if (typeof target === 'string') return target === 'id' || /_pkey$/.test(target);
  return false;
}

/**
 * When a client-supplied id was used for a create, map a PK collision to
 * 409 ID_CONFLICT (never revealing whether the colliding row belongs to
 * another tenant). Otherwise rethrow unchanged.
 */
export function rethrowIdConflict(err: unknown, clientId: string | undefined): never {
  if (clientId && isPrimaryKeyConflict(err)) throw idConflictException();
  throw err;
}
