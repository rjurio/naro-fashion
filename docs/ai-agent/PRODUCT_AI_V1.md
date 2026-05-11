# Product AI v1 — Consolidation Reference

**Status**: ratified 2026-05-11 after Phase 3.1B.γ shipped (`update_draft_product`).

**Purpose**: single canonical reference for the AI agent's product-management surface. Every product-related AI route, validator, permission, lifecycle transition, audit invariant, and out-of-scope tool is listed here. If you want to know "what can the agent do to a product" — start here.

**Cross-references**:
- [`PHASE_3_DESIGN.md`](./PHASE_3_DESIGN.md) — approval workflow design (token hashing, four-eyes, TTL, etc.)
- [`PRODUCT_LIFECYCLE.md`](./PRODUCT_LIFECYCLE.md) — state machine + admin paths
- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — per-phase rollout history
- [`AI_TOOLS.md`](./AI_TOOLS.md) — tool catalogue
- [`apps/api/src/ai/controllers/`](../../apps/api/src/ai/controllers/) — actual route source

---

## 1. Product AI tool roster

Six product-touching AI tools are live as of Phase 3.1B.γ:

| Tool | Kind | Approval | Risk / TTL | Permission to invoke | First shipped |
|---|---|:---:|---|---|---|
| `search_products` | **Read** | — | — | `ai-agent:read` | Phase 1 |
| `get_product` | **Read** | — | — | `ai-agent:read` | Phase 1 |
| `create_product_draft` | **Draft write** | — | — | `ai-agent:write-drafts` | Phase 2 |
| `publish_product` | **Lifecycle (approval-gated)** | YES (four-eyes) | HIGH / 2 min | `ai-agent:write-drafts` (initiate); `ai-agent:approve` (approve) | 3.1A |
| `archive_product` | **Lifecycle (approval-gated)** | YES (four-eyes) | HIGH / 2 min | `ai-agent:write-drafts` (initiate); `ai-agent:approve` (approve) | 3.1B |
| `restore_product` | **Lifecycle (approval-gated)** | YES (four-eyes) | HIGH / 2 min | `ai-agent:write-drafts` (initiate); `ai-agent:approve` (approve) | 3.1B.β |
| `update_draft_product` | **Metadata write (approval-gated)** | YES (four-eyes) | MEDIUM / 5 min | `ai-agent:write-drafts` (initiate); `ai-agent:approve` (approve) | 3.1B.γ |

All approval-gated tools share the Phase 3.1A approval workflow: hashed token (sha256), `payloadHash` binding, `expectedUpdatedAt` stale-data guard, 3-attempt retry cap, four-eyes runtime check, `ApprovalExpiryCron` TTL sweep, and audit linkage via `approvalRequestId`.

---

## 2. Route inventory

### Live `/api/v1/ai/products/*`

| Verb | Path | Tool | Permission |
|---|---|---|---|
| GET | `/api/v1/ai/products/search` | `search_products` | `ai-agent:read` |
| GET | `/api/v1/ai/products/:id` | `get_product` | `ai-agent:read` |
| POST | `/api/v1/ai/products/draft` | `create_product_draft` | `ai-agent:write-drafts` |
| POST | `/api/v1/ai/products/:id/publish/request-approval` | `publish_product` (initiate) | `ai-agent:write-drafts` |
| POST | `/api/v1/ai/products/:id/archive/request-approval` | `archive_product` (initiate) | `ai-agent:write-drafts` |
| POST | `/api/v1/ai/products/:id/restore/request-approval` | `restore_product` (initiate) | `ai-agent:write-drafts` |
| POST | `/api/v1/ai/products/:id/update-draft/request-approval` | `update_draft_product` (initiate) | `ai-agent:write-drafts` |

### Live `/api/v1/ai/approvals/*` (shared management surface)

