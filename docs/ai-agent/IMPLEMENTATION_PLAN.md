# Naro Fashion — AI Admin Agent Implementation Plan

Four phases. Each phase is independently shippable to production behind the `ai-agent:use` permission flag (no flag = no agent surface). The agent stays read-only until Phase 2 ships, write-on-drafts until Phase 3 ships, fully active when Phase 4 ships.

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
