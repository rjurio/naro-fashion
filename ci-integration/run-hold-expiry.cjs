// Run the REAL rental hold-expiry job (SchedulerService.handleExpiredRentalHolds,
// PR #16 rules) once, from the built API, against the isolated schema. Local only.
//   DATABASE_URL=...?schema=it_pos node run-hold-expiry.cjs <worktree>
const path = require('path');
if (!/schema=it_(pos|ref)\b/.test(process.env.DATABASE_URL || '') || !/@localhost[:/]/.test(process.env.DATABASE_URL)) {
  throw new Error('refusing: DATABASE_URL must be a local isolated schema');
}
const api = path.join(process.argv[2], 'apps', 'api');
process.chdir(api);
const { NestFactory } = require(path.join(api, 'node_modules', '@nestjs', 'core'));
const { AppModule } = require(path.join(api, 'dist', 'app.module'));
const { SchedulerService } = require(path.join(api, 'dist', 'scheduler', 'scheduler.service'));
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const n = await app.get(SchedulerService).handleExpiredRentalHolds(new Date());
  console.log(JSON.stringify({ processed: n }));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
