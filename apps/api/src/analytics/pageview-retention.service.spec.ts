import { PageViewRetentionService, resolveRetentionDays } from './pageview-retention.service';

describe('PageView retention', () => {
  afterEach(() => {
    delete process.env.PAGEVIEW_RETENTION_DAYS;
  });

  it('deletes rows older than the retention window, in batches', async () => {
    const batches = [
      Array.from({ length: 5000 }, (_, i) => ({ id: `a${i}` })),
      [{ id: 'b1' }, { id: 'b2' }],
    ];
    const prisma: any = {
      pageView: {
        findMany: jest.fn(async () => batches.shift() ?? []),
        deleteMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
      },
    };
    const svc = new PageViewRetentionService(prisma);
    const now = new Date('2026-10-04T03:30:00Z');
    const total = await svc.prune(now);
    expect(total).toBe(5002);
    expect(prisma.pageView.deleteMany).toHaveBeenCalledTimes(2);
    const cutoff: Date = prisma.pageView.findMany.mock.calls[0][0].where.createdAt.lt;
    expect(now.getTime() - cutoff.getTime()).toBe(400 * 24 * 60 * 60 * 1000);
  });

  it('honours PAGEVIEW_RETENTION_DAYS and refuses dangerously small values', () => {
    expect(resolveRetentionDays(undefined)).toBe(400);
    expect(resolveRetentionDays('730')).toBe(730);
    expect(resolveRetentionDays('5')).toBe(400);
    expect(resolveRetentionDays('junk')).toBe(400);
  });

  it('is scheduled daily at 03:30', () => {
    const meta = Reflect.getMetadataKeys(PageViewRetentionService.prototype.handleCron).map(String);
    expect(meta.length).toBeGreaterThan(0);
    const src = require('fs').readFileSync(require('path').join(__dirname, 'pageview-retention.service.ts'), 'utf8');
    expect(src).toMatch(/@Cron\('30 3 \* \* \*'/);
  });
});
