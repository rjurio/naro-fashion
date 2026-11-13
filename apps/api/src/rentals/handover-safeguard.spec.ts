import { readFileSync } from 'fs';
import { join } from 'path';
import { UnprocessableEntityException } from '@nestjs/common';
import { assertHandoverSafeguard, CHECKLIST_ENFORCEMENT_AVAILABLE, HandoverSafeguardController, HandoverSafeguardService } from './handover-safeguard';
import { MANAGER_EXCLUDED } from '../roles/system-roles.seeder';

// R1 rollback safety switch: once R3 turns the mandatory checklist on, a
// build without the checklist gate refuses every rental hand-over (fail closed).

const db = (row: any, fail = false) => ({
  rentalHandoverSafeguard: { findFirst: jest.fn(async () => { if (fail) throw new Error('db down'); return row; }) },
});

describe('assertHandoverSafeguard', () => {
  it('this build HAS the checklist gate (R3); the cases below pass `false` to model an R1/R2 build', () => expect(CHECKLIST_ENFORCEMENT_AVAILABLE).toBe(true));

  it('switch off / never set: hand-overs follow the normal gate', async () => {
    await expect(assertHandoverSafeguard(db(null), 't1', false)).resolves.toBeUndefined();
    await expect(assertHandoverSafeguard(db({ checklistRequired: false }), 't1', false)).resolves.toBeUndefined();
  });

  it('switch on + build WITHOUT the checklist → 422 HANDOVER_REQUIRES_CHECKLIST_BUILD', async () => {
    const e: any = await assertHandoverSafeguard(db({ checklistRequired: true }), 't1', false).catch((x) => x);
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect(e.getResponse().code).toBe('HANDOVER_REQUIRES_CHECKLIST_BUILD');
  });

  it('switch on + build WITH the checklist (R3) → allowed (R3 adds its own gate)', async () => {
    await expect(assertHandoverSafeguard(db({ checklistRequired: true }), 't1', true)).resolves.toBeUndefined();
  });

  it('fails CLOSED when the switch cannot be read', async () => {
    const e: any = await assertHandoverSafeguard(db(null, true), 't1', false).catch((x) => x);
    expect(e.getResponse().code).toBe('HANDOVER_SAFEGUARD_UNAVAILABLE');
  });

  it('MISSING configuration after R3: no switch row, but the R3 table exists → still refused (fail closed)', async () => {
    const d: any = { ...db(null), $queryRaw: jest.fn().mockResolvedValue([{ t: '"RentalChecklistSnapshot"' }]) };
    const e: any = await assertHandoverSafeguard(d, 't1', false).catch((x) => x);
    expect(e.getResponse().code).toBe('HANDOVER_REQUIRES_CHECKLIST_BUILD');
  });

  it('switch explicitly OFF but R3 deployed → still refused (no break-glass once enforcement exists)', async () => {
    const d: any = { ...db({ checklistRequired: false }), $queryRaw: jest.fn().mockResolvedValue([{ t: '"RentalChecklistSnapshot"' }]) };
    expect((await assertHandoverSafeguard(d, 't1', false).catch((x) => x)).getResponse().code).toBe('HANDOVER_REQUIRES_CHECKLIST_BUILD');
  });

  it('the R3 marker check failing → refused (unavailable), never allowed', async () => {
    const d: any = { ...db(null), $queryRaw: jest.fn().mockRejectedValue(new Error('db down')) };
    expect((await assertHandoverSafeguard(d, 't1', false).catch((x) => x)).getResponse().code).toBe('HANDOVER_SAFEGUARD_UNAVAILABLE');
  });

  it('pre-R3 database (no marker table, switch off) → normal gate; the R3 build itself is not blocked by its own table', async () => {
    const pre: any = { ...db(null), $queryRaw: jest.fn().mockResolvedValue([{ t: null }]) };
    await expect(assertHandoverSafeguard(pre, 't1', false)).resolves.toBeUndefined();
    const r3: any = { ...db({ checklistRequired: true }), $queryRaw: jest.fn().mockResolvedValue([{ t: '"RentalChecklistSnapshot"' }]) };
    await expect(assertHandoverSafeguard(r3, 't1', true)).resolves.toBeUndefined();
  });

  it('R3 build: a shop with no switch row (created after boot) gets it ON at its first hand-over; failures never block', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const d: any = { rentalHandoverSafeguard: { findFirst: jest.fn().mockResolvedValue(null), upsert } };
    await expect(assertHandoverSafeguard(d, 't9', true)).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't9' }, create: expect.objectContaining({ checklistRequired: true }) }));
    upsert.mockRejectedValueOnce(new Error('db hiccup'));
    await expect(assertHandoverSafeguard(d, 't9', true)).resolves.toBeUndefined();
    const on: any = { rentalHandoverSafeguard: { findFirst: jest.fn().mockResolvedValue({ checklistRequired: true }), upsert: jest.fn() } };
    await assertHandoverSafeguard(on, 't9', true);
    expect(on.rentalHandoverSafeguard.upsert).not.toHaveBeenCalled();
  });

  it('reads the switch for the current shop only', async () => {
    const d = db(null);
    await assertHandoverSafeguard(d, 'shop-a', false);
    expect(d.rentalHandoverSafeguard.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'shop-a' } }));
  });
});

