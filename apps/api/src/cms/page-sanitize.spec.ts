import { CmsService } from './cms.service';
import { sanitizeRichText } from '../common/sanitize-html.util';

/**
 * CMS pages: the English AND Swahili bodies are both rendered as HTML
 * (storefront /pages/[slug] via dangerouslySetInnerHTML), so both must go
 * through the same write-time sanitizer. Before this fix only `content` was
 * sanitized; `contentSwahili` was stored exactly as sent.
 */
function make(existing: any = { id: 'pg1', tenantId: 't1', deletedAt: null }) {
  const prisma: any = {
    page: {
      create: jest.fn(async ({ data }: any) => ({ id: 'pg1', ...data })),
      findFirst: jest.fn(async () => existing),
      update: jest.fn(async ({ data }: any) => ({ ...existing, ...data })),
    },
  };
  const svc = new CmsService(prisma, {} as any, { requireId: 't1' } as any, { log: jest.fn() } as any);
  return { svc, prisma };
}

const DANGEROUS: Record<string, RegExp> = {
  '<p>Karibu</p><script>alert(1)</script>': /<script|alert\(1\)/i,
  '<img src="x" onerror="fetch(\'//evil\')">': /onerror/i,
  '<a href="javascript:alert(1)">bofya</a>': /javascript:/i,
  '<img src="data:text/html,<script>alert(1)</script>">': /data:/i,
  '<svg onload="alert(1)"></svg>': /onload|<svg/i,
  '<iframe src="https://evil.example"></iframe>': /<iframe/i,
  '<p style="x" onclick="steal()">Bonyeza</p>': /onclick/i,
  '<style>body{display:none}</style><p>ok</p>': /<style|display:none/i,
};

// Formatting the admin editor (Quill) produces: must survive unchanged.
const LEGIT =
  '<h2>Maswali Yanayoulizwa Mara kwa Mara</h2><p>Pata majibu ya maswali unayouliza mara kwa mara.</p>' +
  '<h3>Ninawezaje kukodi bidhaa?</h3><p>Chagua bidhaa unayotaka kukodi na tarehe za kukodi, kisha tuma ombi lako.</p>' +
  '<p class="ql-align-center"><strong>Muhimu</strong> na <em>italiki</em> na <u>mstari</u></p>' +
  '<ol><li>moja</li><li>mbili</li></ol><ul><li>tatu</li></ul>' +
  '<p>1. Hatua ya kwanza<br>\n2. Hatua ya pili</p>' +
  '<blockquote>Nukuu</blockquote><p><a href="https://narofashion.co.tz/rentals" rel="noopener noreferrer" target="_blank">Kodi sasa</a></p>';

describe('CMS page HTML is sanitized in BOTH languages', () => {
  it.each(Object.entries(DANGEROUS))('create: %s is neutralised in content AND contentSwahili', async (input, bad) => {
    const { svc, prisma } = make();
    await svc.createPage({ title: 'FAQ', slug: 'faq', content: input, contentSwahili: input });
    const data = prisma.page.create.mock.calls[0][0].data;
    expect(data.content).not.toMatch(bad);
    expect(data.contentSwahili).not.toMatch(bad);
    expect(data.contentSwahili).toBe(data.content); // identical treatment
  });

  it.each(Object.entries(DANGEROUS))('update: %s is neutralised in content AND contentSwahili', async (input, bad) => {
    const { svc, prisma } = make();
    await svc.updatePage('pg1', { content: input, contentSwahili: input });
    const data = prisma.page.update.mock.calls[0][0].data;
    expect(data.content).not.toMatch(bad);
    expect(data.contentSwahili).not.toMatch(bad);
    expect(data.contentSwahili).toBe(data.content);
  });

  it('allowed formatting is kept byte for byte in both languages', async () => {
    const { svc, prisma } = make();
    await svc.updatePage('pg1', { content: LEGIT, contentSwahili: LEGIT });
    const data = prisma.page.update.mock.calls[0][0].data;
    expect(data.content).toBe(LEGIT);
    expect(data.contentSwahili).toBe(LEGIT);
  });

  it('a field not sent is not rewritten (no unasked change to stored content)', async () => {
    const { svc, prisma } = make();
    await svc.updatePage('pg1', { content: '<p>EN only</p>' });
    const data = prisma.page.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('contentSwahili');
    await svc.updatePage('pg1', { contentSwahili: '<p>SW only</p>' });
    expect(prisma.page.update.mock.calls[1][0].data).not.toHaveProperty('content');
  });

  it('a page created without Swahili stores none (not an empty string)', async () => {
    const { svc, prisma } = make();
    await svc.createPage({ title: 'About', slug: 'about', content: '<p>x</p>' });
    expect(prisma.page.create.mock.calls[0][0].data).not.toHaveProperty('contentSwahili');
  });

  it('an empty Swahili body stays empty (the storefront then falls back to English)', async () => {
    const { svc, prisma } = make();
    await svc.updatePage('pg1', { contentSwahili: '' });
    expect(prisma.page.update.mock.calls[0][0].data.contentSwahili).toBe('');
  });

  it('the sanitizer is idempotent, so re-saving already-clean content never changes it', () => {
    for (const input of [LEGIT, ...Object.keys(DANGEROUS)]) {
      const once = sanitizeRichText(input);
      expect(sanitizeRichText(once)).toBe(once);
    }
  });
});
