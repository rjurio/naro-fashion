import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  POS_RENTALS_RELEASED,
  POS_RENTALS_TEST_OVERRIDE_ENV,
  POS_RENTALS_NOT_RELEASED,
  posRentalsEnabled,
  assertPosRentalsReleased,
} from './pos-rental-release';
import { Reflector } from '@nestjs/core';
import { PosRentalsReleaseGuard } from './pos-rentals-release.guard';
import { POS_RENTAL_SERVICING_ROUTE } from './pos-rental-release';
import { PosRentalsService } from './pos-rentals.service';
import { PosRentalsController } from './pos-rentals.controller';
import { RentalsService } from './rentals.service';
import { PosService } from '../pos/pos.service';

// Walk-in POS rentals ship in the R1..R4 artifacts as CODE but are not
// RELEASED until R5 (POS_RENTAL_LAUNCH_PLAN.md §2). These specs pin the
// release flag and every place that enforces it.
//
// R5's activation commit is the ONLY change that may flip
// POS_RENTALS_RELEASED to true; it must update the first test below in the
// same commit (and nothing else in this file should need to change).

const OVERRIDE = POS_RENTALS_TEST_OVERRIDE_ENV;
const notReleased = (e: any) =>
  e instanceof NotFoundException && (e.getResponse() as any).code === POS_RENTALS_NOT_RELEASED;