| Verb | Path | Permission |
|---|---|---|
| GET | `/api/v1/ai/approvals?status=` | `ai-agent:read` |
| GET | `/api/v1/ai/approvals/:id` | `ai-agent:read` |
| POST | `/api/v1/ai/approvals/:id/approve` | `ai-agent:approve` (not initiator) |
| POST | `/api/v1/ai/approvals/:id/reject` `{reason}` | `ai-agent:approve` (not initiator) |
| POST | `/api/v1/ai/approvals/:id/revoke` `{reason?}` | `ai-agent:approve` (original approver) |
| POST | `/api/v1/ai/approvals/:id/cancel` | `ai-agent:write-drafts` (initiator only, PENDING) |
| POST | `/api/v1/ai/approvals/:id/execute` `{approvalToken}` | `ai-agent:write-drafts` (initiator only) |

### Route classification

| Kind | Routes |
|---|---|
| Read-only | `GET /ai/products/search`, `GET /ai/products/:id`, `GET /ai/approvals`, `GET /ai/approvals/:id` |
| Draft creation | `POST /ai/products/draft` |
| Approval request only (initiate) | `POST /ai/products/:id/publish/request-approval`, `…/archive/request-approval`, `…/restore/request-approval`, `…/update-draft/request-approval` |
| Approval management | `POST /ai/approvals/:id/{approve,reject,revoke,cancel,execute}` |
| Forbidden / NOT implemented | `POST /ai/products/:id/publish` (direct), `…/archive` (direct), `…/restore` (direct), `…/update-draft` (direct), `PATCH /ai/products/:id`, `PUT /ai/products/:id`, `DELETE /ai/products/:id`, `…/permanent-delete`, `POST /ai/inventory/adjust`, `POST /ai/orders/:id/status`, `POST /ai/rentals/:id/return`, `POST /ai/refund`, `PATCH /ai/rental-policies` |

---

## 3. Security invariants — verified

### No direct write endpoints

Every lifecycle / metadata mutation goes through the request-approval form. The direct verbs are forbidden:
- `POST /ai/products/:id/publish` — 404 (verified live)
- `POST /ai/products/:id/archive` — 404 (verified live)
- `POST /ai/products/:id/restore` — 404 (verified live)
- `POST /ai/products/:id/update-draft` — 404 (verified live)
- `PATCH /ai/products/:id` — 404 (verified live)
- `PUT /ai/products/:id` — 404 (verified live; PUT not registered on any AI controller)
- `DELETE /ai/products/:id` — 404 (verified live)

Build-time guards in [`phase-3-foundation.spec.ts`](../../apps/api/src/ai/phase-3-foundation.spec.ts):
- `@RequiresApproval(…)` appears on exactly **4** routes — all on `products.ai.controller.ts`.
- For each lifecycle verb (archive / restore / update-draft), the direct form (`@Post(':id/<verb>')`, `@Patch(':id/<verb>')`, `@Delete(':id/<verb>')`) is explicitly rejected by an `expect(stripped).not.toMatch(...)` assertion.

Build-time guards in [`ai-controllers.shape.spec.ts`](../../apps/api/src/ai/controllers/ai-controllers.shape.spec.ts):
- `@Patch(` / `@Put(` / `@Delete(` are forbidden across the entire AI controllers tree.
- `@Post(...)` is permitted only against an exhaustive allowlist (5 entries on `products.ai.controller.ts`).

### No risky tool beyond the four lifecycle verbs + draft creation

Asserted at build time via `phase-3-foundation.spec.ts` `FORBIDDEN_RISKY_PATH_FRAGMENTS`:
- `/adjust` (inventory)
- `:id/return` (rental return)
- `/permanent-delete`
- `/refund`, `/refunds`
- `/status` (order/rental status)
- `rental-policies`

Asserted at runtime by smoke probes — all return 404 on prod.

### Public storefront response whitelist

