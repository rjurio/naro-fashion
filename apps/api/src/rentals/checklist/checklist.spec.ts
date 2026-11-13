import { readFileSync } from 'fs';
import { join } from 'path';
import {
  assertChecklistReleasable,
  assertDepositSettleable,
  assertInspectionComplete,
  discrepanciesFor,
  freezeSnapshot,
  resolveTemplate,
  templateContentHash,
} from './checklist-core';
import { RentalChecklistV2Service } from './checklist.service';
import { MANAGER_EXCLUDED } from '../../roles/system-roles.seeder';

// R3 mandatory checklist (owner requirements E1–E15, F). In-memory fake of the
// few Prisma calls the rules use.
function fakeDb(seed: Partial<Record<string, any[]>> = {}) {
  const t: Record<string, any[]> = {
    template: [], snapshot: [], record: [], exception: [], discrepancy: [], rental: [], ...seed,
  };
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const match = (row: any, where: any = {}) =>
    Object.entries(where).every(([k, v]: any) => {
      if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
      if (v && typeof v === 'object' && 'is' in v) return true;
      return (row[k] ?? null) === (v ?? null);
    });
  const db: any = {
    t,
    $executeRaw: jest.fn(async () => 1),
    $transaction: async (fn: any) => fn(db),
    rentalChecklistTemplate: {
      findFirst: async ({ where }: any) => {
        const rows = t.template.filter((r) => match(r, where));
        return rows[rows.length - 1] ?? null;
      },
    },
    rentalChecklistSnapshot: {
      findFirst: async ({ where, include }: any) => {
        const s = t.snapshot.find((r) => match(r, where));
        return s ? { ...s, ...(include ? { items: s.items } : {}) } : null;
      },
      create: async ({ data }: any) => {
        if (t.snapshot.some((s) => s.rentalOrderId === data.rentalOrderId)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        const sid = id('snap');
        const s = { ...data, id: sid, items: (data.items?.create ?? []).map((i: any) => ({ ...i, id: id('item'), snapshotId: sid })) };
        t.snapshot.push(s);
        return s;
      },
    },
    rentalChecklistRecord: {
      findMany: async ({ where }: any) => t.record.filter((r) => match(r, where)),
      findFirst: async ({ where }: any) => t.record.find((r) => match(r, where)) ?? null,
      create: async ({ data }: any) => {
        if (data.supersedesId && t.record.some((r) => r.supersedesId === data.supersedesId)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        const r = { ...data, id: id('rec'), recordedAt: new Date(Date.now() + n) };
        t.record.push(r);
        return r;
      },
    },
    rentalChecklistException: {
      findMany: async ({ where }: any) => t.exception.filter((r) => match(r, where)),
      findFirst: async ({ where }: any) => t.exception.find((r) => match(r, where)) ?? null,
      create: async ({ data }: any) => { const e = { status: 'REQUESTED', ...data, id: id('ex') }; t.exception.push(e); return e; },
      updateMany: async ({ where, data }: any) => {
        const rows = t.exception.filter((r) => match(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length };
      },
    },
    rentalDiscrepancy: {
      findMany: async ({ where }: any) => t.discrepancy.filter((r) => match(r, where)),
      findFirst: async ({ where }: any) => t.discrepancy.find((r) => match(r, where)) ?? null,
      create: async ({ data }: any) => { const d = { status: 'OPEN', ...data, id: id('d') }; t.discrepancy.push(d); return d; },
      updateMany: async ({ where, data }: any) => {
        const rows = t.discrepancy.filter((r) => match(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length };
      },
    },
    rentalOrder: {
      findFirst: async ({ where }: any) => {
        const r = t.rental.find((x) => match(x, where));
        return r ? { ...r, product: { id: r.productId, categoryId: r.categoryId ?? null }, rentalUnit: r.rentalUnitId ? { code: 'G-1' } : null } : null;
      },
    },
    adminUser: { findMany: async () => [] },
    category: { findFirst: async ({ where }: any) => (t.category ?? []).find((c: any) => c.id === where.id) ?? null },
  };
  return db;
}

const T = 't1';
// Round 25F D: only an APPROVED template (current version + content hash) is used.
const approved = (t: any) => ({ ...t, version: t.version ?? 1, approvalStatus: 'APPROVED', approvedVersion: t.version ?? 1, approvedHash: templateContentHash(t) });
const gownTemplate = (over: any = {}) => approved({
  id: 'tplG', tenantId: T, isActive: true, deletedAt: null, productId: 'p1', categoryId: null, isDefault: false, version: 3,
  items: [
    { id: 'ti1', label: 'Gown', itemType: 'DISPATCH', quantity: 1, isMandatory: true, requiresCondition: true, sortOrder: 0 },
    { id: 'ti2', label: 'Veil', itemType: 'DISPATCH', quantity: 1, isMandatory: true, requiresCondition: true, sortOrder: 1 },
    { id: 'ti3', label: 'Garment bag', itemType: 'DISPATCH', quantity: 1, isMandatory: false, requiresCondition: false, sortOrder: 2 },
    { id: 'ti4', label: 'Cleaned by shop', itemType: 'RETURN', quantity: 1, isMandatory: true, requiresCondition: true, sortOrder: 3 },
  ],
  ...over,
});
const rental = (over: any = {}) => ({ id: 'r1', tenantId: T, productId: 'p1', status: 'FULLY_PAID', rentalUnitId: 'u1', rentalNumber: 'RN-1', ...over });

async function frozen(seedOver: any = {}) {
  const db = fakeDb({ template: [gownTemplate()], rental: [rental(seedOver)] });
  await freezeSnapshot(db, T, 'r1', null);
  const snap = db.t.snapshot[0];
  const item = (label: string) => snap.items.find((i: any) => i.label === label);
  const rec = (label: string, stage: string, data: any = {}) =>
    db.t.record.push({ id: `x${db.t.record.length}`, tenantId: T, rentalOrderId: 'r1', snapshotItemId: item(label).id, stage, quantity: 1, condition: 'GOOD', rentalUnitId: 'u1', supersedesId: null, recordedById: 'clerk', ...data });
  return { db, snap, item, rec };
}
const code = async (p: Promise<unknown>) => (await p.then(() => null, (e: any) => e))?.getResponse?.();

describe('templates: product → category → shop default (E1)', () => {
  it('picks the most specific active template', async () => {
    const db = fakeDb({
      template: [
        approved({ id: 'dflt', tenantId: T, isActive: true, deletedAt: null, productId: null, categoryId: null, isDefault: true, items: [] }),
        approved({ id: 'cat', tenantId: T, isActive: true, deletedAt: null, productId: null, categoryId: 'c1', items: [] }),
        approved({ id: 'prod', tenantId: T, isActive: true, deletedAt: null, productId: 'p1', categoryId: null, items: [] }),
      ],
    });
    expect((await resolveTemplate(db, T, { id: 'p1', categoryId: 'c1' })).source).toBe('PRODUCT');
    expect((await resolveTemplate(db, T, { id: 'p2', categoryId: 'c1' })).source).toBe('CATEGORY');
    expect((await resolveTemplate(db, T, { id: 'p3', categoryId: 'c9' })).source).toBe('SHOP_DEFAULT');
    expect((await resolveTemplate(fakeDb(), T, { id: 'p3' })).source).toBe('NONE');
  });
});

describe('snapshot fixed at confirmation (E2, E3)', () => {
  it('copies the rules (quantity, mandatory, condition, instructions), the version and the gown; idempotent', async () => {
    const { db, snap } = await frozen();
    expect(snap).toMatchObject({ source: 'PRODUCT', templateVersion: 3, rentalUnitId: 'u1', unitCode: 'G-1' });
    expect(snap.items.map((i: any) => [i.label, i.stage, i.isMandatory])).toEqual([
      ['Gown', 'BOTH', true], ['Veil', 'BOTH', true], ['Garment bag', 'BOTH', false], ['Cleaned by shop', 'RETURN', true],
    ]);
    const again = await freezeSnapshot(db, T, 'r1', 'someone');
    expect(again.created).toBe(false);
    expect(db.t.snapshot).toHaveLength(1);
  });

  it('a template edit after confirmation never changes the booking (copy, not reference)', async () => {
    const { db, snap } = await frozen();
    db.t.template[0].items[0].label = 'Gown (new wording)';
    db.t.template[0].items[0].quantity = 5;
    expect(snap.items[0]).toMatchObject({ label: 'Gown', quantity: 1 });
  });
});

describe('hand-over gate (E4, E7, E8)', () => {
  it('complete hand-over → allowed', async () => {
    const { db, rec } = await frozen();
    rec('Gown', 'HANDOVER'); rec('Veil', 'HANDOVER');
    await expect(assertChecklistReleasable(db, T, { id: 'r1', rentalUnitId: 'u1' }, 'clerk')).resolves.toEqual([]);
  });

  it('one unchecked mandatory item blocks (the optional bag does not)', async () => {
    const { db, rec } = await frozen();
    rec('Gown', 'HANDOVER');
    const r = await code(assertChecklistReleasable(db, T, { id: 'r1', rentalUnitId: 'u1' }, 'clerk'));
    expect(r).toMatchObject({ code: 'CHECKLIST_INCOMPLETE', missing: ['CHECKLIST:Veil'] });
  });

  it('short quantity or "missing" condition blocks', async () => {
    const { db, rec } = await frozen();
    rec('Gown', 'HANDOVER', { quantity: 0 }); rec('Veil', 'HANDOVER', { condition: 'MISSING' });
    expect((await code(assertChecklistReleasable(db, T, { id: 'r1', rentalUnitId: 'u1' })))?.missing).toEqual(['CHECKLIST:Gown', 'CHECKLIST:Veil']);
  });

  it('no snapshot → blocked (a desk snapshot is needed)', async () => {
    const db = fakeDb({ rental: [rental()] });
    expect((await code(assertChecklistReleasable(db, T, { id: 'r1', rentalUnitId: 'u1' })))?.missing).toEqual(['CHECKLIST_SNAPSHOT']);
  });

  it('evidence recorded on another gown does not count after a swap', async () => {
    const { db, rec } = await frozen();
    rec('Gown', 'HANDOVER'); rec('Veil', 'HANDOVER');
    const r = await code(assertChecklistReleasable(db, T, { id: 'r1', rentalUnitId: 'u2' }));
    expect(r?.missing).toEqual(['CHECKLIST:Gown', 'CHECKLIST:Veil']);
  });

  it('an APPROVED exception covers exactly its items; a REQUESTED / REJECTED one covers nothing', async () => {
    const { db, rec, item } = await frozen();
    rec('Gown', 'HANDOVER');
    db.t.exception.push({ id: 'e0', tenantId: T, rentalOrderId: 'r1', kind: 'MISSING', snapshotItemIds: [item('Veil').id], status: 'REQUESTED', requestedById: 'clerk' });
    expect((await code(assertChecklistReleasable(db, T, { id: 'r1', rentalUnitId: 'u1' })))?.missing).toEqual(['CHECKLIST:Veil']);
    db.t.exception[0].status = 'APPROVED'; db.t.exception[0].decidedById = 'manager';
    await expect(assertChecklistReleasable(db, T, { id: 'r1', rentalUnitId: 'u1' }, 'clerk')).resolves.toEqual(['e0']);
  });

  it('the person who approved the exception cannot hand the item over (403)', async () => {
    const { db, rec, item } = await frozen();
    rec('Gown', 'HANDOVER');
    db.t.exception.push({ id: 'e1', tenantId: T, rentalOrderId: 'r1', kind: 'MISSING', snapshotItemIds: [item('Veil').id], status: 'APPROVED', requestedById: 'clerk', decidedById: 'manager' });
    expect(await code(assertChecklistReleasable(db, T, { id: 'r1', rentalUnitId: 'u1' }, 'manager'))).toMatchObject({ code: 'EXCEPTION_DECIDER_HANDING_OVER' });
  });

  it('a USED exception cannot be reused', async () => {
    const { db, rec, item } = await frozen();
    rec('Gown', 'HANDOVER');
    db.t.exception.push({ id: 'e2', tenantId: T, rentalOrderId: 'r1', kind: 'MISSING', snapshotItemIds: [item('Veil').id], status: 'USED', decidedById: 'manager' });
    expect((await code(assertChecklistReleasable(db, T, { id: 'r1', rentalUnitId: 'u1' })))?.missing).toEqual(['CHECKLIST:Veil']);
  });

  it('a corrected record replaces the one it supersedes', async () => {
    const { db, rec } = await frozen();
    rec('Gown', 'HANDOVER', { id: 'g1', condition: 'MISSING' }); rec('Gown', 'HANDOVER', { id: 'g2', supersedesId: 'g1' }); rec('Veil', 'HANDOVER');
    await expect(assertChecklistReleasable(db, T, { id: 'r1', rentalUnitId: 'u1' })).resolves.toEqual([]);
  });
});

describe('return inspection, closure and deposit (E9–E12)', () => {
  it('discrepanciesFor: missing / damaged / altered, per item, compared with what went out', () => {
    const it = { quantity: 2, stage: 'BOTH' };
    expect(discrepanciesFor(it, { quantity: 2, condition: 'GOOD' }, { quantity: 1, condition: 'GOOD' })).toEqual([{ kind: 'MISSING', quantity: 1 }]);
    expect(discrepanciesFor(it, { quantity: 2, condition: 'GOOD' }, { quantity: 2, condition: 'DAMAGED' })).toEqual([{ kind: 'DAMAGED', quantity: 2 }]);
    expect(discrepanciesFor(it, { quantity: 2, condition: 'GOOD' }, { quantity: 2, condition: 'ALTERED' })).toEqual([{ kind: 'ALTERED', quantity: 2 }]);
    expect(discrepanciesFor(it, { quantity: 2, condition: 'DAMAGED' }, { quantity: 2, condition: 'DAMAGED' })).toEqual([]); // already damaged at hand-over
    expect(discrepanciesFor(it, { quantity: 2, condition: 'GOOD' }, { quantity: 0, condition: 'MISSING' })).toEqual([{ kind: 'MISSING', quantity: 2 }]);
    expect(discrepanciesFor(it, { quantity: 2, condition: 'GOOD' }, { quantity: 2, condition: 'MINOR_WEAR' })).toEqual([]);
  });

  it('closing needs every item inspected and nothing open', async () => {
    const { db, rec } = await frozen({ status: 'INSPECTION' });
    rec('Gown', 'RETURN');
    expect(await code(assertInspectionComplete(db, T, 'r1', 'CLOSE'))).toMatchObject({ code: 'INSPECTION_INCOMPLETE' });
    rec('Veil', 'RETURN'); rec('Garment bag', 'RETURN'); rec('Cleaned by shop', 'RETURN');
    db.t.discrepancy.push({ id: 'd1', tenantId: T, rentalOrderId: 'r1', status: 'OPEN' });
    expect(await code(assertInspectionComplete(db, T, 'r1', 'CLOSE'))).toMatchObject({ code: 'DISCREPANCY_OPEN' });
    db.t.discrepancy[0].status = 'RESOLVED_NO_CHARGE';
    await expect(assertInspectionComplete(db, T, 'r1', 'CLOSE')).resolves.toBeTruthy();
  });

  it('the deposit can keep money only for a discrepancy resolved as deducted (no automatic penalty)', async () => {
    const { db, rec } = await frozen({ status: 'INSPECTION' });
    for (const l of ['Gown', 'Veil', 'Garment bag', 'Cleaned by shop']) rec(l, 'RETURN');
    await expect(assertDepositSettleable(db, T, 'r1', 0)).resolves.toBeTruthy();
    expect(await code(assertDepositSettleable(db, T, 'r1', 5000))).toMatchObject({ code: 'RETENTION_WITHOUT_DISCREPANCY' });
    db.t.discrepancy.push({ id: 'd1', tenantId: T, rentalOrderId: 'r1', status: 'RESOLVED_DEDUCTED' });
    await expect(assertDepositSettleable(db, T, 'r1', 5000)).resolves.toBeTruthy();
  });
});

describe('evidence service: append-only, no silent overwrite (E5, E6, E10, E15)', () => {
  const audit = { log: jest.fn() };
  const make = async (status = 'FULLY_PAID') => {
    const f = await frozen({ status });
    return { ...f, svc: new RentalChecklistV2Service(f.db, { requireId: T } as any, audit as any) };
  };

  it('records who and when; a second person recording the same item without naming the current record → 409', async () => {
    const { svc, item, db } = await make();
    await svc.record('r1', { stage: 'HANDOVER', entries: [{ snapshotItemId: item('Gown').id, quantity: 1, condition: 'GOOD' }] }, { id: 'clerkA' });
    expect(db.t.record[0]).toMatchObject({ recordedById: 'clerkA', rentalUnitId: 'u1', stage: 'HANDOVER' });
    const e = await code(svc.record('r1', { stage: 'HANDOVER', entries: [{ snapshotItemId: item('Gown').id, quantity: 1, condition: 'DAMAGED' }] }, { id: 'clerkB' }));
    expect(e).toMatchObject({ code: 'CHECKLIST_CHANGED', currentRecordId: db.t.record[0].id });
    expect(db.t.record).toHaveLength(1);
  });

  it('a correction adds a row and keeps the original (never rewritten or deleted)', async () => {
    const { svc, item, db } = await make();
    await svc.record('r1', { stage: 'HANDOVER', entries: [{ snapshotItemId: item('Gown').id, quantity: 1, condition: 'GOOD' }] }, { id: 'clerkA' });
    const first = { ...db.t.record[0] };
    await svc.record('r1', { stage: 'HANDOVER', entries: [{ snapshotItemId: item('Gown').id, quantity: 1, condition: 'MINOR_WEAR', supersedesId: first.id }] }, { id: 'clerkB' });
    expect(db.t.record).toHaveLength(2);
    expect(db.t.record[0]).toEqual(first);
    // two people correcting the same record: the second one loses
    const e = await code(svc.record('r1', { stage: 'HANDOVER', entries: [{ snapshotItemId: item('Gown').id, quantity: 1, condition: 'GOOD', supersedesId: first.id }] }, { id: 'clerkC' }));
    expect(e?.code).toBe('CHECKLIST_CHANGED');
  });

  it('condition is required where the template says so; hand-over evidence is closed once the item left', async () => {
    const { svc, item } = await make();
    await expect(svc.record('r1', { stage: 'HANDOVER', entries: [{ snapshotItemId: item('Gown').id, quantity: 1 }] }, { id: 'c' })).rejects.toThrow(/condition/);
    const left = await make('ACTIVE');
    expect(await code(left.svc.record('r1', { stage: 'HANDOVER', entries: [{ snapshotItemId: left.item('Gown').id, quantity: 1, condition: 'GOOD' }] }, { id: 'c' }))).toMatchObject({ code: 'CHECKLIST_STAGE_CLOSED' });
  });

  it('return records open one discrepancy per item; a reviewer other than the inspector resolves it', async () => {
    const { svc, item, db, rec } = await make('RETURNED');
    rec('Gown', 'HANDOVER'); rec('Veil', 'HANDOVER');
    await svc.record('r1', { stage: 'RETURN', entries: [
      { snapshotItemId: item('Gown').id, quantity: 1, condition: 'DAMAGED', note: 'tear at hem' },
      { snapshotItemId: item('Veil').id, quantity: 0, condition: 'MISSING' },
    ] }, { id: 'inspector' });
    expect(db.t.discrepancy.map((d: any) => [d.kind, d.status])).toEqual([['DAMAGED', 'OPEN'], ['MISSING', 'OPEN']]);
    expect(await code(svc.resolveDiscrepancy(db.t.discrepancy[0].id, { resolution: 'RESOLVED_DEDUCTED', note: 'repair quote' }, { id: 'inspector' }))).toMatchObject({ code: 'SELF_REVIEW' });
    await svc.resolveDiscrepancy(db.t.discrepancy[0].id, { resolution: 'RESOLVED_DEDUCTED', note: 'repair quote' }, { id: 'manager' });
    expect(db.t.discrepancy[0]).toMatchObject({ status: 'RESOLVED_DEDUCTED', resolvedById: 'manager' });
  });

  it('exceptions: requester cannot decide (403); only mandatory hand-over items of this booking', async () => {
    const { svc, item } = await make();
    const ex = await svc.requestException('r1', { kind: 'MISSING', snapshotItemIds: [item('Veil').id], reason: 'Veil at the cleaners, customer agreed' }, { id: 'clerk' });
    expect(await code(svc.decideException(ex.id, true, {}, { id: 'clerk' }))).toMatchObject({ code: 'SELF_APPROVAL' });
    await expect(svc.requestException('r1', { kind: 'MISSING', snapshotItemIds: [item('Garment bag').id], reason: 'optional item, not needed' }, { id: 'clerk' })).rejects.toThrow(/mandatory/);
    const ok: any = await svc.decideException(ex.id, true, { note: 'fine' }, { id: 'manager' });
    expect(ok).toMatchObject({ status: 'APPROVED', decidedById: 'manager' });
  });
});

describe('shape: the gates are in the write path, on every route (E13, F)', () => {
  const read = (p: string) => readFileSync(join(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
  const svc = read('../rentals.service.ts');
  it('updateStatus checks the checklist and declares it to the database in the SAME transaction as the write', () => {
    const body = svc.slice(svc.indexOf('const write = async (tx: any) =>'), svc.indexOf('} catch (e: any) {', svc.indexOf('const write = async (tx: any) =>')));
    expect(body).toMatch(/lockChecklist\(tx, id\);\s*usedExceptions = await assertChecklistReleasable\(tx,[^;]+;\s*await declareGatePassed\(tx, 'handover', id, user\?\.id \?\? null\)/);
    expect(body).toMatch(/assertInspectionComplete\(tx, tenantIdForClaim, id, 'CLOSE'\);\s*await declareGatePassed\(tx, 'close', id, user\?\.id \?\? null\)/);
    expect(body).toMatch(/rentalUnitId: rental\.rentalUnitId \?\? null/);
    expect(svc).toMatch(/isRelease \|\| status === 'CLOSED' \|\| status === 'CANCELLED' \? await this\.prisma\.\$transaction\(write\)/);
  });
  it('the deposit return checks the inspection and declares it inside the request transaction', () => {
    const m = read('../rental-money.service.ts');
    expect(m).toMatch(/await lockChecklist\(tx, rentalOrderId\);\s*await assertDepositSettleable\(tx, tenantId, rentalOrderId, retained\);\s*await declareGatePassed\(tx, 'deposit', rentalOrderId, actor\.id\)/);
  });
  it('the migration installs the database triggers (fail closed for every build)', () => {
    const sql = readFileSync(join(__dirname, '../../../../../packages/database/prisma/migrations/20261115090000_rental_checklist_v2/migration.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TRIGGER naro_r3_rental_gate\s+BEFORE UPDATE OF status ON "RentalOrder"/);
    expect(sql).toMatch(/CREATE TRIGGER naro_r3_deposit_gate\s+BEFORE INSERT ON "RentalRefundRequest"/);
    expect(sql).toMatch(/current_setting\('naro\.r3_handover', true\)/);
    expect(sql).toMatch(/CREATE TABLE "RentalChecklistSnapshot"/); // the R1 marker table name
  });
  it('the core sets exactly the settings the triggers read', () => {
    expect(read('checklist-core.ts')).toMatch(/const key = `naro\.r3_\$\{step\}`/);
    expect(read('checklist-core.ts')).toMatch(/\$\{rentalOrderId\} \|\| ':' \|\| txid_current\(\)::text \|\| ':' \|\| \$\{actor\}/);
  });
  it('new permissions are seeded and never role defaults', () => {
    for (const c of ['rentals:checklist-verify', 'rentals:checklist-exception', 'rentals:checklist-templates']) {
      expect(read('../../permissions/permissions.service.ts')).toContain(`{ code: '${c}'`);
      expect(MANAGER_EXCLUDED).toContain(c);
    }
  });
  it('the v1 tick-box routes are retired (410) and template edits need rentals:checklist-templates', () => {
    const c = read('../../rental-checklists/rental-checklists.controller.ts');
    expect((c.match(/throw new GoneException\(V1_GONE\)/g) ?? []).length).toBe(3);
    for (const route of ["@Post('templates')", "@Put('templates/:id')", "@Delete('templates/:id')", "@Patch('templates/:id/toggle-active')", "@Patch('templates/:id/restore')"]) {
      expect(c).toMatch(new RegExp(route.replace(/[()/:]/g, (m) => `\\${m}`) + "\\s*\\n\\s*@RequiresPermission\\('rentals:checklist-templates'\\)"));
    }
  });
});


describe('round 25C B: what was physically issued is what must come back', () => {
  const audit = { log: jest.fn() };
  it('a category list is found through the parent categories (Wedding Dresses > Ball Gown)', async () => {
    const db = fakeDb({
      template: [approved({ id: 'wd', tenantId: T, isActive: true, deletedAt: null, productId: null, categoryId: 'wedding', items: [] })],
      category: [{ id: 'ballgown', parentId: 'wedding' }, { id: 'wedding', parentId: null }],
    } as any);
    expect(await resolveTemplate(db, T, { id: 'p9', categoryId: 'ballgown' })).toMatchObject({ source: 'CATEGORY', template: { id: 'wd' } });
  });

  it('an accessory omitted under an approved exception: the original requirement stays, nothing is expected back, no discrepancy for not returning it', async () => {
    const f = await frozen({ status: 'RETURNED' });
    f.rec('Gown', 'HANDOVER');
    f.rec('Garment bag', 'HANDOVER', { quantity: 1, condition: null });
    f.db.t.exception.push({ id: 'e1', tenantId: T, rentalOrderId: 'r1', kind: 'MISSING', snapshotItemIds: [f.item('Veil').id], status: 'USED', decidedById: 'mgr' });
    const svc = new RentalChecklistV2Service(f.db, { requireId: T } as any, audit as any);
    const st: any = await svc.state('r1');
    const veil = st.items.find((i: any) => i.label === 'Veil');
    expect([veil.quantity, veil.isMandatory, veil.issuedQuantity, veil.expectedReturn, veil.exception?.kind]).toEqual([1, true, 0, 0, 'MISSING']);
    expect(st.items.find((i: any) => i.label === 'Garment bag')).toMatchObject({ issuedQuantity: 1, expectedReturn: 1 });
    expect(st.inspection.notInspected).not.toContain('Veil');
    // Return what was issued: gown and bag back; the veil (never issued) is not asked for.
    await svc.record('r1', { stage: 'RETURN', entries: [
      { snapshotItemId: f.item('Gown').id, quantity: 1, condition: 'GOOD' },
      { snapshotItemId: f.item('Garment bag').id, quantity: 1 },
      { snapshotItemId: f.item('Cleaned by shop').id, quantity: 1, condition: 'GOOD' },
    ] }, { id: 'inspector' });
    expect(f.db.t.discrepancy).toHaveLength(0);
    await expect(assertInspectionComplete(f.db, T, 'r1', 'CLOSE')).resolves.toBeTruthy();
  });

  it('an ISSUED accessory that does not come back opens a MISSING discrepancy for that item only', async () => {
    const f = await frozen({ status: 'RETURNED' });
    f.rec('Gown', 'HANDOVER'); f.rec('Veil', 'HANDOVER'); f.rec('Garment bag', 'HANDOVER', { condition: null });
    const svc = new RentalChecklistV2Service(f.db, { requireId: T } as any, audit as any);
    await svc.record('r1', { stage: 'RETURN', entries: [
      { snapshotItemId: f.item('Gown').id, quantity: 1, condition: 'GOOD' },
      { snapshotItemId: f.item('Veil').id, quantity: 0, condition: 'MISSING' },
      { snapshotItemId: f.item('Garment bag').id, quantity: 1 },
    ] }, { id: 'inspector' });
    expect(f.db.t.discrepancy.map((d: any) => [d.kind, d.quantity, d.snapshotItemId])).toEqual([['MISSING', 1, f.item('Veil').id]]);
  });

  it('application code never writes gate overrides (they are created only by the owner recovery procedure)', () => {
    const { execSync } = require('child_process');
    const hits = execSync('git grep -n "rentalGateOverride\.\(create\|update\|upsert\|delete\)" -- "apps/api/src/*.ts" || true', { cwd: join(__dirname, '../../../../..'), encoding: 'utf8' }).trim();
    expect(hits).toBe('');
  });
});

describe('round 25F D: two-person template activation', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { RentalChecklistsService } = require('../../rental-checklists/rental-checklists.service');
  const draft = (over: any = {}) => ({ ...gownTemplate(), approvalStatus: 'DRAFT', approvedVersion: null, approvedHash: null, draftAuthorIds: ['editor'], ...over });
  const tplSvc = (row: any) => {
    const audit = { log: jest.fn(async () => undefined) };
    const prisma: any = {
      rentalChecklistTemplate: {
        findFirst: jest.fn(async () => row),
        updateMany: jest.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }),
      },
    };
    return { svc: new RentalChecklistsService(prisma, { requireId: T } as any, audit as any), prisma, audit };
  };
  const confirmAll = (t: any) => ({
    version: t.version, hash: templateContentHash(t), scope: { productId: t.productId, categoryId: t.categoryId },
    confirmedItems: t.items.map((i: any) => ({ itemId: i.id, quantity: i.quantity })),
  });

  it('a DRAFT (or WITHDRAWN) most-specific template is never snapshotted and never falls back to a less specific list', async () => {
    for (const status of ['DRAFT', 'WITHDRAWN']) {
      const db = fakeDb({
        template: [approved({ id: 'dflt', tenantId: T, isActive: true, deletedAt: null, productId: null, categoryId: null, isDefault: true, items: [{ id: 'x', label: 'Bag', itemType: 'DISPATCH', quantity: 1, sortOrder: 0 }] }),
          draft({ approvalStatus: status })],
        rental: [rental()],
      });
      expect(await resolveTemplate(db, T, { id: 'p1' })).toMatchObject({ template: null, source: 'UNAPPROVED', pending: { id: 'tplG', status } });
      const res = await freezeSnapshot(db, T, 'r1', null);
      expect([res.created, res.snapshot, db.t.snapshot.length]).toEqual([false, null, 0]);
      expect((await code(assertChecklistReleasable(db, T, { id: 'r1', rentalUnitId: 'u1' }, 'clerk')))?.missing).toContain('CHECKLIST_SNAPSHOT');
    }
  });
  it('an approved template whose content changed since approval (hash mismatch) is treated as unapproved', async () => {
    const t = gownTemplate();
    t.items[1].quantity = 2; // edited behind the approval
    const db = fakeDb({ template: [t], rental: [rental()] });
    expect((await resolveTemplate(db, T, { id: 'p1' })).source).toBe('UNAPPROVED');
  });
  it('the snapshot records the approved version + hash; later edits never change it', async () => {
    const { db, snap } = await frozen();
    expect([snap.templateVersion, snap.templateHash]).toEqual([3, db.t.template[0].approvedHash]);
    db.t.template[0].items[1].quantity = 9; db.t.template[0].approvalStatus = 'DRAFT';
    expect(snap.items[1]).toMatchObject({ label: 'Veil', quantity: 1 });
  });
  it('approval by a person who prepared this version → 403 SELF_APPROVAL (SUPER_ADMIN included: no role bypass), audited', async () => {
    const { svc, audit, prisma } = tplSvc(draft({ draftAuthorIds: ['editor', 'owner-super'] }));
    for (const who of ['editor', 'owner-super']) {
      const e: any = await svc.approveTemplate('tplG', confirmAll(draft()), { id: who }).catch((x: any) => x);
      expect(e?.getResponse?.().code).toBe('SELF_APPROVAL');
    }
    expect(prisma.rentalChecklistTemplate.updateMany).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith('TEMPLATE_APPROVAL_DENIED', 'RentalChecklistTemplate', 'tplG', expect.objectContaining({ reason: 'SELF_APPROVAL' }));
  });
  it('approval must name the CURRENT version and hash (409 TEMPLATE_CHANGED) and confirm EVERY item quantity and the scope (400)', async () => {
    const t = draft();
    const { svc, prisma } = tplSvc(t);
    const stale: any = await svc.approveTemplate('tplG', { ...confirmAll(t), hash: '0'.repeat(64) }, { id: 'reviewer' }).catch((x: any) => x);
    expect(stale?.getResponse?.().code).toBe('TEMPLATE_CHANGED');
    const oldVersion: any = await svc.approveTemplate('tplG', { ...confirmAll(t), version: 2 }, { id: 'reviewer' }).catch((x: any) => x);
    expect(oldVersion?.getResponse?.().code).toBe('TEMPLATE_CHANGED');
    const wrongQty: any = await svc.approveTemplate('tplG', { ...confirmAll(t), confirmedItems: confirmAll(t).confirmedItems.map((c: any, n: number) => (n === 1 ? { ...c, quantity: 2 } : c)) }, { id: 'reviewer' }).catch((x: any) => x);
    expect([wrongQty?.getResponse?.().code, wrongQty?.getResponse?.().problems]).toEqual(['ITEMS_NOT_CONFIRMED', ['Veil × 1']]);
    const missing: any = await svc.approveTemplate('tplG', { ...confirmAll(t), confirmedItems: confirmAll(t).confirmedItems.slice(1) }, { id: 'reviewer' }).catch((x: any) => x);
    expect(missing?.getResponse?.().problems).toEqual(['Gown × 1']);
    const scope: any = await svc.approveTemplate('tplG', { ...confirmAll(t), scope: { productId: 'p2', categoryId: null } }, { id: 'reviewer' }).catch((x: any) => x);
    expect(scope?.getResponse?.().code).toBe('ITEMS_NOT_CONFIRMED');
    expect(prisma.rentalChecklistTemplate.updateMany).not.toHaveBeenCalled();
  });
  it('a different person who confirms everything approves the exact version + hash (audited with the items)', async () => {
    const t = draft();
    const { svc, prisma, audit } = tplSvc(t);
    await svc.approveTemplate('tplG', confirmAll(t), { id: 'reviewer' });
    expect(prisma.rentalChecklistTemplate.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'tplG', tenantId: T, version: 3, approvalStatus: 'DRAFT' },
      data: { approvalStatus: 'APPROVED', approvedVersion: 3, approvedHash: templateContentHash(t), approvedById: 'reviewer' },
    });
    expect(audit.log).toHaveBeenCalledWith('TEMPLATE_APPROVED', 'RentalChecklistTemplate', 'tplG', expect.objectContaining({ version: 3, hash: templateContentHash(t) }));
    expect(t.approvalStatus).toBe('APPROVED');
  });
  it('withdrawal (audited) stops new snapshots', async () => {
    const t = gownTemplate();
    const { svc, audit } = tplSvc(t);
    await svc.withdrawTemplate('tplG', { reason: 'veil no longer lent with this gown' }, { id: 'reviewer' });
    expect(t.approvalStatus).toBe('WITHDRAWN');
    expect(audit.log).toHaveBeenCalledWith('TEMPLATE_WITHDRAWN', 'RentalChecklistTemplate', 'tplG', expect.objectContaining({ previousStatus: 'APPROVED' }));
    const db = fakeDb({ template: [t], rental: [rental()] });
    expect((await freezeSnapshot(db, T, 'r1', null)).created).toBe(false);
  });
  it('an edit of an APPROVED template returns it to DRAFT with the editor as author, audited TEMPLATE_CORRECTED', async () => {
    const t: any = { ...gownTemplate(), draftAuthorIds: ['editor'] };
    const audit = { log: jest.fn(async () => undefined) };
    const tx: any = {
      rentalChecklistTemplateItem: { deleteMany: jest.fn() },
      rentalChecklistTemplate: { update: jest.fn(async ({ data }: any) => ({ ...t, ...data, version: t.version + 1, items: t.items })) },
    };
    const prisma: any = { rentalChecklistTemplate: { findFirst: jest.fn(async () => t) }, $transaction: async (fn: any) => fn(tx) };
    const svc = new RentalChecklistsService(prisma, { requireId: T } as any, audit as any);
    await svc.updateTemplate('tplG', { name: 'Gown set v4' }, 'editor2');
    expect(tx.rentalChecklistTemplate.update.mock.calls[0][0].data).toMatchObject({ approvalStatus: 'DRAFT', draftAuthorIds: ['editor2'] });
    expect(audit.log).toHaveBeenCalledWith('TEMPLATE_CORRECTED', 'RentalChecklistTemplate', 'tplG', expect.objectContaining({ fromApprovedVersion: 3, status: 'DRAFT' }));
  });
  it('the hash is the one the database computes (same canonical form as naro_r3_template_hash)', () => {
    const m = readFileSync(join(__dirname, '../../../../../packages/database/prisma/migrations/20261118090000_checklist_template_approval/migration.sql'), 'utf8');
    expect(m).toMatch(/'scope:' \|\| coalesce\(p_product, ''\)/);
    expect(m).toMatch(/ORDER BY i\."sortOrder", i\.id COLLATE "C"/);
    expect(m).toMatch(/SECURITY DEFINER SET search_path/);
    expect(templateContentHash({ productId: 'p1', categoryId: null, isDefault: false, items: [] })).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rentals:checklist-approve exists, is needed to approve, and is never auto-granted (MANAGER_EXCLUDED)', () => {
    expect(MANAGER_EXCLUDED).toContain('rentals:checklist-approve');
    const c = readFileSync(join(__dirname, '../../rental-checklists/rental-checklists.controller.ts'), 'utf8');
    expect(c).toMatch(/@Post\('templates\/:id\/approve'\)\s*\n\s*@RequiresPermission\('rentals:checklist-approve'\)/);
  });
});

