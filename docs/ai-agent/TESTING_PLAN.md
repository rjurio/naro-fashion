# Naro Fashion — AI Agent Testing Plan

The agent is allowed to perform real writes against the production database. Tests must therefore prove — before each phase ships — that the safety boundaries hold under both normal use and adversarial input.

> **Repo state:** as of 2026-05, there are zero existing test files in the monorepo (no `*.spec.*`, no `*.test.*`, no jest/vitest configs — confirmed by Glob). The AI agent rollout is the right occasion to add a Jest-based test setup to `apps/api/`. Phase 1 includes the scaffolding cost.

## Layers

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Jest (NestJS standard) | Sanitiser, hash, envelope, DTO validators |
| Service | Jest + an in-memory PrismaTestClient (or a disposable `naro_fashion_test` schema) | Each AI service method end-to-end |
| HTTP | Supertest against the booted Nest app | Auth, permissions, modules, approval flow |
| Tenant isolation | Supertest with two seeded tenants A/B | Cross-tenant access attempts return 403/404 |
| Approval flow | Supertest scenarios | Two-phase commit, expiry, replay, payload tampering |
| Destructive action | Supertest against staging DB | Dry-run + rollback for `permanently_delete_record` |
| Audit | Supertest assertions on `AgentAuditLog` rows | Every endpoint writes exactly one row, redaction works |
| Manual prod safety | Runbook checklist | Pre-flight before any AI agent deploy |

## Required infrastructure (Phase 1 work, beyond docs)

- `apps/api/jest.config.ts` (NestJS preset, `testRegex: '\\.spec\\.ts$'`).
- `apps/api/test/setup.ts` — boots a `naro_fashion_test` Postgres schema, runs `prisma db push`, seeds two tenants + admin / staff / customer fixtures.
- `apps/api/test/fixtures/` — sample products, orders, rentals, deleted records.
- `apps/api/test/helpers/auth.ts` — mints JWTs for the four roles (PlatformAdmin, SUPER_ADMIN, MANAGER, STAFF, customer).
- CI: extend `.github/workflows/deploy-prod.yml` (or add a separate `ci.yml`) to run `pnpm --filter api test` on PRs to `master` / `prod`.

## Unit tests (per file)