describe('one choke point for every hand-over route', () => {
  const src = readFileSync(join(__dirname, 'rentals.service.ts'), 'utf8').replace(/\r\n/g, '\n');
  it('assertReleasable checks the switch first and audits a refusal', () => {
    const body = src.slice(src.indexOf('async assertReleasable('), src.indexOf('const missing: string[] = [];', src.indexOf('async assertReleasable(')));
    expect(body).toMatch(/assertHandoverSafeguard\(this\.prisma, tenantId\)/);
    expect(body).toMatch(/RELEASE_BLOCKED/);
  });
  it('updateStatus runs assertReleasable on every hand-over transition (no role skips it)', () => {
    const i = src.indexOf('if (RELEASE_TARGETS.includes(status)');
    const block = src.slice(i, src.indexOf('\n    }\n', i));
    expect(block).toMatch(/await this\.assertReleasable\(rental\)/);
    expect(block).not.toMatch(/if \(user[^)]*\)\s*\{\s*await this\.assertReleasable/);
  });
  it('the POS hand-over goes through updateStatus (no separate status write)', () => {
    const pos = readFileSync(join(__dirname, 'pos-rentals.service.ts'), 'utf8');
    const h = pos.slice(pos.indexOf('async handover('), pos.indexOf('async recordReturn('));
    expect(h).toMatch(/this\.rentals\.updateStatus\(id, 'ACTIVE'/);
    expect(h).not.toMatch(/data:\s*\{[^}]*\bstatus:/);
  });
});

describe('restricted, audited control', () => {
  it('PUT needs rentals:handover-safeguard; never a role default', () => {
    const perm = Reflect.getMetadata('permissions', HandoverSafeguardController.prototype.set) ?? Reflect.getMetadata('requiredPermissions', HandoverSafeguardController.prototype.set);
    const src = readFileSync(join(__dirname, 'handover-safeguard.ts'), 'utf8');
    expect(src).toMatch(/@Put\(\)\s*\n\s*@RequiresPermission\('rentals:handover-safeguard'\)/);
    expect(MANAGER_EXCLUDED).toContain('rentals:handover-safeguard');
    expect(perm === undefined || JSON.stringify(perm).includes('rentals:handover-safeguard')).toBe(true);
  });

  it('a change is audited with before / after and the reason; a no-op change writes nothing', async () => {
    const row = { id: 'g1', checklistRequired: false };
    const prisma: any = { rentalHandoverSafeguard: { findFirst: jest.fn().mockResolvedValue(row), updateMany: jest.fn(), create: jest.fn() } };
    const audit = { log: jest.fn() };
    const s = new HandoverSafeguardService(prisma, { requireId: 't1' } as any, audit as any);
    await s.set({ checklistRequired: true, reason: 'R3 shipped: checklist mandatory' }, { id: 'owner' });
    expect(audit.log).toHaveBeenCalledWith('HANDOVER_SAFEGUARD_CHANGED', 'RentalHandoverSafeguard', 't1', expect.objectContaining({ before: false, after: true }));
    audit.log.mockClear(); prisma.rentalHandoverSafeguard.updateMany.mockClear();
    prisma.rentalHandoverSafeguard.findFirst.mockResolvedValue({ id: 'g1', checklistRequired: true });
    await s.set({ checklistRequired: true, reason: 'same value again, no change' }, { id: 'owner' });
    expect(prisma.rentalHandoverSafeguard.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('R3: the switch can no longer be turned OFF (422 SAFEGUARD_LOCKED_ON, nothing written)', async () => {
    const prisma: any = { rentalHandoverSafeguard: { findFirst: jest.fn().mockResolvedValue({ id: 'g1', checklistRequired: true }), updateMany: jest.fn(), create: jest.fn() } };
    const audit = { log: jest.fn() };
    const s = new HandoverSafeguardService(prisma, { requireId: 't1' } as any, audit as any);
    const e: any = await s.set({ checklistRequired: false, reason: 'trying to switch it off' }, { id: 'owner' }).catch((x) => x);
    expect(e.getResponse().code).toBe('SAFEGUARD_LOCKED_ON');
    expect(prisma.rentalHandoverSafeguard.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('is not a SiteSetting (the generic CMS settings endpoint cannot change it)', () => {
    const src = readFileSync(join(__dirname, 'handover-safeguard.ts'), 'utf8');
    expect(src).not.toMatch(/siteSetting/);
  });
});