describe('release flag', () => {
  it('is false in this release (R1–R4); R5 flips it', () => {
    expect(POS_RENTALS_RELEASED).toBe(false);
    const src = readFileSync(join(__dirname, 'pos-rental-release.ts'), 'utf8');
    expect(src).toMatch(/^export const POS_RENTALS_RELEASED = false;$/m);
  });

  it('is a code constant: no SiteSetting, permission, tenant or production env can turn it on', () => {
    const src = readFileSync(join(__dirname, 'pos-rental-release.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    // Only NODE_ENV and the named test override are read; nothing from the DB.
    expect(src).not.toMatch(/prisma|siteSetting|SiteSetting|tenantContext|userHasPermission|ConfigService/);
    const envReads = src.match(/env(\.[A-Z_]+|\[[^\]]+\])/g) ?? [];
    expect(new Set(envReads)).toEqual(new Set(['env.NODE_ENV', 'env[POS_RENTALS_TEST_OVERRIDE_ENV]']));
  });

  it('the test override is ignored in production', () => {
    expect(posRentalsEnabled({ NODE_ENV: 'production', [OVERRIDE]: 'true' } as any)).toBe(false);
    expect(() => assertPosRentalsReleased({ NODE_ENV: 'production', [OVERRIDE]: 'true' } as any)).toThrow(NotFoundException);
  });

  it('outside production the override must be exactly "true"; default is off', () => {
    expect(posRentalsEnabled({ NODE_ENV: 'test' } as any)).toBe(false);
    expect(posRentalsEnabled({ NODE_ENV: 'development' } as any)).toBe(false);
    expect(posRentalsEnabled({ NODE_ENV: 'development', [OVERRIDE]: '1' } as any)).toBe(false);
    expect(posRentalsEnabled({ NODE_ENV: 'development', [OVERRIDE]: 'TRUE' } as any)).toBe(false);
    expect(posRentalsEnabled({ NODE_ENV: 'development', [OVERRIDE]: 'true' } as any)).toBe(true);
    expect(posRentalsEnabled({ NODE_ENV: 'test', [OVERRIDE]: 'true' } as any)).toBe(true);
  });

  it('this jest run has no override (the other specs see the shipped behaviour)', () => {
    expect(process.env[OVERRIDE]).toBeUndefined();
    expect(posRentalsEnabled()).toBe(false);
  });
});

describe('every walk-in /pos-rentals route is refused first, for every caller', () => {
  const routes = Object.getOwnPropertyNames(PosRentalsController.prototype).filter((k) => k !== 'constructor');
  const proto: any = PosRentalsController.prototype;
  const servicing = routes.filter((k) => Reflect.getMetadata(POS_RENTAL_SERVICING_ROUTE, proto[k]) === true);
  // Existing-booking servicing (online bookings before R5): open, pay, receipt, hand over, return.
  const SERVICING = ['detail', 'handover', 'lookup', 'pay', 'receipt', 'recordReturn'];
  // Walk-in only: everything that creates or serves a walk-in booking.
  const WALK_IN = ['addAddress', 'agreement', 'catalog', 'create', 'createCustomer', 'customers', 'idInPerson', 'quote'];

  it('the release guard is the FIRST class-level guard (before JWT, module, admin and permission guards)', () => {
    const guards: any[] = Reflect.getMetadata(GUARDS_METADATA, PosRentalsController) ?? [];
    expect(guards[0]).toBe(PosRentalsReleaseGuard);
    expect(guards.length).toBeGreaterThan(1);
    expect(routes.length).toBe(14); // catalog … return: the whole walk-in surface
  });

  it('exactly the six existing-booking routes are servicing routes; every create / walk-in route is not', () => {
    expect(servicing.sort()).toEqual(SERVICING);
    expect(routes.filter((k) => !servicing.includes(k)).sort()).toEqual(WALK_IN);
  });

  it('no route is exempt from the normal guards (no @Public, no method-level override)', () => {
    const src = readFileSync(join(__dirname, 'pos-rentals.controller.ts'), 'utf8');
    expect(src).not.toMatch(/@Public\(\)/);
    expect(src.match(/@UseGuards\(/g)?.length).toBe(2); // class + the 2FA guard ADDED on id-in-person
    expect(src).toMatch(/@UseGuards\(PosRentalsReleaseGuard, JwtAuthGuard, ModuleGuard, AdminGuard, PermissionGuard\)\s*\n@RequiresModule\('rentals'\)\s*\n@Controller\('pos-rentals'\)/);
  });

  const guard = new PosRentalsReleaseGuard(new Reflector());
  const ctx = (handler: string, user: any): any => ({
    getHandler: () => proto[handler],
    getClass: () => PosRentalsController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  });
  const callers: [string, any][] = [
    ['SUPER_ADMIN', { id: 'a1', isAdmin: true, role: 'SUPER_ADMIN', tenantId: 't1' }],
    ['platform admin', { id: 'p1', isPlatformAdmin: true }],
    ['anonymous', undefined],
  ];
  for (const [who, user] of callers) {
    it.each(WALK_IN)(`${who} → %s → 404 POS_RENTALS_NOT_RELEASED (the guard reads no user)`, (route) => {
      let err: any;
      try { guard.canActivate(ctx(route, user)); } catch (e) { err = e; }
      expect(notReleased(err)).toBe(true);
      expect(err.getStatus()).toBe(404);
    });
  }
  it.each(SERVICING)('%s continues to the normal JWT / admin / permission guards', (route) => {
    expect(guard.canActivate(ctx(route, undefined))).toBe(true);
  });

  it('a servicing route refuses any booking that is not ONLINE (no walk-in booking is ever served)', async () => {
    const prisma: any = { rentalOrder: { findFirst: jest.fn(async () => ({ id: 'r1', channel: 'POS', payments: [], refundRequests: [] })) } };
    const svc: any = new (PosRentalsService as any)(prisma, { requireId: 't1' }, {}, {}, {}, {});
    const err = await svc.detail('r1').catch((e: any) => e);
    expect(notReleased(err)).toBe(true);
  });
});

describe('defence in depth: the shared booking path refuses a POS booking', () => {
  function make() {
    const touched: string[] = [];
    const prisma: any = new Proxy({}, { get: (_t, k) => { touched.push(String(k)); return new Proxy({}, { get: () => jest.fn() }); } });
    const audit: any = { log: jest.fn() };
    const tenantContext: any = { get requireId() { touched.push('tenant'); return 't1'; } };
    return { svc: new RentalsService(prisma, tenantContext, audit), touched, audit };
  }
  const dto: any = { productId: 'p1', variantId: 'v1', startDate: '2027-01-10', returnDate: '2027-01-12', pickupDate: '2027-01-10' };

  it('channel POS → 404 POS_RENTALS_NOT_RELEASED before ANY read (SUPER_ADMIN actor or not)', async () => {
    const { svc, touched, audit } = make();
    const err = await svc.create('u1', dto, { channel: 'POS', createdByAdminId: 'super-1', termsAccepted: true }).catch((e) => e);
    expect(notReleased(err)).toBe(true);
    expect(touched).toEqual([]);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('an unknown channel is refused the same way (only ONLINE passes)', async () => {
    const { svc, touched } = make();
    const err = await svc.create('u1', dto, { channel: 'WALKIN' as any }).catch((e) => e);
    expect(notReleased(err)).toBe(true);
    expect(touched).toEqual([]);
  });

  it('ONLINE (the default) is not affected by the flag', async () => {
    const { svc, touched } = make();
    const err = await svc.create('u1', dto).catch((e) => e);
    expect(notReleased(err)).toBe(false);
    expect(touched.length).toBeGreaterThan(0); // it went on to read the customer
  });

  it('the storefront route cannot pass a channel (2-argument call; the DTO has no channel field)', () => {
    const ctrl = readFileSync(join(__dirname, 'rentals.controller.ts'), 'utf8');
    expect(ctrl).toMatch(/this\.rentalsService\.create\(userId, dto\)/);
    expect(ctrl).not.toMatch(/rentalsService\.create\([^)]*channel/);
    const dtoSrc = readFileSync(join(__dirname, 'dto', 'create-rental.dto.ts'), 'utf8');
    expect(dtoSrc).not.toMatch(/channel|createdByAdminId|termsAccepted/);
    const upd = readFileSync(join(__dirname, 'dto', 'update-rental.dto.ts'), 'utf8');
    expect(upd).not.toMatch(/channel|createdByAdminId/);
  });

  it('RentalsService.create has exactly two callers: the storefront (ONLINE) and PosRentalsService (POS)', () => {
    const { execSync } = require('child_process');
    const root = join(__dirname, '..');
    const grep = (pattern: string, flag: string): string[] =>
      String(execSync(`git grep ${flag} -E "${pattern}" -- .`, { cwd: root, encoding: 'utf8' }))
        .split(/\r?\n/).filter(Boolean).filter((l) => !l.split(':')[0].endsWith('.spec.ts'));
    const callers = grep('(rentals|rentalsService|rentalService)[.]create[(]', '-n').map((l) => l.split(':')[0]);
    expect(callers.sort()).toEqual(['rentals/pos-rentals.service.ts', 'rentals/rentals.controller.ts']);
    // ...and no direct Prisma insert of a rental anywhere else could bypass the check.
    expect(grep('rentalOrder[.](create|createMany|upsert)[(]', '-l').sort()).toEqual(['rentals/rentals.service.ts']);
  });
});

describe('the admin POS screen follows the SERVER', () => {
  it('GET /pos/capabilities: posRentalsReleased false, posRentalServicing true (SUPER_ADMIN too)', async () => {
    const prisma: any = { adminUserRole: { findMany: jest.fn(async () => []) } };
    const svc = new PosService(prisma, { requireId: 't1' } as any);
    expect(await svc.getCapabilities({ id: 'a1', role: 'SUPER_ADMIN', isAdmin: true, tenantId: 't1' } as any)).toMatchObject({ posRentalsReleased: false, posRentalServicing: true });
    expect(await svc.getCapabilities({ id: 'p1', isPlatformAdmin: true } as any)).toMatchObject({ posRentalsReleased: false, posRentalServicing: true });
  });

  const page = readFileSync(join(__dirname, '..', '..', '..', 'admin', 'app', 'dashboard', 'pos', 'page.tsx'), 'utf8');
  it('the Rental tab renders only when the server says so; before R5 it is servicing-only; never statically imported', () => {
    expect(page).toMatch(/setPosRentalsReleased\(caps\?\.posRentalsReleased === true\)/);
    expect(page).toMatch(/useState\(false\);\s*\n\s*useEffect/); // default: not released
    expect(page).toMatch(/setPosRentalServicing\(caps\?\.posRentalServicing === true\)/);
    expect(page).toMatch(/const rentalTab = posRentalsReleased \|\| posRentalServicing;/);
    expect(page).toMatch(/\{rentalTab && \(\s*\n\s*<div[^>]*role="tablist"/);
    expect(page).toMatch(/const rentalMode = rentalTab && mode === 'RENTAL';/);
    expect(page).toMatch(/\{rentalMode && <PosRentalMode sessionId=\{session\.id\} online=\{online\} servicingOnly=\{!posRentalsReleased\} \/>\}/);
    expect(page).not.toMatch(/^import PosRentalMode/m);
    expect(page).toMatch(/dynamic\(\(\) => import\('@\/components\/pos-rental\/PosRentalMode'\)/);
    // never read from the offline cache
    expect(page).not.toMatch(/localStorage[^\n]*posRentalsReleased|posRentalsReleased[^\n]*localStorage/);
  });
});

describe('offline replay cannot reach walk-in rentals', () => {
  const outbox = readFileSync(join(__dirname, '..', '..', '..', 'admin', 'lib', 'offline', 'outbox.ts'), 'utf8');
  const block = outbox.slice(outbox.indexOf('const OFFLINE_ROUTES'), outbox.indexOf('];', outbox.indexOf('const OFFLINE_ROUTES')));
  // eslint-disable-next-line no-eval
  const patterns: RegExp[] = [...block.matchAll(/pattern: (\/.+?\/)[a-z]*, kind/g)].map((m) => eval(m[1]));

  it('the allow-list has no /pos-rentals route and no rental-create route', () => {
    expect(patterns.length).toBeGreaterThanOrEqual(9);
    expect(block).not.toMatch(/pos-rentals/);
    for (const p of [
      '/pos-rentals', '/pos-rentals/customers', '/pos-rentals/r1/payments', '/pos-rentals/r1/handover',
      '/pos-rentals/r1/return', '/pos-rentals/r1/id-in-person', '/pos-rentals/customers/c1/address', '/rentals',
    ]) {
      expect(patterns.some((re) => re.test(p))).toBe(false);
    }
  });
});

describe('servicing-only POS screen (before R5)', () => {
  const comp = readFileSync(join(__dirname, '..', '..', '..', 'admin', 'components', 'pos-rental', 'PosRentalMode.tsx'), 'utf8');
  it('hides the new-booking column, in-person ID, address and agreement print', () => {
    expect(comp).toMatch(/\{!servicingOnly && \(\s*\n\s*<div className="space-y-3">/);
    expect(comp).toMatch(/\{!servicingOnly && !rental\.idApproved && \(/);
    expect(comp).toMatch(/\{!servicingOnly && !rental\.user\?\.addresses\?\.length && \(/);
    expect(comp).toMatch(/\{!servicingOnly && <Btn data-testid="rental-agreement"/);
  });
});