### `apps/api/src/ai/util/audit-sanitise.spec.ts`
- `password`, `passwordHash`, `passwordResetToken` keys are dropped.
- `secret`, `apiKey`, `clientSecret`, `webhookSecret`, `Authorization`, `Bearer`, `token` keys (case-insensitive) are dropped.
- `approvalToken` is preserved (it's already consumed when logged).
- Strings > 4096 chars are truncated with `… (truncated)`.
- Arrays > 200 items truncated to first 200 + `…`.
- Whole payload > 64KB → `{ truncated: true, originalSize, sample }`.
- Image URLs preserved; raw base64 image bodies replaced with `<binary>`.

### `apps/api/src/ai/util/payload-hash.spec.ts`
- Same input, two different key orders → identical hash.
- One field changed → hash changes.
- Nested object key reordering → identical hash.
- Numbers/strings/booleans/null/arrays all canonicalise.

### `apps/api/src/ai/util/ai-envelope.interceptor.spec.ts`
- Success → `{ ok: true, output, audit: { id, loggedAt } }`.
- ForbiddenException → `{ ok: false, error: 'permission_denied' }`.
- BadRequestException with `error: 'approval_required'` from a service → `{ ok: false, error: 'approval_required', approvalRequest }` envelope.

## Service tests

### `apps/api/src/ai/services/agent-audit.service.spec.ts`
- Writes one row per call.
- `READ` actions don't double-write to `AdminActivityLog`.
- `SUCCESS` write actions DO double-write.
- Sanitised `inputJson`/`outputJson` (verify keys removed).
- Honours `agentSessionId` from `X-Agent-Session-Id` header.
- Bails silently if `req.user.sub` is null (no row written).

### `apps/api/src/ai/services/agent-approval.service.spec.ts`
- Issues a request with default 5-min TTL.
- Issues a request with 60-second TTL when `tool === 'permanently_delete_record'`.
- Approve flips status, sets token, sets `approvedBy`, sets `approvedAt`.
- Reject flips status, no token issued.
- Approve fails (403) if a different `adminUserId` tries.
- Approve fails (410) if already past `expiresAt`.

## HTTP tests (per AI tool, abbreviated)

### Auth + permission matrix (apply to every tool)
- 401 with no JWT.
- 401 with malformed JWT.
- 403 with valid JWT but no `ai-agent:use` permission.
- 403 with valid JWT, has `ai-agent:use`, lacks the tool-specific permission.
- 200 with both.

### Approval flow (covers all approval-gated tools)
- POST without `approvalToken` → `200 { ok: false, error: 'approval_required', approvalRequest }`.
- POST `/approvals/:id/approve` → token issued.
- POST original tool with token → executes, success envelope returned.
- POST again with same token → `410 approval_consumed`.
- POST with token but tampered input → `409 payload_mismatch`.
- POST with token after `expiresAt` → `410 approval_expired`.
- Request opened by user A, approved by user B → `403 approver_mismatch`.

### Destructive action tests (live database, sandboxed)
- Soft-delete then restore round trip for: Product, Category, ProductSize, SizeGuide, Banner, Page, ChecklistTemplate, ExpenseCategory, Role, AdminUser.
- Permanent-delete a Product:
  - Confirm cascade to `ProductVariant`, `ProductImage`, `ProductVideo`, `CartItem`, `WishlistItem`.
  - Confirm `OrderItem` rows are NOT deleted (FK is `onDelete: Restrict` — verify, fix if not).
  - Confirm `RentalOrder.productId` is NOT deleted (or is `Restrict`).
  - Confirm `AgentAuditLog` row exists with `severity: 'CRITICAL'`.
- Order status transition: bad transition (e.g. `DELIVERED → PENDING`) → `400`, no audit row with `status: 'SUCCESS'`.
- Rental status: agent attempts to move backwards → `400`, no successful row.
- Inventory adjust to negative stock → `400`, no audit `SUCCESS`.

## Tenant isolation tests

Two seeded tenants `T1` and `T2`, each with one `Product` and one `Order`.

- Admin of `T1` calls `get_product` with `T2`'s product id → 404 (existing tenant scoping; verify it still applies through the AI route).
- Admin of `T1` sends `X-Tenant-Id: T2` AND a `T1` JWT → 403 `X-Tenant-Id does not match authenticated tenant` (PR-3 behaviour).
- Admin of `T1` calls `archive_product` on `T2` resource id with a valid approval token issued for a `T1` resource → 409 `payload_mismatch`.

## Audit logging tests

- Every successful write produces exactly one `AgentAuditLog` row.
- Every failed call produces exactly one `AgentAuditLog` row with `status != SUCCESS`.
- Audit row's `inputJson` does not contain any sanitised keys (programmatic sweep with the same regex).
- Audit row's `approvalRequestId` is set when applicable.
- `AdminActivityLog.details.agentAuditId` matches `AgentAuditLog.id` for write actions.
- `GET /api/v1/ai/audit?toolName=publish_product` filters correctly.
- CSV export streams without buffering the whole table (test against 10k rows).

## Negative / adversarial tests

- Agent passes `approvalToken: ''` → 400.
- Agent passes another tenant's approval token → 404 (tokens are per-tenant by adminUser scoping).
- Agent passes `isActive: true` to `create_product_draft` → response has `isActive: false` (server enforces).
- Agent passes `tenantId` in body (not allowed by DTO) → 400 (whitelist).
- Agent posts garbage to `/api/v1/ai/products/draft` (e.g. `categoryId: '<script>'`) → 400 / 404.
- Agent attempts to call a tool whose underlying module is disabled for the tenant → 403 `module_disabled`.
- Agent attempts `permanently_delete_record` on an entity not in the supported set → 400 `unsupported_entity`.

## Production safety checklist (run before every AI-agent-touching deploy)

```
[ ] pnpm -r typecheck clean.
[ ] pnpm --filter api test green (unit + service + http).
[ ] AgentAuditLog row count from staging during the test run > 0 (audit pipeline alive).
[ ] AgentApprovalRequest table exists in prod (Phase 3+) — Prisma db push clean.
[ ] ai-agent:use permission seeded on prod (check via SQL: SELECT 1 FROM "Permission" WHERE code='ai-agent:use').
[ ] At least one SUPER_ADMIN role on the pilot tenant has ai-agent:use granted.
[ ] JWT_SECRET / JWT_REFRESH_SECRET env vars present and ≥ 32 chars (already enforced by requireJwtSecret since 2026-05).
[ ] PM2 logs after deploy show "AI agent module ready" log line, no JWT verification failures.
[ ] Smoke: `curl -H "Authorization: Bearer <admin>" https://api.narofashion.co.tz/api/v1/ai/products/search?q=mermaid` returns 200 with envelope.
[ ] Smoke: `curl ... /api/v1/ai/orders/<some-order-id>/notes -d '{"note":"agent test"}'` returns 200 + audit row visible in /audit page.
[ ] Smoke: ATTEMPT `publish_product` without token → returns approval_required envelope (verify in two-phase pattern works in prod).
```

## What we explicitly do NOT test

- Prompt-injection robustness on the LLM side — that's a per-platform concern (OpenAI / Anthropic moderation, output filtering). The backend MUST stay safe regardless of what the model says, and the tests above guarantee that boundary holds.
- Generative quality of model responses — out of scope.
- Storefront-side performance under AI load — agent traffic is rate-limited to 120 req/min/admin, well below what the API already handles.