`apps/api/src/products/products.service.ts` exposes products via two selects:
- `publicProductListSelect` — used by `GET /products` (anonymous storefront list).
- `publicProductDetailSelect` — used by `GET /products/:slug` (anonymous storefront detail).

Both explicitly exclude: `tenantId`, `purchasePrice`, `minimumStock`, `supplierName`, `supplierContact`, `lastRestockedAt`, `deletedAt`, `updatedAt`, `archivedAt`, `isActive` (implicit — always true for public reads). Variant `barcode` is also excluded (POS-only).

`products.service.spec.ts` `ADMIN_ONLY_FIELDS` table asserts every one of these is absent from both selects as a regression guard.

---

## 4. Approval model — verified

### Four-eyes runtime check

Both `approve()` and `reject()` compare `request.user.id` against `row.requestedByAdminUserId`. Self-approval → 403 `forbidden_self_approval` + `SELF_APPROVAL_BLOCKED` audit row at WARNING severity. SUPER_ADMIN cannot self-approve either; the check fires regardless of role.

Tests:
- Approve self-block: `approval.service.spec.ts` #5 (publish), #A8 (archive), R8 (restore), U18 (update_draft).
- Reject self-block: covered by the same code path.

### Token issuance — return-once

Approval responds with the raw token EXACTLY ONCE in the HTTP response body. The server persists ONLY `sha256(rawToken)` to `AgentApprovalRequest.approvalTokenHash`. The hash is cleared after CONSUMED / REVOKED / EXHAUSTED.

Tests:
- H1 (return-once contract), H2 (sanitiser has no allowlist), H3 (auditOutput strips raw token from runner audit), H4 (execute logs `tokenProvided` boolean), H5 (GET /:id never exposes hash), H6 (GET list never exposes hash), H7 (CONSUMED clears hash), H8 (REVOKED clears hash), H9 (end-to-end: no 64-hex in any audit call).
- HR1-HR5 source-text invariants (re-hardening pass): tokenHashPrefix is only used in execute, dto.approvalToken read only by execute, `ApprovalRequestSummary` type has no `approvalTokenHash` field, `toSummary` reads `row.approvalTokenHash` once for the `tokenIssued` boolean only.

### Token logging — forensic correlation only

The execute audit row carries `tokenProvided: true` + `tokenHashPrefix: <first 6 hex of sha256(rawToken)>`. 24 bits — no preimage threat. The raw token never appears in any audit row, any log file, any GET endpoint, or any error message.

A defensive sanitiser ([`AiSanitizerService`](../../apps/api/src/ai/services/ai-sanitizer.service.ts)) redacts any key matching `/approvaltoken/` (covers camelCase + snake_case + kebab-case) before persistence. The allowlist that previously preserved `approvalToken` was REMOVED in the 2026-05-11 hardening pass after the first production smoke leaked five raw tokens. Those rows were redacted in place; the sanitiser now closes the hole at the source.

---

## 5. Public safety — verified

Public visibility is gated by ONE rule: `isActive: true AND deletedAt: null`. `archivedAt` is admin-only metadata; it never gates customer-facing reads.

| Product state | `isActive` | `archivedAt` | `deletedAt` | Public storefront sees it? |
|---|:---:|:---:|:---:|:---:|
| DRAFT | `false` | `null` | `null` | **NO** ✓ |
| ACTIVE | `true` | `null` | `null` | YES |
| ARCHIVED | `false` | `<Date>` | `null` | **NO** ✓ (isActive=false filters it) |
| SOFT_DELETED | any | any | `<Date>` | **NO** ✓ (deletedAt filters it) |

All four non-public states return 404 on `GET /products/:slug`. Verified live and asserted by `products.service.spec.ts`:
- `findBySlug` test "throws 404 for an inactive product (DRAFT)" + "throws 404 for a soft-deleted product".
- Implicit for ARCHIVED: `isActive=false` is the same filter that catches DRAFT.

---

