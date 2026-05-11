# Naro Fashion — AI Admin Agent Implementation Plan

Four phases. Each phase is independently shippable to production behind the `ai-agent:use` permission flag (no flag = no agent surface). The agent stays read-only until Phase 2 ships, write-on-drafts until Phase 3 ships, fully active when Phase 4 ships.

---

## Phase 3.1B.α status — IMPLEMENTED 2026-05-11 ✅ (Product.archivedAt lifecycle marker)

**Scope shipped**: Adds the `archivedAt: DateTime?` column to `Product` so `restore_product` (PR-β, not in this PR) can safely distinguish drafts from previously-archived products. Updates `archive_product` execute to stamp the field and `publish_product` execute to clear it. Tightens `publish_product`'s validator to reject archived rows with a "use restore_product" hint.

**No backfill performed.** Existing `isActive: false, deletedAt: null` rows keep `archivedAt: null` — i.e. classified as drafts under the new lifecycle. Conservative choice: it preserves the current `publish_product` workflow for legacy inactive products (they're drafts; `publish_product` still works on them) while leaving operators a manual route — running `archive_product` once on a legacy product makes it restorable when PR-β ships.

### Schema change

```diff
 model Product {
   // ... existing fields ...
+  // Lifecycle marker — Phase 3.1B.α (2026-05-11). Distinguishes archived
+  // products (was once active, now hidden) from drafts (never published).
+  archivedAt   DateTime?
   deletedAt    DateTime?
   // ... indexes ...
+  @@index([archivedAt])
 }
```

Migration: `prisma db push --accept-data-loss` (the standard production deploy path in `deploy.sh`). Nullable column add, no constraint change, no lock escalation beyond a metadata-only `ACCESS EXCLUSIVE`. Existing rows get `archivedAt = null` by default.

### State-space after PR-α

| `isActive` | `archivedAt` | `deletedAt` | Lifecycle | Public? |
|---|---|---|---|---|
| `false` | `null` | `null` | **DRAFT** (never published) | no |
| `true` | `null` | `null` | **ACTIVE** | yes |
| `false` | `<date>` | `null` | **ARCHIVED** (was active, archived) | no |
| any | any | `<date>` | **SOFT-DELETED** (recycle bin) | no |

### Code change summary

- **`publish-validation.service.ts`** — `validatePublishable` now rejects `archivedAt != null` immediately after the existing `isActive` check, with the user-facing message `"This product is archived. Use restore_product when it is available."` Order matters: the archived check fires BEFORE field-content checks (images/price/variants) so an operator gets the right hint for an archived row, not "missing images".
- **`approval.service.ts`** — the consume transaction's `tx.product.update({ data: { isActive } })` becomes `data: { isActive, archivedAt: isActive ? null : new Date() }`. Single line change; same atomic write; both directions explicit so a future `restore_product` shares the same code path.
- **Public response whitelist** — no change needed. `publicProductListSelect` / `publicProductDetailSelect` use explicit allow-lists; `archivedAt` was never on them, so it stays out of the storefront API surface. New test in `products.service.spec.ts` (the `ADMIN_ONLY_FIELDS` table) asserts this as a regression guard.

### What's NOT in PR-α (PR-β scope)

- ❌ `restore_product` request-approval route — separate PR after this one soaks.
- ❌ Restore validator (`isActive: false, archivedAt: not null, deletedAt: null`).
- ❌ Restore dispatch case in `execute()`.
- ❌ Storefront / admin UI exposure of archived state (admin only sees the column via `findById`/`findAllAdmin` because those use Prisma `include` returning all scalars; storefront whitelist already strips it).

### Tests added in PR-α

10 new tests across two files:

`phase-3-foundation.spec.ts` (3 new in a `Product schema — archivedAt lifecycle marker` block):
1. `Product` model declares `archivedAt` as nullable `DateTime`.
2. `Product` indexes `archivedAt`.
3. `Product` still has `isActive` + `deletedAt` (additive, not a replacement).

`approval.service.spec.ts` (5 new in a `archivedAt lifecycle marker — Phase 3.1B.α` block + 2 updates):
4. Publish validator REJECTS archived product with `use restore_product` message.
5. Publish validator ALLOWS drafts (archivedAt=null).
6. Archive execute writes `{ isActive: false, archivedAt: Date }` and NEVER sets `deletedAt`.
7. Publish execute writes `{ isActive: true, archivedAt: null }` (explicit null clear).
8. Publish validator check order: archived check fires before field-content checks.
+ Updates to tests #20 (publish data shape) and #A12 (archive data shape) to expect the new `archivedAt` write.

`products.service.spec.ts` (1 update):
9. `ADMIN_ONLY_FIELDS` table now includes `archivedAt` — proves the public list + detail selects never return it.

Total: 375 tests passing across 12 suites (was 365 in 3.1B → +10).

---

## Phase 3.1B status — IMPLEMENTED 2026-05-11 ✅ (archive_product only — single-tool extension)

**Scope shipped**: `archive_product` as the second risky tool on the approval workflow. Reuses every piece of Phase 3.1A plumbing (four-eyes, hashed token, payload hash, stale-data, retry cap, cron expiry, audit linkage). NO other Phase 3.1B tools (restore, update_product, status changes, inventory adjust, rental policy, permanent delete, refunds) are wired.

### What's live (in addition to Phase 3.1A)

| Surface | Route | Notes |
|---|---|---|
| Initiate (archive_product) | `POST /api/v1/ai/products/:id/archive/request-approval` | Operator perm: `ai-agent:write-drafts`. Risk: HIGH (2-min TTL). `@RequiresApproval(HIGH)` metadata. |

The approve / reject / revoke / cancel / execute / list / get endpoints are unchanged from 3.1A — `ApprovalsAiController` is tool-agnostic and dispatches on `row.toolName`.

### How archive_product differs from publish_product

| Aspect | publish_product | archive_product |
|---|---|---|
| Pre-flight validator | `PublishValidationService.validatePublishable` — rejects unless `isActive: false && deletedAt: null && images>=1 && basePrice>0 && variants/rental fields ok` | `ArchiveValidationService.validateArchivable` — rejects unless `isActive: true && deletedAt: null` |
| `beforeValues` | `{ isActive: false, slug, basePrice }` | `{ isActive: true, slug, name }` |
| `afterValues` | `{ isActive: true, slug, basePrice }` | `{ isActive: false, slug, name }` |
| Consume write | `tx.product.update({ data: { isActive: true } })` | `tx.product.update({ data: { isActive: false } })` |
| Success audit `actionType` | `PUBLISH` | `ARCHIVE` |
| `deletedAt` touched? | No | **No** — explicit; archive is NOT a soft-delete. The product stays in admin; the recycle-bin path is a separate operation. |
| Storefront effect | Product becomes visible (GET `/products/:slug` → 200) | Product becomes hidden (GET `/products/:slug` → 404) |

### Dispatch in `execute()`

`ApprovalService.execute()` now `switch`-es on `row.toolName` for both the pre-write validation and the `nextActiveState` boolean:

```typescript
let nextActiveState: boolean;
switch (row.toolName) {
  case APPROVAL_TOOL_NAMES.PUBLISH_PRODUCT:
    await this.publishValidator.validatePublishable(row.targetResourceId!, tenantId);
    nextActiveState = true;
    break;
  case APPROVAL_TOOL_NAMES.ARCHIVE_PRODUCT:
    await this.archiveValidator.validateArchivable(row.targetResourceId!, tenantId);
    nextActiveState = false;
    break;
  default:
    throw new BadRequestException(`Unsupported approval tool '${row.toolName}' for execute().`);
}
// ... consume transaction issues: tx.product.update({ data: { isActive: nextActiveState } })
```

### Tests added

`approval.service.spec.ts` ships +24 archive-specific tests in a dedicated `describe('archive_product …')` block. Covers all 22 mandatory cases plus two extras (linked ARCHIVE audit row + no `deletedAt` mutation invariant).

`phase-3-foundation.spec.ts` updated: the `@RequiresApproval` count assertion now expects **2** occurrences (publish + archive) on `products.ai.controller.ts`. The "only one Post containing `publish`" assertion is generalised to "only Post paths containing `publish` OR `archive` are the two request-approval routes". Direct-write archive paths (`@Post(':id/archive')`, `@Patch(':id/archive')`, `@Delete(':id/archive')`) remain forbidden.

`ai-controllers.shape.spec.ts` allowlist extended with `@Post(':id/archive/request-approval')` for `products.ai.controller.ts`.

Total: 365 tests passing across 12 suites (was 341 in 3.1A → +24).

### What's NOT in Phase 3.1B (deliberately deferred)

- ❌ restore_product (recycle-bin restore) — separate PR.
- ❌ update_product (with pricing) — Phase 3.1C-ish slot, biggest unknown.
- ❌ Order/rental status changes.
- ❌ Inventory adjust.
- ❌ Rental policy changes (CRITICAL risk, 60s TTL).
- ❌ Permanent delete — Decision Log #9 — blocked until Phase 4 multi-approver + FK/cascade audit.
- ❌ Refunds / payment-reversal — Decision Log #10 — out of Phase 3 entirely.

---

## Phase 3.1A status — IMPLEMENTED 2026-05-11 ✅ (approval workflow live for publish_product only)

**Scope shipped**: full request → approve → execute lifecycle for the **`publish_product`** tool, plus the approval-management surface. No other risky tools are wired yet — Phase 3.1B will add archive/restore, status changes, inventory adjust, etc.

### What's live

| Surface | Routes | Notes |
|---|---|---|
| Initiate (publish_product) | `POST /api/v1/ai/products/:id/publish/request-approval` | Operator perm: `ai-agent:write-drafts`. Risk: HIGH (2-min TTL). |
| Approve | `POST /api/v1/ai/approvals/:id/approve` | Approver perm: `ai-agent:approve`. Returns the raw token ONCE in the response body — never persisted. |
| Reject | `POST /api/v1/ai/approvals/:id/reject` `{reason}` | Approver perm: `ai-agent:approve`. Four-eyes blocks self-rejection. |
| Revoke | `POST /api/v1/ai/approvals/:id/revoke` `{reason?}` | Original approver only. Clears `approvalTokenHash`. Status → REVOKED. |
| Cancel | `POST /api/v1/ai/approvals/:id/cancel` | Initiator only, while still PENDING. |
| Execute | `POST /api/v1/ai/approvals/:id/execute` `{approvalToken}` | Initiator only. Consumes the token, runs the underlying write inside a Prisma `$transaction`. |
| List | `GET /api/v1/ai/approvals?status=` | Tenant-scoped. |
| Get | `GET /api/v1/ai/approvals/:id` | Tenant-scoped. |

### Token semantics (Phase 3.1A enforces all four lock-decisions)

1. **Hash-only storage (Decision Log #6)** — raw token is `randomBytes(32).toString('hex')`. The DB only ever sees `sha256(rawToken)` on `approvalTokenHash`. The raw value is returned in the approve response body exactly once, then forgotten. Never written to `AgentAuditLog.outputJson`. Never exposed by the audit GET endpoints. The sanitiser's allowlist (`approvaltoken`) only applies to the consume input — execute calls preserve the token in the audit row so forensics can correlate to the (already-consumed) hash, but no other surface logs it.
2. **Payload hash binding (canonical-json)** — `payloadHash = sha256(toolName || "::" || canonicalJSON(input))`. Computed at request-approval time; re-computed at execute time from the *stored* `inputJson`. Mismatch → status flips to EXPIRED with `expirationReason='payload_mismatch'` and the hash is cleared.
3. **Stale-data guard (Decision Log #12)** — `expectedUpdatedAt` is captured atomically with the snapshot at request-approval time. Execute re-reads `Product.updatedAt`; mismatch → status flips to EXPIRED with `expirationReason='stale_data'`, hash cleared. The operator must re-initiate.
4. **Retry cap (Decision Log #13)** — `executionAttempts` increments via a *separate* `updateMany` transaction BEFORE the main consume transaction starts. After the 3rd attempt the row flips to EXHAUSTED and the hash is cleared. Implementation guarantees the cap is enforced even if the consume transaction crashes mid-write.

### Four-eyes runtime check

Both `approve` and `reject` compare `request.user.id === row.requestedByAdminUserId`. Self-approval blocked → 403 `forbidden_self_approval` + `AgentAuditLog` row with `actionType='SELF_APPROVAL_BLOCKED'`, severity WARNING. The two seeded roles (`AI_AGENT_OPERATOR` carries `:write-drafts` only, `AI_AGENT_APPROVER` carries `:approve` only) make the policy violation impossible without explicit role overlap. SUPER_ADMIN holds both perms via the Phase 3.0 backfill, but four-eyes still bites — the runtime check is the canonical gate, the role split is the policy nudge.

### Cron expiry sweep

`ApprovalExpiryCron.sweep()` runs `@Cron(EVERY_MINUTE)`. For every `PENDING`/`APPROVED` row with `expiresAt < now`:
1. Flip `status = 'EXPIRED'`, `expirationReason = 'ttl'`, clear `approvalTokenHash`.
2. Write one `AgentAuditLog` row per request with `actionType='APPROVAL_EXPIRED'`, severity INFO, linked via `approvalRequestId`. Attributed to the request's initiator (the only person who definitely existed at request time).
Lazy expiry also runs inline in `approve`/`execute` so the cron is purely a cleanup mechanism — up to ~60s of "expired but still PENDING" between ticks is acceptable.

### What's NOT in Phase 3.1A (deliberately deferred)

- ❌ Archive / restore (`POST /:id/archive`, `POST /:id/restore`) — Phase 3.1B.
- ❌ Update with pricing (`PATCH /ai/products/:id`) — Phase 3.1B.
- ❌ Order/rental status changes — Phase 3.1B.
- ❌ Inventory adjust — Phase 3.1B.
- ❌ Rental policy changes (CRITICAL risk, 60s TTL) — Phase 3.1B.
- ❌ Permanent delete — Decision Log #9 — blocked until Phase 4 multi-approver + FK/cascade audit.
- ❌ Refunds / payment-reversal — Decision Log #10 — out of Phase 3 entirely.
- ❌ Admin UI for approvals — Phase 4.
- ❌ SUPER_ADMIN demotion script — Phase 3.2, runs 2-4 weeks after 3.1B soak.

### Tests added

`approval.service.spec.ts` ships 24 lifecycle tests + 4 structural assertions:
1. Operator creates publish approval. 2. Hash-only persistence. 3. Raw token not in audit. 4. Approver approves. 5. Initiator cannot self-approve. 6. Approve route requires `:approve`. 7. Publish initiation requires `:write-drafts`. 8. Payload-hash mismatch invalidates. 9. Stale-data invalidates. 10. Expired cannot execute. 11. Revoked cannot execute. 12. Rejected cannot execute. 13. Consumed cannot re-execute. 14. Retry cap at 3 → EXHAUSTED. 15. Cross-tenant approval invisible (404). 16. Cross-tenant execute fails. 17. Soft-deleted product blocked. 18. Already-active product blocked. 19. Missing-fields product blocked. 20. Successful execute sets `isActive=true`. 21. Successful execute writes linked PUBLISH audit. 22. Phase 1/2 surface intact. 23. Pricing-block still rejects. 24. No Phase 3.1B+ write routes.

Plus the existing `phase-3-foundation.spec.ts` was updated to assert: `@RequiresApproval` appears on *exactly* one route (`products.ai.controller.ts:1`); the only `/publish` route is `POST /:id/publish/request-approval` (no direct publish route). The shape spec's `ALLOWED_POSTS` was extended with the 5 approval-management routes and the new `:id/publish/request-approval` route.

Total: 331 tests passing across 12 suites (was 286 in Phase 3.0 + whitelist).

---

## Phase 3.0 status — IMPLEMENTED 2026-05-10 ✅ (foundation only — zero runtime behaviour change)

**Scope shipped**: schema migration, permission seeding, role seeding, decorator + guard infrastructure. No risky tools wired. No existing endpoint behaviour changed.

This is the safe-to-deploy preparatory layer for Phase 3.1. After this lands in production:
- Existing Phase 1/2 endpoints (`/api/v1/ai/products/search`, `/api/v1/ai/orders/:id/notes`, etc.) keep working **identically** — they're still gated by `ai-agent:use` only because they don't carry the new `@RequiresAiPermission()` decorator.
- The new `AgentApprovalRequest` table is created but no service writes to it yet.
- The new permissions and roles are seeded but only SUPER_ADMIN is auto-granted them (rollout backfill — see Decision Log #2).
- `@RequiresApproval(riskLevel)` decorator is shipped but no route uses it. Phase 3.1 will start applying it.

### What was implemented

| Component | File | Notes |
|---|---|---|
| `AgentApprovalRequest` Prisma model | [`packages/database/prisma/schema.prisma`](../../packages/database/prisma/schema.prisma) | 27 fields per Decision Log #6/#7/#8/#12/#13. **Stores `approvalTokenHash` only — never raw tokens.** |
| `AgentAuditLog.approvalRequestId` column | (same schema file) | Foreign-key-soft link with `onDelete: SetNull`; indexed for join queries |
| AdminUser back-relations | (same schema file) | `agentApprovalsRequested`, `agentApprovalsApproved` |
| 3 new permission codes | [`apps/api/src/permissions/permissions.service.ts`](../../apps/api/src/permissions/permissions.service.ts) | `ai-agent:read`, `ai-agent:write-drafts`, `ai-agent:approve` (`ai-agent:use` already existed) |
| 2 new system roles | [`apps/api/src/ai/services/ai-roles-seeder.service.ts`](../../apps/api/src/ai/services/ai-roles-seeder.service.ts) | `AI_AGENT_OPERATOR` (use+read+write-drafts), `AI_AGENT_APPROVER` (use+read+approve). Tenant-null + `isSystem=true` to match existing pattern |
| SUPER_ADMIN backfill | (same seeder) | Idempotent grant of all 4 AI permissions to SUPER_ADMIN. **Temporary** — Phase 3.2 demotion script removes `:approve`. Decision Log #2 |
| `@RequiresAiPermission(scope)` decorator | [`apps/api/src/ai/decorators/requires-ai-permission.decorator.ts`](../../apps/api/src/ai/decorators/requires-ai-permission.decorator.ts) | Reflector metadata key. Not yet applied to any route |
| `AiPermissionGuard` extended | [`apps/api/src/ai/guards/ai-permission.guard.ts`](../../apps/api/src/ai/guards/ai-permission.guard.ts) | Reads `@RequiresAiPermission()`. When absent → only `:use` required (back-compat). When present → `:use` + scope perm both required |
| `@RequiresApproval(riskLevel)` decorator | [`apps/api/src/ai/decorators/requires-approval.decorator.ts`](../../apps/api/src/ai/decorators/requires-approval.decorator.ts) | Scaffold only — no interceptor consumes it yet. Phase 3.1 will wire the approval-token flow |
| Type constants | [`apps/api/src/ai/types/`](../../apps/api/src/ai/types/) | `AI_PERMISSION_CODES`, `AI_AGENT_ROLE_NAMES`, `AGENT_APPROVAL_STATUS`, `AI_RISK_LEVEL`, `AI_RISK_LEVEL_TTL_MS`, `MAX_APPROVAL_EXECUTION_ATTEMPTS` |
| Tests | `phase-3-foundation.spec.ts` + `ai-permission.guard.spec.ts` | 138 tests total (was 92 — Phase 3.0 adds 46) |

### What was deliberately NOT implemented (per the locked spec)

- ❌ No risky tools wired — no `publish_product`, no `update_product`, no inventory adjust, no order/rental status change, no permanent delete, no refunds.
- ❌ No `@RequiresAiPermission()` applied to any existing route — Phase 1/2 routes keep their original gate (`ai-agent:use` only) untouched. Confirmed by `phase-3-foundation.spec.ts` invariant.
- ❌ No `@RequiresApproval()` applied to any route — same invariant.
- ❌ No approval-token consume/issue flow — Phase 3.1 work.
- ❌ No new HTTP routes — controller-shape invariant still allowlists exactly the 4 Phase 2 `@Post` paths and forbids `@Patch`/`@Put`/`@Delete`.
- ❌ No customer-facing storefront change.
- ❌ No automatic deploy — commit is local; user explicit go-ahead required to push.

### Production-runtime behaviour

After deploying this commit:
- `/api/v1/ai/*` endpoints respond identically to Phase 2.
- The `AgentApprovalRequest` table exists (created by `prisma db push --accept-data-loss` in deploy.sh) but is empty.
- `AgentAuditLog.approvalRequestId` is null on every existing row and on every Phase 1/2 row written from now on.
- The 3 new permission rows are inserted by `PermissionsService.onModuleInit()`.
- The 2 new system roles are inserted by `AiRolesSeederService.onApplicationBootstrap()`.
- SUPER_ADMIN gets the 4 AI permissions via the same seeder's idempotent backfill. **Cannot break existing AdminUser logins** — only adds rows to `RolePermission`.

### How to test locally

```bash
# 1. Apply schema change (creates AgentApprovalRequest table on dev DB)
cd packages/database && pnpm prisma db push

# 2. Run all tests (138 expected to pass)
cd ../../apps/api && pnpm test

# 3. Boot the API and verify nothing broke
pnpm dev
# Hit a Phase 1/2 endpoint with a SUPER_ADMIN JWT — should work as before:
#   curl -H "Authorization: Bearer <admin>" http://localhost:4000/api/v1/ai/products/search?limit=2
```

### Known limitations (Phase 3.0)

- **Prisma client regen on Windows/OneDrive can EPERM.** This is the documented gotcha (see CLAUDE.md → "OneDrive sync can cause EPERM errors"). The schema is valid (`prisma validate` confirms), TypeScript compiles, tests pass — Phase 3.0 code path doesn't reference `prisma.agentApprovalRequest.*` at runtime. Local workstations may need to retry `prisma generate` (or `prisma db push`, which generates and pushes) after closing background node processes. Linux/CI/VPS not affected.
- **`AgentApprovalRequest` table will be empty** until Phase 3.1 ships the approval flow.
- **The `expectedUpdatedAt` and `executionAttempts` fields exist but no code reads/writes them** — Phase 3.1 wires the consume transaction.

### Suggested deploy steps when ready

1. `git push origin prod` — CI runs `deploy.sh` which now pulls from `prod` (post-deploy.sh fix from 2026-05-10) and runs `prisma db push --accept-data-loss` → creates `AgentApprovalRequest`, adds `AgentAuditLog.approvalRequestId`.
2. PM2 restart picks up the new permission seed + roles seeder.
3. SQL spot-check on prod after deploy:
   ```sql
   SELECT code FROM "Permission" WHERE code LIKE 'ai-agent:%' ORDER BY code;
   -- expected: ai-agent:approve, ai-agent:read, ai-agent:use, ai-agent:write-drafts

   SELECT name FROM "Role" WHERE name LIKE 'AI_AGENT_%' AND "deletedAt" IS NULL;
   -- expected: AI_AGENT_APPROVER, AI_AGENT_OPERATOR

   SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'AgentApprovalRequest');
   -- expected: t
   ```
4. Smoke a Phase 1/2 endpoint to confirm zero behaviour change.

---

## Phase 2 status — IMPLEMENTED 2026-05-10 ✅ (subset)

**Scope shipped**: 4 of the 6 originally-planned Phase 2 tools — the operator deliberately deferred the rest.

Implemented:
- `create_product_draft` — POST `/api/v1/ai/products/draft`
- `add_order_note` — POST `/api/v1/ai/orders/:id/notes`
- `create_size_guide_entry` — POST `/api/v1/ai/size-guide`
- `create_size` — POST `/api/v1/ai/product-sizes`

Skipped (deferred to Phase 3+ alongside the approval workflow):
- `create_category` — sandbox-by-default flag adds complexity; the operator chose to land it cleanly with approvals later.
- `update_product` — pricing-aware editing belongs with Phase 3 approvals.

**Hard rule enforced this phase**: ZERO pricing-field writes from any AI tool.

The strict DTO `CreateProductDraftAiDto` declares only non-pricing fields. Combined with the global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`, any pricing field on the wire returns `400 property X should not exist` before the handler runs. Concrete blocked fields (covered by 17 cases in `create-product-draft.ai.dto.spec.ts`):

```
basePrice, compareAtPrice, purchasePrice
rentalPricePerDay, rentalDepositAmount, rentalDownPaymentPct, latePenaltyPercent
isActive, isFeatured, published
sizeGuideId, model3dUrl, model3dPosterUrl
lastRestockedAt, avgRating, reviewCount, deletedAt
price (legacy)
```

The server forces `price: 0` and `published: false` when calling `ProductsService.create()` — operators MUST set the real price + add at least one variant via the admin UI before the draft can be published. (Publishing itself ships in Phase 3.)

### Files added / changed

```
apps/api/src/ai/dto/create-product-draft.ai.dto.ts        (new, strict no-pricing)
apps/api/src/ai/dto/create-product-draft.ai.dto.spec.ts   (new, 17 forbidden-field tests)
apps/api/src/ai/dto/add-order-note.ai.dto.ts              (new)
apps/api/src/ai/dto/create-size-guide.ai.dto.ts           (new)
apps/api/src/ai/dto/create-size.ai.dto.ts                 (new)

apps/api/src/ai/controllers/products.ai.controller.ts     (+@Post('draft'))
apps/api/src/ai/controllers/orders.ai.controller.ts       (+@Post(':id/notes'))
apps/api/src/ai/controllers/size-guide.ai.controller.ts   (+@Post())
apps/api/src/ai/controllers/product-sizes.ai.controller.ts(+@Post())
apps/api/src/ai/controllers/ai-controllers.shape.spec.ts  (Phase 2 invariant: explicit @Post allowlist; @Patch/@Put/@Delete still forbidden)

apps/api/src/orders/orders.service.ts                     (+addNote method, append-only with [ISO — admin name] prefix)
apps/api/src/size-guides/size-guides.service.ts           (+createDraft method, forces isActive:false isDefault:false)
apps/api/src/permissions/permissions.service.ts           (+orders:add-note, size-guides:create, product-sizes:create)
```

### Per-tool permission gating: NOT yet implemented

Phase 2 still uses the single `ai-agent:use` gate. Per-tool gating (e.g. require `products:create` for `create_product_draft`, `orders:add-note` for `add_order_note`) is deferred to Phase 3. The new permission codes are seeded so operators can pre-wire them into roles before the cutover.

### Audit log additions

Each Phase 2 write produces:
1. One `AgentAuditLog` row with `actionType ∈ {CREATE, NOTE}`, `severity = INFO`, `status = SUCCESS`, sanitised input (note text length only — never the body).
2. One `AdminActivityLog` row written by the existing `AuditService` inside `OrdersService.addNote` / `ProductSizesService.create` / etc — the AI layer didn't have to plumb this; existing services already log on write.

### Tests
- 92 total (was 59 in Phase 1).
- New: 17 cases in `create-product-draft.ai.dto.spec.ts` proving every forbidden field returns 400.
- Updated: `ai-controllers.shape.spec.ts` now whitelists 4 specific `@Post` decorator strings; any @Post outside the allowlist (or any @Patch/@Put/@Delete anywhere) fails the build.

### How to test locally

```bash
# After pulling, no schema change is needed — Phase 2 is code-only.
cd apps/api && pnpm test
# Boot the API
pnpm dev
# Grant the new perms (optional — only if you want operators with non-SUPER_ADMIN
# roles to call writes; for now SUPER_ADMIN with ai-agent:use can do everything).

# 1. Draft a product
TOKEN="<paste a SUPER_ADMIN JWT>"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"AI Test Gown","categoryId":"<real-cat-id>","availabilityMode":"PURCHASE_ONLY"}' \
  http://localhost:4000/api/v1/ai/products/draft | jq .

# 2. Verify pricing is blocked
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"AI Bad","categoryId":"<id>","availabilityMode":"PURCHASE_ONLY","basePrice":100000}' \
  http://localhost:4000/api/v1/ai/products/draft | jq .
# expect: success:false, error.code:"validation_error", message contains "basePrice should not exist"

# 3. Add an order note
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"note":"Customer asked about delivery"}' \
  http://localhost:4000/api/v1/ai/orders/<order-id>/notes | jq .
```

### Known limitations (Phase 2)
- **No pricing changes via AI** by hard requirement — operators must use the admin UI to set/edit prices until Phase 3 lands the approval workflow. Drafts are created with `price: 0` placeholder.
- **No category creation** via AI — deferred to Phase 3 to avoid the sandbox-default-parent UX.
- **No product update** via AI — `update_product` (non-pricing fields) is deferred to Phase 3 so the pricing-aware code path lands cleanly.
- **Per-tool permission gating not yet enforced** — `ai-agent:use` is still the only gate. Phase 3 will add a `@RequiresPermission()` decorator + guard.
- **Order note size-bound at 2000 chars** by `MaxLength(2000)`; longer notes return 400. The note text is NOT logged into `AgentAuditLog.inputJson` (only its length) to avoid customer-PII duplication.

---

## Phase 1 status — IMPLEMENTED 2026-05-10 ✅

The read-only foundation is committed but **not yet deployed**. Lives entirely under `apps/api/src/ai/` plus one Prisma model and one permission addition. No write endpoints exist; no external AI provider is wired; no approval workflow exists.

### What was implemented
- Prisma model: `AgentAuditLog` (with `AdminUser.agentAuditLogs` back-relation).
- Permissions seeded on next API boot: `ai-agent:use`, `product-sizes:view`, `size-guides:view`, `rental-policies:view`, `recycle-bin:list`.
- AI module: [apps/api/src/ai/](apps/api/src/ai/)
  - Services: `AiSanitizerService`, `AiAuditService` (request-scoped), `AiToolRunner` (request-scoped, wraps every handler with timing + audit + envelope).
  - Guard: `AiPermissionGuard` (DB-checks `ai-agent:use` for non-platform admins).
  - Exception filter: `AiExceptionFilter` (re-shapes errors into envelope, preserves HTTP status).
  - Decorator helper: `@AiSecured()` bundles JwtAuthGuard + AdminGuard + AiPermissionGuard + filter.
- 10 controllers, 17 GET endpoints under `/api/v1/ai/*`. All read-only — confirmed by a structural test.
- Inventory and Reports controllers also carry `@RequiresModule()` + `ModuleGuard` so tenants without the module enabled get a clean 403.
- Jest harness: [apps/api/jest.config.js](apps/api/jest.config.js) + 4 spec files (sanitiser, envelope, audit service with mocked Prisma, controller-shape invariant). 59 tests passing.

### Endpoints live (Phase 1)
```
GET /api/v1/ai/products/search
GET /api/v1/ai/products/:id
GET /api/v1/ai/categories
GET /api/v1/ai/product-sizes
GET /api/v1/ai/orders
GET /api/v1/ai/orders/:id
GET /api/v1/ai/rentals
GET /api/v1/ai/rentals/:id
GET /api/v1/ai/inventory                           (requires `inventory` module)
GET /api/v1/ai/inventory/low-stock                 (requires `inventory` module)
GET /api/v1/ai/rental-policies
GET /api/v1/ai/size-guide
GET /api/v1/ai/recycle-bin                         (Product, Category, ProductSize, SizeGuide only — see "Known limitations")
GET /api/v1/ai/reports/sales-summary               (requires `reports` module)
GET /api/v1/ai/reports/rental-summary              (requires `reports` module)
GET /api/v1/ai/reports/inventory-summary           (requires `reports` module)
GET /api/v1/ai/reports/popular-products            (requires `reports` module)
GET /api/v1/ai/reports/pending-orders              (requires `reports` module)
GET /api/v1/ai/reports/overdue-rentals             (requires `reports` module)
```

### Auth stack (every endpoint)
```
JwtAuthGuard → AdminGuard → AiPermissionGuard (→ ModuleGuard for inventory/reports) → controller
                                                                                    ↘ AiToolRunner → AgentAuditLog row
                                                                                    ↘ AiExceptionFilter (on error)
```

### Audit fields written per call
`tenantId, adminUserId, agentName, sessionId, toolName, actionType='READ', targetResourceType, targetResourceId, inputJson (sanitised), outputJson (sanitised), approvalRequired=false, approvalStatus='NOT_REQUIRED', status, errorMessage?, severity, ipAddress, userAgent, durationMs, createdAt, updatedAt`.

Sensitive fields are stripped by `AiSanitizerService` before persistence: `password*`, `token` (except `approvalToken`), `accessToken`, `refreshToken`, `secret*`, `apiKey`, `clientSecret`, `webhookSecret`, `Authorization`, `Bearer`, `creditCard`, `cardNumber`, `cvv`, `cardCvc`, `pin`. Strings >4KB truncated; arrays >200 items truncated; whole payloads >64KB summarised.

### How to test locally

```bash
# 1. Apply the schema change to your local dev DB
cd packages/database
pnpm prisma db push

# 2. Run the Phase 1 tests
cd ../../apps/api
pnpm test

# 3. Boot the API and exercise an endpoint
pnpm dev
# In another shell — first grant ai-agent:use to a SUPER_ADMIN role via the
# admin UI at /dashboard/settings/roles, OR via SQL:
#   INSERT INTO "RolePermission" ("roleId","permissionId","assignedAt")
#   SELECT r.id, p.id, NOW()
#   FROM "Role" r, "Permission" p
#   WHERE r.name = 'SUPER_ADMIN' AND p.code = 'ai-agent:use'
#   ON CONFLICT DO NOTHING;
TOKEN="<paste a SUPER_ADMIN JWT here>"
curl -H "Authorization: Bearer $TOKEN" \
     -H "X-Agent-Session-Id: dev-session-1" \
     "http://localhost:4000/api/v1/ai/products/search?limit=5" | jq .
```

Expected response body:
```json
{
  "success": true,
  "tool": "search_products",
  "data": { "data": [...], "meta": { "total": 5, "page": 1, "limit": 5, "totalPages": 1 } },
  "approvalRequired": false,
  "auditId": "<cuid>",
  "message": "Found 5 product(s) (page 1/1)."
}
```

### How to verify the surface is read-only

1. **Source-level invariant**: `pnpm --filter api test` includes `ai-controllers.shape.spec.ts` which fails the build if any AI controller declares `@Post`, `@Patch`, `@Put`, or `@Delete`.
2. **Routing inspection** (manual): boot the API and check the NestJS routes log — every line under `AiModule` is a `GET`.
3. **HTTP probe** (manual): `curl -X POST http://localhost:4000/api/v1/ai/products/search` returns 404 (no POST handler exists). `curl -X DELETE http://localhost:4000/api/v1/ai/products/cm123` likewise.
4. **Audit inspection**: every successful call writes `actionType='READ'` and `approvalRequired=false`. SQL: `SELECT toolName, actionType, approvalRequired FROM "AgentAuditLog" ORDER BY createdAt DESC LIMIT 20;` should show only READ rows in Phase 1.

### Known limitations (Phase 1)
1. **No external AI provider connected.** The `/api/v1/ai/*` endpoints are HTTP only. Hooking up an LLM (Anthropic / OpenAI) is its own follow-up — out of scope per the Phase 1 brief.
2. **Per-route permission enforcement is binary.** Every AI route requires `ai-agent:use`. Granular `products:view`-style checks per AI endpoint are deferred to Phase 3 (when the approval workflow lands and the difference between read and write permissions matters more).
3. **Throttling is global, not AI-specific.** The existing global limit (100 req/min — see `ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])` in `app.module.ts`) covers AI traffic too. The Phase 1 plan recommends a separate AI-specific 120 req/min/admin throttle but that's a small follow-up — TODO in `app.module.ts`.
4. **Recycle-bin coverage is partial.** Only Product, Category, ProductSize, and SizeGuide are aggregated — those are the entities with a public `findDeleted()` method on their existing service. Adding the rest (Banner, Page, ChecklistTemplate, ExpenseCategory, Role, AdminUser, ParallaxSection, PaymentMethod) requires extending each service in Phase 4.
5. **No `popular-products` purpose-built service.** The `popular-products` report slices `topProducts` out of the existing `analytics.getDashboard()`. If `topProducts` ever leaves the dashboard payload, this endpoint breaks. Acceptable for Phase 1; a dedicated method is a Phase 4 cleanup.
6. **Permissions must be granted manually.** `ai-agent:use` is seeded on boot but NOT auto-assigned to any role. Operators must grant it via `/dashboard/settings/roles` or SQL before the agent works for anyone other than platform admins.
7. **Inventory/Reports availability is tenant-dependent.** The `inventory` and `reports` modules are optional. If a tenant doesn't have them enabled, the corresponding AI endpoints return `403 module_disabled` from `ModuleGuard` — verify before promising the operator that "show me low-stock items" works.

### What remains (Phases 2–4)
Already documented above — no change.

### Suggested deploy steps when ready
1. `git push origin prod` — CI runs `deploy.sh` which runs `prisma db push --accept-data-loss` automatically (creates `AgentAuditLog`).
2. Verify on prod:
   ```bash
   ssh root@80.240.30.107 "pm2 logs naro-api --lines 30 --nostream | grep -i 'ai\\|nest application'"
   ```
   Look for "Nest application successfully started" with no boot errors and `Mapped {/api/v1/ai/*}` lines from the `RouterExplorer`.
3. SQL: confirm permission seeded.
   ```sql
   SELECT code FROM "Permission" WHERE code IN ('ai-agent:use', 'recycle-bin:list', 'product-sizes:view', 'size-guides:view', 'rental-policies:view');
   ```
4. Grant `ai-agent:use` to one SUPER_ADMIN role on a pilot tenant.
5. Smoke: `curl -H "Authorization: Bearer <admin>" https://api.narofashion.co.tz/api/v1/ai/products/search?limit=2 | jq .` returns the envelope.
6. Watch `AgentAuditLog` rowcount for one week before opening Phase 2 work.

---

## Phase 1 — Read-only AI assistant

### Objective
Stand up the AI route surface, audit pipeline, and a tightly-scoped set of read-only tools. No writes, no approval workflow yet (since nothing destructive can happen).

### Features
- AI route module (`apps/api/src/ai/`) with envelope wrapper.
- `AgentAuditLog` table + service.
- Sanitiser util.
- `ai-agent:use` permission seeded.
- Read-only tools live: `search_products`, `get_product`, `list_categories`, `list_orders`, `get_order`, `list_rentals`, `get_rental`, `get_rental_availability`, `get_inventory`, `low_stock_report`, `inventory_summary`, `list_sizes`, `get_size_guide`, `get_rental_policies`, `list_deleted_records`, `sales_summary`, `rental_summary`, `popular_products_report`, `pending_orders_report`, `overdue_rentals_report`.
- Skill file shipped (already done in this PR).
- Agent config + system prompt shipped (already done in this PR).

### Endpoints / tools needed
All reads from `AI_TOOLS.md`.

```
POST /api/v1/ai/products/search
GET  /api/v1/ai/products/:id
GET  /api/v1/ai/categories
GET  /api/v1/ai/orders
GET  /api/v1/ai/orders/:id
GET  /api/v1/ai/rentals
GET  /api/v1/ai/rentals/:id
GET  /api/v1/ai/rentals/availability/:productId
GET  /api/v1/ai/inventory
GET  /api/v1/ai/inventory/low-stock
GET  /api/v1/ai/inventory/valuation
GET  /api/v1/ai/product-sizes
GET  /api/v1/ai/size-guides
GET  /api/v1/ai/rental-policies
GET  /api/v1/ai/recycle-bin?entity=
GET  /api/v1/ai/reports/sales-summary
GET  /api/v1/ai/reports/rental-summary
GET  /api/v1/ai/reports/popular-products
GET  /api/v1/ai/reports/pending-orders
GET  /api/v1/ai/reports/overdue-rentals
GET  /api/v1/ai/audit                    (audit:view)
GET  /api/v1/ai/audit/export             (audit:export)
```

### Files to create

```
apps/api/src/ai/ai.module.ts
apps/api/src/ai/ai.controller.ts                        # envelope wrapper, dispatches to subcontrollers
apps/api/src/ai/services/agent-audit.service.ts
apps/api/src/ai/services/agent-session.service.ts       # stateless: just validates X-Agent-Session-Id format
apps/api/src/ai/util/audit-sanitise.ts
apps/api/src/ai/util/ai-envelope.interceptor.ts         # wraps every response in { ok, output | error, audit }
apps/api/src/ai/dto/                                    # input DTOs per tool
apps/api/src/ai/tools/products/products.ai.controller.ts
apps/api/src/ai/tools/categories/categories.ai.controller.ts
apps/api/src/ai/tools/orders/orders.ai.controller.ts
apps/api/src/ai/tools/rentals/rentals.ai.controller.ts
apps/api/src/ai/tools/inventory/inventory.ai.controller.ts
apps/api/src/ai/tools/product-sizes/product-sizes.ai.controller.ts
apps/api/src/ai/tools/size-guides/size-guides.ai.controller.ts
apps/api/src/ai/tools/rental-policies/rental-policies.ai.controller.ts
apps/api/src/ai/tools/recycle-bin/recycle-bin.ai.controller.ts
apps/api/src/ai/tools/reports/reports.ai.controller.ts
apps/api/src/ai/tools/audit/agent-audit.ai.controller.ts
packages/database/prisma/schema.prisma                  # add AgentAuditLog model
```

Existing files to touch (small):
- `apps/api/src/permissions/permissions.service.ts` — add `ai-agent:use`, `recycle-bin:list`, `product-sizes:*`, `size-guides:*`, `rental-policies:*`.
- `apps/api/src/app.module.ts` — register `AiModule`.
- `apps/storefront/CLAUDE.md` / `apps/api/CLAUDE.md` — add an AI agent section (a single line each).

### Risks
- **Read fan-out volume**: agents tend to call `search_*` and `get_*` chattily. Mitigation: rate-limit `/api/v1/ai/*` per `adminUserId` to ~120 req/min via `@nestjs/throttler` (already installed); cache `AgentAuditLog.actionType='READ'` rows under a 365-day retention (vs. indefinite for writes).
- **Tenant isolation regression**: every tool reuses existing services so `TenantContext.requireId` keeps applying. Verify in tests (see Testing Plan).
- **Permission drift**: new permissions need to be added to existing seed roles in `seed-tenant.js`/`migrate-to-multi-tenant.js`. SUPER_ADMIN should get them all; STAFF/MANAGER get them disabled-by-default until the operator opts in.

### Testing checklist
- [ ] `pnpm -r typecheck` clean.
- [ ] Unit: sanitiser strips `password*`, `secret*`, `token*` (except `approvalToken`); truncates >4KB strings.
- [ ] Integration: each AI route returns 401 without JWT, 403 without `ai-agent:use`, 200 with both.
- [ ] Cross-tenant: tenant A token + `X-Tenant-Id: B` header → 403 (covered by PR-3 behaviour, just confirm).
- [ ] Module-gated: tenant without `rentals` module → 403 on rental tools.
- [ ] Audit row written for every successful AND failed call.
- [ ] Manual smoke: log in as `admin@narofashion.co.tz`, run all 20 read tools, confirm sensible JSON.

### Definition of done
- Phase 1 deploy is green on `prod` and CI.
- Read-only agent loop hits all 20 tools end-to-end against staging tenant.
- Daily audit-log row count is reasonable (< 5,000/day for one active tenant) — monitor for one week before Phase 2.
- Operator-facing announcement: "AI assistant can answer questions about your store but cannot make changes yet."

---

## Phase 2 — Draft creation

### Objective
The agent can create draft records that don't affect customers. Still no approval workflow needed (drafts can't go live).

### Features
- `create_product_draft` — always `isActive: false`.
- `create_category` — categories don't have an `isActive` toggle in the current schema; new categories show up immediately under their parent. **This means category creation actually IS customer-visible** if `parentId` is set to a publicly-listed parent. Mitigation: drafts go to a hidden "Draft" parent automatically unless the operator names a public parent AND the operator has `categories:create`. Phase 2 ships a `categoryDraftMode: 'sandbox' | 'live'` request flag; sandbox is default.
- `create_size` (`isActive: true` ok — sizes don't render publicly until used in a variant).
- `create_size_guide_entry` — `isActive: false` always.
- `update_product` for non-pricing fields on draft products.
- `add_order_note`.

### Endpoints / tools needed
```
POST /api/v1/ai/products/draft
PATCH /api/v1/ai/products/:id              # only non-pricing fields allowed without approval
POST /api/v1/ai/categories
POST /api/v1/ai/product-sizes
POST /api/v1/ai/size-guides                # creates draft
POST /api/v1/ai/orders/:id/notes
```

### Risks
- **Category fan-out**: a wrong `parentId` could put a draft under "Wedding Dresses" and surface it on the storefront before approval. Sandbox-by-default prevents this.
- **Pricing leak via update**: even on a draft, an `update_product` body containing `basePrice` should be rejected without an approval token. Implementation: route-level whitelist of fields per phase.
- **Draft accumulation**: drafts pile up in the admin UI. Mitigation: nightly cron (Phase 4) auto-archives drafts older than 30 days.

### Testing checklist
- [ ] `create_product_draft` always returns `isActive: false`, even if the agent passes `isActive: true`.
- [ ] `update_product` with `basePrice` returns `approval_required` even on drafts.
- [ ] `create_size_guide_entry` defaults `isActive: false`, `isDefault: false`.
- [ ] `add_order_note` appends with `[<adminUserName>, <ISO timestamp>]` prefix; doesn't overwrite existing notes.

### Definition of done
- Operator can dictate a new product end-to-end as a draft, attach images, add variants, get back a stable id.
- Drafts appear in the admin UI under the existing `isActive: false` filter.
- Audit log shows CREATE rows linked to the agent session.

---

## Phase 3 — Approval-based updates

### Objective
The agent can perform destructive / customer-visible writes through the approval workflow.

### Features
- `AgentApprovalRequest` table + flow per `APPROVAL_WORKFLOW.md`.
- Tools that go live: `publish_product`, `update_product` (pricing), `archive_product`, `restore_product`, `delete_category`, `restore_category`, `delete_size`, `restore_size`, `update_size_guide_entry` (with `isActive`/`isDefault`), `delete_size_guide_entry`, `update_order_status`, `update_rental_status`, `mark_rental_returned`, `update_rental_checklist`, `adjust_inventory`, `update_rental_policy`.

### Endpoints / tools needed
- All Phase 3 tool routes from `AI_TOOLS.md`.
- Approval routes:
  ```
  POST /api/v1/ai/approvals/:id/approve
  POST /api/v1/ai/approvals/:id/reject
  GET  /api/v1/ai/approvals?status=PENDING
  GET  /api/v1/ai/approvals/:id
  ```

### Files to create
```
apps/api/src/ai/services/agent-approval.service.ts
apps/api/src/ai/ai-approval.controller.ts
apps/api/src/ai/util/payload-hash.ts                  # canonicalJSON + sha256
apps/api/src/ai/guards/agent-approval.guard.ts        # validates approvalToken on incoming write tools
packages/database/prisma/schema.prisma                # add AgentApprovalRequest
```

### Risks
- **Token replay**: mitigated by `consumedAt` set in the same Prisma transaction as the actual write — a replay races on the row's unique `approvalToken` and loses.
- **Payload tampering**: `payloadHash` recomputed at execute time and compared. Mismatch → 409.
- **Session hijack**: approver must match the JWT `sub` of the original requester. If agents ever run on a different identity than the operator, this rule must be revisited (out of scope for now — agent always runs as the operator).
- **Operator UX confusion**: the system prompt has explicit phrasing ("Reply `approve` to publish, or `cancel`…") to keep the conversation predictable.
- **Approval flood**: SUPER_ADMIN with the agent open could approve dozens of risky things in a session. Mitigation: a daily cap (50 approvals / 24h / adminUserId) with a hard 429 after that — operator can disable in tenant settings if they really need a bulk session.

### Testing checklist
- [ ] Phase 1 tests pass.
- [ ] Approval issuance: POST to a risky tool without token → `approval_required` envelope, AgentApprovalRequest row exists with status PENDING and a 5-min `expiresAt`.
- [ ] `permanently_delete_record` issues a 60-second TTL token only.
- [ ] Token tampering / payload tampering → 409.
- [ ] Token reuse → 410 (already consumed).
- [ ] Approver mismatch (different adminUserId) → 403.
- [ ] Successful execute writes both an `AgentAuditLog` row and an `AdminActivityLog` row, linked by id.
- [ ] CSV export of `AgentAuditLog` includes new `approvalRequestId` column.

### Definition of done
- Operator can publish a product, change a price, soft-delete a category, change an order status, and mark a rental returned — each through a clean approve / approve-token / execute / done flow.
- Activity page (existing `/dashboard/audit-logs` UI) shows AI actions alongside manual UI actions.
- Daily ops digest (manual for now) lists `severity=CRITICAL` rows.

---

## Phase 4 — Full controlled admin assistant

### Objective
Fill in the remaining gaps so the agent covers the full prompt scope (recycle bin, broader CRUD, controlled permanent delete, reports, refunds — if the operator opts in).

### Features
- **Recycle bin**: `restore_deleted_record` for all soft-delete entities, `permanently_delete_record` for `Product` (others remain admin-UI-only until the underlying services support hard delete).
- **Reports export**: CSV downloads via the agent (returns a one-time signed URL).
- **Rental damage**: `record_rental_damage` with deposit deduction, damage row, `DAMAGE` inventory transaction.
- **Reservations**: `reserve_inventory` / `release_inventory` — requires new reservation logic in `inventory.service.ts` (out of scope here; do as a separate API PR).
- **Auto-archive cron**: drafts older than 30 days, READ audit rows older than 365 days, expired approvals.
- **Daily ops digest**: emails CRITICAL audit rows to platform admins.

### Endpoints / tools needed
- `POST /api/v1/ai/products/:id/permanent-delete`
- `POST /api/v1/ai/recycle-bin/:entity/:id/restore`
- `POST /api/v1/ai/recycle-bin/:entity/:id/permanent-delete`
- `POST /api/v1/ai/rentals/:id/damage`
- `POST /api/v1/ai/inventory/reserve`
- `POST /api/v1/ai/inventory/release`
- `POST /api/v1/ai/reports/<name>/export`

### Risks
- **Permanent delete blast radius**: hard-deleting a Product cascades to `ProductVariant`, `ProductImage`, `ProductVideo`, `WishlistItem`, `CartItem`. Verify Prisma `onDelete` behaviour first; ensure no cross-tenant leakage via FK confusion.
- **Refunds / payments**: out of scope for Phase 4 unless explicitly requested. The platform has `PaymentMethod`, `Payment`, and gateway providers (Selcom, ClickPesa) — if added later, refunds get the strictest approval rules (fresh token, dual-approver if amount > X TZS, full audit, no caching anywhere).
- **CSV signed URL leakage**: 5-minute TTL, single-use, scoped to `adminUserId`.

### Testing checklist
- [ ] Phase 3 tests pass.
- [ ] Permanent-delete dry run: trigger on a test Product, confirm hard delete + cascade + AgentAuditLog row with severity CRITICAL.
- [ ] Reservation flow: reserve 2 units, then release 1, verify variant stock and `InventoryTransaction` rows.
- [ ] Auto-archive cron: drops READ audit rows older than 365 days; doesn't touch writes.
- [ ] Daily digest email contains all CRITICAL rows from the prior day, no duplicates.

### Definition of done
- Operator can run the full cycle from idea → draft → publish → adjust inventory → close out a rental → archive the product → restore it → permanently delete a long-archived record, all via the agent, all logged, all approved where required.
- One full week of production usage with zero unplanned status changes (audit logs reviewed manually).

---

## Cross-phase dependencies

| Need | Where it lives | Phase added |
|---|---|---|
| `ai-agent:use` permission | seed | Phase 1 |
| `AgentAuditLog` model | prisma schema | Phase 1 |
| `AgentApprovalRequest` model | prisma schema | Phase 3 |
| Sanitiser | `apps/api/src/ai/util/audit-sanitise.ts` | Phase 1 |
| Envelope interceptor | `apps/api/src/ai/util/ai-envelope.interceptor.ts` | Phase 1 |
| Approval guard | `apps/api/src/ai/guards/agent-approval.guard.ts` | Phase 3 |
| Throttler on `/api/v1/ai/*` | existing `ThrottlerModule` config | Phase 1 |
| Daily cron jobs | existing `SchedulerModule` | Phase 4 |

## Operator rollout plan

1. Phase 1 ships → enable for SUPER_ADMIN of one pilot tenant (Naro Fashion itself). Run for one week. Read-only — risk is low.
2. Phase 2 ships → still pilot tenant. Operator drafts 5+ products through the agent.
3. Phase 3 ships → still pilot tenant. Operator runs through every approval-gated tool with a test record.
4. Phase 4 ships → roll out to other tenants opt-in via a tenant-level `ai_agent_enabled` SiteSetting.

## Out of scope (explicitly)

- Storefront customer-facing AI chat (different agent, different scope).
- Marketing copy generation, image generation, translations — separate skills.
- Tenant management, billing, plan changes — platform-admin territory.
- Email mailbox creation / domain management — different service.
- POS shift management automation — high-trust live-money operations; manual UI only.
