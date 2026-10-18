// One-off repair: restore the tables on the CMS "size-guide" page.
//
// Why: the admin RichTextEditor (Quill) can't represent tables. Opening the
// page in Visual mode flattened every table cell into its own <p> and turned
// spaces into &nbsp;, and the next save stored that. The editor now keeps
// table content in HTML mode (RichTextEditor.tsx); this puts the tables back.
//
// Writes `content` / `contentSwahili` from scripts/content/size-guide.{en,sw}.html
// for the given tenant's page with slug `size-guide`. Prints the before/after
// lengths; --dry-run prints without writing.
//
// Usage (on VPS):
//   cd /var/www/naro-fashion && node scripts/restore-size-guide-tables.js naro-fashion --dry-run
//   cd /var/www/naro-fashion && node scripts/restore-size-guide-tables.js naro-fashion

const path = require('path');
const fs = require('fs');

const { PrismaClient } = require(path.join(__dirname, '..', 'packages', 'database', 'node_modules', '@prisma', 'client'));

const slug = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!slug || slug.startsWith('--')) {
  console.error('Usage: node scripts/restore-size-guide-tables.js <tenantSlug> [--dry-run]');
  process.exit(1);
}

const read = (f) => fs.readFileSync(path.join(__dirname, 'content', f), 'utf8').trim();
const content = read('size-guide.en.html');
const contentSwahili = read('size-guide.sw.html');

(async () => {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) throw new Error(`Tenant not found: ${slug}`);
    const page = await prisma.page.findFirst({
      where: { tenantId: tenant.id, slug: 'size-guide', deletedAt: null },
      select: { id: true, content: true, contentSwahili: true },
    });
    if (!page) throw new Error('size-guide page not found for this tenant');

    console.log(`Page ${page.id}: content ${page.content?.length ?? 0} → ${content.length} chars, ` +
      `contentSwahili ${page.contentSwahili?.length ?? 0} → ${contentSwahili.length} chars`);
    if (dryRun) {
      console.log('--dry-run: no changes written');
      return;
    }
    await prisma.page.update({ where: { id: page.id }, data: { content, contentSwahili } });
    console.log('Size guide tables restored.');
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