## 6. Field safety for `update_draft_product` — verified

### Allowed fields (16, locked allow-list)

```
name, nameSwahili, slug, description, descriptionSwahili,
categoryId, availabilityMode, specifications, sku,
minimumStock, supplierName, supplierContact,
minRentalDays, maxRentalDays, bufferDaysOverride, sizeGuideId
```

Single source of truth: `UPDATE_DRAFT_ALLOWED_FIELDS` constant exported from [`update-draft-product.ai.dto.ts`](../../apps/api/src/ai/dto/update-draft-product.ai.dto.ts). Used by:
1. The DTO (one decorated property per field) — wire-level whitelist via global `ValidationPipe` `forbidNonWhitelisted: true`.
2. The consume-time filter in `ApprovalService.execute()` — defence-in-depth allow-list re-iteration.

### Forbidden fields — return 400 `property X should not exist`

Pricing: `basePrice`, `compareAtPrice`, `purchasePrice`, `rentalPricePerDay`, `rentalDepositAmount`, `rentalDownPaymentPct`, `latePenaltyPercent`.
Lifecycle: `isActive`, `archivedAt`, `deletedAt`, `published`, `status`, `isFeatured`.
Inventory / transactional: `stock`, `paymentMethodId`, `orderStatus`, `rentalStatus`, `transactionRef`.
Anything else: returned as `property X should not exist` at the wire.

Tests:
- DTO whitelist: `update-draft-product.ai.dto.spec.ts` — `it.each` over all 18 forbidden field names, asserts none are declared on the DTO.
- Defence-in-depth: `approval.service.spec.ts` U23 — simulates a tampered `inputJson` carrying `basePrice/compareAtPrice/rentalPricePerDay/isActive/archivedAt/stock` and asserts the consume `prisma.product.update` only includes `{name}` (the one allowed field).
- Empty payload: U6 (validator rejects with `No changes detected`).
- No-actual-changes: U6 (same path — validator's diff computation returns zero changes).

### Approval row stores only changed fields

`beforeValues` and `afterValues` contain ONLY the fields where the submitted value differs from the current product value. Tested by U15: operator submits 4 fields, only 2 differ, the approval row carries 2 keys in each snapshot.

---

## 7. Admin visibility — unchanged

Admin paths see every product in every state (except permanent-deleted which is, by definition, gone):

| Product state | Admin route |
|---|---|
| DRAFT | `GET /products/admin` (admin list, no `isActive` filter) |
| ACTIVE | `GET /products/admin` (same) |
| ARCHIVED | `GET /products/admin` (same; `archivedAt` not filtered) |
| SOFT_DELETED | `GET /products/deleted` (recycle bin) |
| (permanent-deleted) | gone — admin must rely on git history / backups |

The AI agent's `search_products` tool uses `productsService.findAllAdmin()` (admin path) so the agent sees drafts, archived rows, and active rows. It does NOT see soft-deleted rows (those are served by a separate recycle-bin tool which Phase 4 will gate).

---

## 8. Audit and token invariants — recap

Every approval-gated tool produces a linked audit chain on `AgentAuditLog.approvalRequestId`:

| Step | actionType | severity | Linked? | Tested by |
|---|---|---|---|---|
| Initiate | `APPROVAL_REQUESTED` | NOTICE | YES | every initiate test |
| Self-approval attempt | `SELF_APPROVAL_BLOCKED` | WARNING | YES | #5/#A8/R8/U18 |
| Approve | `APPROVAL_GRANTED` | NOTICE | YES | approve tests |
| Reject | `APPROVAL_REJECTED` | NOTICE | YES | reject tests |
| Revoke | `APPROVAL_REVOKED` | NOTICE | YES | revoke tests |
| Cancel | `APPROVAL_CANCELLED` | INFO | YES | cancel tests |
| Expire (TTL sweep) | `APPROVAL_EXPIRED` | INFO | YES | (cron, tested separately) |
| Exhaust (3 retries) | `APPROVAL_EXHAUSTED` | WARNING | YES | retry-cap tests |
| Execute success | `PUBLISH` / `ARCHIVE` / `RESTORE` / `UPDATE` | NOTICE | YES | each execute test |

Token invariants (asserted by source-text + runtime tests):
- Raw approval token is generated, returned to approver exactly once, **never** persisted.
- Only `sha256(rawToken)` is stored on `AgentApprovalRequest.approvalTokenHash`.
- Hash is cleared on CONSUMED, REVOKED, EXHAUSTED, or stale-data/payload-mismatch invalidation.
- Audit GET endpoints (`GET /ai/approvals`, `GET /ai/approvals/:id`) expose `tokenIssued: boolean` only — never the raw token, never the hash.
- Execute audit input carries `tokenProvided: true` + `tokenHashPrefix: <6 hex>` for forensic correlation. 24 bits — no preimage threat.

---

## 9. Test coverage — confirmed

**Total: 470 tests across 13 suites passing on commit `c46ec9b`. TypeScript strict mode clean on api + admin + storefront.**

### Map of tool → primary test file

| Tool | Test file | Notable tests |
|---|---|---|
| `search_products` / `get_product` | (covered by Phase 1 read-only invariants — `ai-controllers.shape.spec.ts`) | The read-only shape spec asserts no `@Patch/@Put/@Delete` and the @Post allowlist; these read routes have no specific spec because they're thin wrappers over `ProductsService.findAllAdmin` / `findById` whose own coverage lives in `products.service.spec.ts`. |
| `create_product_draft` | `create-product-draft.ai.dto.spec.ts` | DTO whitelist rejects pricing fields. |
| `publish_product` | `approval.service.spec.ts` describe `findBySlug — PUBLIC route, drafts MUST NOT leak` + `Phase 3.1A structural invariants` + `archivedAt lifecycle marker` | Tests #1-#22 + H1-H9 + HR1-HR5 + archived-rejection. |
| `archive_product` | `approval.service.spec.ts` describe `archive_product — request, approve, execute` | Tests #A1-A19b + the lifecycle marker block. |
| `restore_product` | `approval.service.spec.ts` describe `restore_product — request, approve, execute` | Tests R1-R22. |
| `update_draft_product` | `approval.service.spec.ts` describe `update_draft_product — request, approve, execute` + `update-draft-product.ai.dto.spec.ts` | Tests U1-U34 + 18 DTO whitelist tests. |
| Public visibility | `products.service.spec.ts` describe `findBySlug — PUBLIC route` + `Response whitelist` | 12 admin-only fields × 2 selects (list + detail) + storefront-required field coverage. |
| Token hardening | `approval.service.spec.ts` describe `Token hardening` + `ai-sanitizer.service.spec.ts` | H1-H9 + HR1-HR5 + 18 sanitiser tests. |
| Schema + lifecycle invariants | `phase-3-foundation.spec.ts` | Product.archivedAt column, AgentApprovalRequest model shape, AgentAuditLog ↔ approval linkage, 4 `@RequiresApproval` decorators count assertion, "only Post containing publish/archive/restore/update-draft" assertion. |
| AI controller shape | `ai-controllers.shape.spec.ts` | No `@Patch/@Put/@Delete`; @Post allowlist exhaustive; guard stack present. |

### Suite breakdown

```
PASS src/ai/util/ai-envelope.spec.ts
PASS src/ai/controllers/ai-controllers.shape.spec.ts
PASS src/ai/phase-3-foundation.spec.ts
PASS src/ai/services/ai-sanitizer.service.spec.ts
PASS src/ai/services/ai-roles-seeder.service.spec.ts
PASS src/ai/guards/ai-permission.guard.spec.ts
PASS src/ai/dto/create-product-draft.ai.dto.spec.ts
PASS src/ai/dto/update-draft-product.ai.dto.spec.ts
PASS src/ai/services/ai-audit.service.spec.ts
PASS src/ai/services/approval.service.spec.ts
PASS src/products/products.service.spec.ts
PASS src/size-guides/size-guides.service.spec.ts
PASS src/size-guides/size-guides.controller.shape.spec.ts
```

---

## 10. Known limitations

### 10.1 Legacy admin shortcut bypasses four-eyes

`PATCH /products/:id/toggle-active` (the admin "publish/unpublish" button) flips `isActive` AND symmetrically manages `archivedAt` (lifecycle-symmetric since the 2026-05-11 review fix). Admin can produce DRAFT → ACTIVE or ACTIVE → ARCHIVED transitions without going through the AI approval workflow. By design — operators with `AdminGuard` are trusted at the platform level. Audit row is preserved via `AdminActivityLog.action='TOGGLE_ACTIVE'` (single-admin audit). Tenants who require approval for ALL state changes should revoke `AdminGuard` access from the relevant accounts and route via the AI agent.

### 10.2 No AI surface for permanent delete

By design (`PHASE_3_DESIGN.md` Decision Log #9). Permanent delete is admin-only via `DELETE /products/:id/permanent`. The cascade audit for `Product` references (OrderItem, RentalOrder, WishlistItem, CartItem, InventoryTransaction, FlashSaleItem, etc.) has not been done; Phase 4 will revisit with multi-approver after the audit.

### 10.3 No AI surface for pricing / inventory / order / rental status / refunds

Out of Phase 3 entirely per `PHASE_3_DESIGN.md` Decision Log #10 (refunds) and per separate subsystems (pricing audit, stock reconciliation). Pricing fields are blocked at every layer: DTO whitelists, validator allow-lists, consume-time field filters.

### 10.4 SUPER_ADMIN still has `ai-agent:approve` (Phase 3.2 pending)

The 2026-05-10 rollout backfilled SUPER_ADMIN with all four AI permissions (`:use`, `:read`, `:write-drafts`, `:approve`) so admins kept working during the Phase 3 rollout. Per Decision Log #2 + #5, Phase 3.2 will revoke `:approve` from SUPER_ADMIN ~2-4 weeks after 3.1 soak. End state: AI approval power must be intentionally granted via the `AI_AGENT_APPROVER` role.

### 10.5 Approval admin UI is API-only

Operators submit approvals + approvers act on them via raw HTTP. Phase 4 will ship `/dashboard/ai/approvals` for ergonomics. Until then, audit trails are inspectable via `GET /api/v1/ai/approvals?status=PENDING` + `GET /api/v1/ai/approvals/:id`.

### 10.6 Two different "restore" verbs

- `PATCH /products/:id/restore` — admin recycle-bin restore (clears `deletedAt` only).
- `POST /api/v1/ai/products/:id/restore/request-approval` — AI lifecycle restore (clears `archivedAt`, sets `isActive=true`).

Same name, different semantics, different audit trails. See [`PRODUCT_LIFECYCLE.md`](./PRODUCT_LIFECYCLE.md) §5 for the full distinction.

---

## 11. Explicitly out of scope (Phase 3 + 4 hold the line)

### Never going to the AI agent

- Per-tool auto-approval (defeats the four-eyes rule).

### Out of Phase 3 — needs its own design

- Refunds and any `Payment` mutation (Decision Log #10).
- Bulk operations (`bulk_publish_*`, `bulk_archive_*` etc.) — single-resource only in Phase 3.

### Out until Phase 4 multi-approver + subsystems ship

- Price changes (`basePrice`, `compareAtPrice`, `rentalPricePerDay`, etc.).
- Inventory adjustments (`stock`, `minimumStock` re-orchestration).
- Order status changes.
- Rental status changes (mark returned, record damage).
- Rental policy updates (tenant-wide blast radius — CRITICAL risk).
- Permanent delete (Decision Log #9).
- Multi-approver escalation for CRITICAL actions.

---

## 12. Production smoke artefacts inventory (as of 2026-05-11)

The following non-customer-facing rows were created during AI development smoke tests. **None are public-visible** (drafts/inactives), but they clutter the admin surface. Catalogued here so a future cleanup can sweep them deterministically; no deletes performed in this consolidation review.

### Smoke products (1 row)

| ID | Name | Lifecycle | Notes |
|---|---|---|---|
| `cmp02f0ya001lcsafed1awvpn` | "Updated Smoke Draft" | DRAFT | Created via Phase 2 `create_product_draft`. Renamed twice during 3.1B.γ smoke. No images, no variants, basePrice=0 — fails publish validation. Safe to permanent-delete. |

### Smoke size guides (1 row)

| ID | Name | Lifecycle | Notes |
|---|---|---|---|
| `cmp02f309001rcsafy7oxxrf6` | "AI P2 Smoke Guide" | inactive | Created via Phase 2 `create_size_guide_entry`. Not assigned to any product. Safe to permanent-delete. |

### Smoke product sizes (4 rows)

| ID | Name | Notes |
|---|---|---|
| `cmp07onki002acszksj5pb8tk` | "P30-1778444074" | Phase 2 size-creation smoke |
| `cmp08b8z5001mcsjy70yugjh2` | "P72-1778445128" | Phase 2 size-creation smoke |
| `cmp08v8nf001qcswvjilune43` | "sf-fix-1778446060" | Hotfix smoke |
| `cmp0973xw001ocsaw0bmi7kvr` | "sg-fix-1778446614" | Hotfix smoke |

All active, none referenced by any active `ProductVariant.size` field. Safe to soft-delete or hard-delete.

### Smoke customer (1 row in `User` table)

| ID | Email | Notes |
|---|---|---|
| `cmp0pzwe8001mcsq6xfba1hkr` | `size-guard-smoke-1778474831@example.com` | Created during the AdminGuard smoke for size-guides. No orders, no cart, no rentals. Safe to hard-delete. |

### Smoke admin user (1 row — RETAIN)

| ID | Email | Role | Notes |
|---|---|---|---|
| `cmp0smkp90001cs6sn9wdv5gy` | `approver-smoke@narofashion.co.tz` | SUPER_ADMIN | **Currently used as the second admin for four-eyes smoke testing** in every Phase 3 deploy. **Do NOT delete** — recreating it on every smoke is friction. Either rename it to `qa-approver@...` to communicate purpose, OR leave as-is. |

### Approval requests (14 rows)

| Status | Count |
|---|---|
| CONSUMED | 11 |
| EXPIRED | 3 |
| PENDING / APPROVED | 0 (no live approvals) |

All terminal. No `approvalTokenHash` is non-null on any row (cleared after consume/revoke/expire). The rows ARE useful audit history — preserve as-is or archive older than 90 days.

### Audit log totals

- `AgentAuditLog`: 134 rows total. All clean of raw-token leaks (verified by the full-table scan in commit `8bcffcb` + post-deploy scans on every Phase 3.1 PR).

---

## 13. Recommended cleanup plan (no execution yet)

**Phase A — soft delete the safe-to-delete artefacts** (single SQL script, idempotent):

```sql
-- Soft-delete the 1 smoke product
UPDATE "Product" SET "deletedAt" = NOW(), "isActive" = false
 WHERE id = 'cmp02f0ya001lcsafed1awvpn' AND "deletedAt" IS NULL;

-- Soft-delete the 1 smoke size guide
UPDATE "SizeGuide" SET "deletedAt" = NOW(), "isActive" = false
 WHERE id = 'cmp02f309001rcsafy7oxxrf6' AND "deletedAt" IS NULL;

-- Soft-delete the 4 smoke product sizes
UPDATE "ProductSize" SET "deletedAt" = NOW(), "isActive" = false
 WHERE id IN (
   'cmp07onki002acszksj5pb8tk',
   'cmp08b8z5001mcsjy70yugjh2',
   'cmp08v8nf001qcswvjilune43',
   'cmp0973xw001ocsaw0bmi7kvr'
 ) AND "deletedAt" IS NULL;
```

Soft-delete (not hard-delete) — keeps the audit trail referenceable. The rows can be hard-deleted later via the recycle-bin admin UI if the cluster is bothersome.

**Phase B — handle the smoke customer**:
- Option B1: hard-delete via Prisma (`prisma.user.delete`). Safe — no orders, no cart, no rentals.
- Option B2: rename to `qa-customer@narofashion.co.tz`, mark inactive. Keeps it as a permanent-fixture test account.

Recommended: B2 (rename + deactivate). Recreating a test customer on every smoke is friction; a fixture account is more useful long-term.

**Phase C — rename the smoke admin (optional)**:
- Rename `approver-smoke@narofashion.co.tz` → `qa-approver@narofashion.co.tz`. Same row, clearer label. Keep SUPER_ADMIN role.

**Phase D — approval log retention** (defer until ~3 months of soak):
- After 90 days, archive consumed/expired `AgentApprovalRequest` rows to a separate audit-archive table. Audit log size will grow indefinitely otherwise. Not urgent — 14 rows is nothing.

**Important**: do all four phases in a single transactional script, behind a `--dry-run` flag for the first invocation. No deletes outside that script.

---

## 14. Recommended next roadmap

User-stated preference: **A → B → C → D → defer everything in E**. The recommendation matches.

| Step | Activity | Effort | Risk | When |
|---|---|---|---|---|
| **A.** Admin UI for approvals / review dashboard | `/dashboard/ai/approvals` page in `apps/admin/` showing pending/approved/recent approvals + approve/reject buttons. Reuses the existing `GET /ai/approvals` API. | medium (Next.js page + form + token-fetch wiring) | low (read + 1 mutation, no schema change) | NEXT |
| **B.** Cleanup of smoke artefacts | Run the SQL script from §13. Maybe rename the smoke admin. | tiny | tiny | concurrent with A |
| **C.** Role assignment workflow | Add a UI on `/dashboard/settings/roles` for assigning `AI_AGENT_OPERATOR` / `AI_AGENT_APPROVER` to admin accounts. The roles are seeded; admins just need to click. | medium | low | after A |
| **D.** Non-pricing category / size-guide tools | `update_category`, `add_size_to_size_guide`, `reorder_product_images` — all DRAFT-only or read-then-write with the same four-eyes pattern. | small per tool | medium (each one is its own validator + dispatch case + 25 tests) | after C |
| **E.** Pricing / inventory / order / rental / refunds / permanent delete | DEFERRED — needs subsystem-specific design (pricing-audit, stock-reconciliation, payment-gateway controls, FK cascade audit, multi-approver). Phase 4 work. | large | high | not soon |

**My recommended NEXT action**: step **A** (approval admin UI). Reasons:
1. Operators currently approve via raw HTTP. Friction. An admin UI removes the friction AND surfaces the approval queue so an approver doesn't miss requests.
2. The token-fetch path is already documented in `PHASE_3_DESIGN.md` §5 (the "in-memory queue" → `GET /api/v1/ai/approvals/:id/redeemable-token` flow). A UI can wire this end-to-end.
3. Zero new tools, zero new risk surface, zero schema change. Pure ergonomics — and unlocks the rest of the roadmap (operators can now USE the four AI tools without the curl dance).

Step B (smoke cleanup) takes ~5 minutes once we agree on the SQL. Could run before A if desired.

---

**Document version**: 1.0 (2026-05-11). Update when a new product AI tool ships or when a Phase 4 subsystem changes the security model.
