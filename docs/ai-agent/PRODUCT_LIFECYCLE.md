# Product Lifecycle — AI-Controlled State Machine

**Status**: ratified 2026-05-11 after Phase 3.1B.β shipped (`publish_product`, `archive_product`, `restore_product`).

**Purpose**: this document is the canonical reference for how a `Product` row moves between lifecycle states, which AI tools mediate which transitions, and which admin paths intentionally bypass the approval gate. It also catalogues the forbidden transitions and the side-channel paths an operator must NOT confuse with the AI flow.

**Cross-references**:
- [`PHASE_3_DESIGN.md`](./PHASE_3_DESIGN.md) — approval workflow design (token hashing, four-eyes, TTL, etc.)
- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — per-phase rollout status
- [`AI_TOOLS.md`](./AI_TOOLS.md) — AI tool catalogue
- [`apps/api/src/products/products.service.ts`](../../apps/api/src/products/products.service.ts) — admin product service (`toggleActive`, `delete`, recycle-bin `restore`, `permanentDelete`)
- [`apps/api/src/ai/services/approval.service.ts`](../../apps/api/src/ai/services/approval.service.ts) — AI approval orchestrator (publish/archive/restore dispatch)

---

## 1. Lifecycle states

A `Product` row is in **exactly one** of four states at any time. State is derived from three columns: `isActive: Boolean`, `archivedAt: DateTime?`, `deletedAt: DateTime?`. No `status` enum — the columns ARE the state.

| State | `isActive` | `archivedAt` | `deletedAt` | Public storefront sees it? | Admin sees it? |
|---|:---:|:---:|:---:|:---:|:---:|
| **DRAFT** | `false` | `null` | `null` | NO | YES (`/products/admin`) |
| **ACTIVE** | `true` | `null` | `null` | **YES** | YES (`/products/admin`) |
| **ARCHIVED** | `false` | `<Date>` | `null` | NO | YES (`/products/admin`) |
| **SOFT_DELETED** | any | any | `<Date>` | NO | YES, but only via recycle bin (`/products/deleted`) |

**State transitions**:
```
                  ┌────── publish_product ──────┐
                  │                              │
              ┌── DRAFT ──┐                  ┌─→ ACTIVE ───┐
              │           │                  │              │
              ▼           │                  │              │
       (admin draft       │                  │              ▼
        creation)         │                  │         archive_product
                          │                  │              │
                          │     ┌────── ARCHIVED ←─────────┘
                          │     │                              
                          │     │                              
                          │     └────── restore_product ───→ ACTIVE
                          │
                          ▼
                   any state → admin DELETE → SOFT_DELETED
                                            ↑ (recycle-bin restore clears
                                              deletedAt only; isActive
                                              + archivedAt stay where they
                                              were before delete)
```

The lifecycle is a finite directed graph; every legal transition is mediated by either an AI tool (with four-eyes approval) or an admin manual path (with audit log but no approval).

---

## 2. Public visibility rule

**Public storefront visibility is gated by `isActive: true AND deletedAt: null` ONLY.**

`archivedAt` is **never** part of the public WHERE clause:

```typescript
// apps/api/src/products/products.service.ts — findAll
const where = { tenantId: this.tenantContext.requireId, isActive: true, deletedAt: null };

// apps/api/src/products/products.service.ts — findBySlug
const product = await this.prisma.product.findFirst({
  where: { slug, tenantId: this.tenantContext.requireId, isActive: true, deletedAt: null },
  select: publicProductDetailSelect,
});
```

Why this is correct:
- Archived products have `isActive: false` → already filtered out by the existing storefront guard. Adding `archivedAt: null` to the filter would be redundant AND would break "DRAFT product → public 404" semantics (drafts have `archivedAt: null` and would falsely satisfy a `WHERE archivedAt IS NULL` clause as if visible).
- The four-state matrix maps cleanly to "public 200 iff state == ACTIVE". Every other state returns 404.

**`archivedAt` is admin-lifecycle metadata only.** It is never returned in a public response either: `publicProductListSelect` and `publicProductDetailSelect` exclude it explicitly, and a regression test asserts this in [`products.service.spec.ts`](../../apps/api/src/products/products.service.spec.ts) via the `ADMIN_ONLY_FIELDS` table.

---

## 3. AI lifecycle tools (approval-gated)

All three tools share the Phase 3.1A approval workflow: HIGH risk (2-min TTL), four-eyes (different admin must approve), hashed token storage, `payloadHash` binding, `expectedUpdatedAt` stale-data guard, 3-attempt retry cap, and audit linkage via `approvalRequestId`.

| Tool | From state | To state | Validator | Consume write |
|---|---|---|---|---|
| **publish_product** | DRAFT | ACTIVE | `PublishValidationService.validatePublishable` — requires `isActive=false, archivedAt=null, deletedAt=null` AND name+slug+category+≥1 image+basePrice>0 AND mode-specific variant/rental checks | `{ isActive: true, archivedAt: null }` |
| **archive_product** | ACTIVE | ARCHIVED | `ArchiveValidationService.validateArchivable` — requires `isActive=true, deletedAt=null` | `{ isActive: false, archivedAt: new Date() }` |
| **restore_product** | ARCHIVED | ACTIVE | `RestoreValidationService.validateRestorable` — requires `isActive=false, archivedAt: not null, deletedAt=null` | `{ isActive: true, archivedAt: null }` |

Notice:
- **publish_product and restore_product produce identical writes**. The difference is solely the validator — publish accepts drafts only (`archivedAt=null`); restore accepts archived rows only (`archivedAt!=null`). The discriminator is `archivedAt`. This is the entire reason the column was added in Phase 3.1B PR-α.
- **None of the three tools modify `deletedAt`**. Recycle-bin restore is a separate path; permanent delete has no AI equivalent.
- **All three carry `riskLevel: HIGH`** → 2-min TTL on the approval token.

Initiator routes (all `POST`, all gated by `ai-agent:write-drafts`, all stamped `@RequiresApproval(HIGH)`):
- `POST /api/v1/ai/products/:id/publish/request-approval`
- `POST /api/v1/ai/products/:id/archive/request-approval`
- `POST /api/v1/ai/products/:id/restore/request-approval`

Approve/reject/revoke/cancel/execute routes are shared on `ApprovalsAiController` and dispatch on `row.toolName`.

---

## 4. Forbidden transitions

Every cell in the matrix below is enforced by a precise validator check + has explicit test coverage in [`approval.service.spec.ts`](../../apps/api/src/ai/services/approval.service.spec.ts).

|  | publish_product | archive_product | restore_product |
|---|:---:|:---:|:---:|
| DRAFT | ✅ ALLOW | ❌ REJECT (already inactive) | ❌ REJECT ("use publish_product instead") |
| ACTIVE | ❌ REJECT ("already active") | ✅ ALLOW | ❌ REJECT ("already active") |
| ARCHIVED | ❌ REJECT ("use restore_product when available") | ❌ REJECT (already inactive) | ✅ ALLOW |
| SOFT_DELETED | ❌ REJECT (in recycle bin) | ❌ REJECT (in recycle bin) | ❌ REJECT ("restore from recycle bin first") |

**Permanent delete is forbidden via every AI route**. There is no AI tool that hard-deletes a product. The admin endpoint `DELETE /products/:id/permanent` exists for irreversible deletion but is admin-only (`@UseGuards(JwtAuthGuard, AdminGuard)`) and has no approval-workflow equivalent. Phase 4 will revisit this with multi-approver + cascade-audit per `PHASE_3_DESIGN.md` Decision Log #9.

---

## 5. Admin manual paths (intentionally bypass the AI flow)

Admins are trusted at the platform level — the four-eyes rule is an AI-agent control, not a product-management gate. The following routes deliberately bypass the approval workflow and rely on the standard admin audit (`AdminActivityLog` via `AuditService.log`).

### `PATCH /products/:id/toggle-active` — quick flip

Flips `isActive` AND mirrors the AI tools' write pattern to keep state consistent (see `products.service.ts:toggleActive`):
- ACTIVE → toggle → stamps `archivedAt: new Date()`, sets `isActive: false` → lands in **ARCHIVED**.
- ARCHIVED → toggle → clears `archivedAt: null`, sets `isActive: true` → lands in **ACTIVE**.
- DRAFT → toggle → sets `isActive: true`, archivedAt stays null → lands in **ACTIVE**.

**Important**: every flip produces a row in one of the four documented states. The lifecycle is never inconsistent. This was fixed during the 2026-05-11 lifecycle review — pre-fix, `toggleActive` only changed `isActive` without managing `archivedAt`, which could produce unreachable hybrid states (`isActive=true AND archivedAt=Date` or `isActive=false AND archivedAt=null` for a previously-active product).

The audit-trail comparison:
- **AI path**: `AgentAuditLog` row with `actionType='PUBLISH'/'ARCHIVE'/'RESTORE'`, linked to `AgentApprovalRequest` (four-eyes + audit chain).
- **Admin path**: `AdminActivityLog` row with `action='TOGGLE_ACTIVE'` (single-admin + audit row).

Both produce identical row state; only the approval trail differs. Operators who need the stricter audit trail should use the AI tools.

### `DELETE /products/:id` — soft delete (recycle bin)

Admin only. Sets `deletedAt: new Date(), isActive: false`. Moves the row to **SOFT_DELETED**. The product can be recovered via the recycle-bin restore path (see below).

### `PATCH /products/:id/restore` — recycle-bin restore (NOT the same as AI restore_product)

Admin only. Clears `deletedAt: null`. Does **NOT** touch `isActive` or `archivedAt` — so a row that was ARCHIVED before being deleted lands back in ARCHIVED, and a row that was ACTIVE before being deleted lands back in some-state-with-isActive=false (because `delete()` also sets `isActive: false`, the row will be a DRAFT or ARCHIVED depending on whether `archivedAt` was set before).

The naming overlap with the AI `restore_product` tool is unfortunate but historical: the admin recycle-bin restore predates the AI tool. Two distinct operations, two distinct routes, two distinct purposes:

| Route | Purpose | Touches deletedAt | Touches isActive/archivedAt |
|---|---|:---:|:---:|
| `PATCH /products/:id/restore` (admin) | Recycle-bin restore — pull out of soft-delete | YES → `null` | NO |
| `POST /ai/products/:id/restore/request-approval` (AI) | Lifecycle restore — un-archive | NO | YES → `isActive=true, archivedAt=null` |

### `DELETE /products/:id/permanent` — hard delete

Admin only. Removes the row from the database entirely. No AI-side equivalent (Phase 4 work per Decision Log #9).

---

## 6. Known caveats

### 6.1 Legacy admin shortcut bypasses four-eyes

`PATCH /products/:id/toggle-active` lets a single admin flip an ARCHIVED row back to ACTIVE without going through `restore_product`'s four-eyes approval. Same applies to ACTIVE → ARCHIVED. The audit trail records the toggle (`AdminActivityLog.action='TOGGLE_ACTIVE'`) but there is **no approval chain**.

This is **intentional** — operators with admin access are trusted, and the AI agent's four-eyes rule is an AI-specific control, not a general product-management requirement. Operators who want the stricter chain should use the AI tools.

If a tenant requires that ALL state changes go through approval (no admin escape hatch), the right control is to revoke the operator's `AdminGuard` access entirely and route all state changes via the AI agent. That would be a per-tenant policy change, not a code change.

### 6.2 Two different "restore" verbs

Documented in §5 above. Short summary: `PATCH /products/:id/restore` undoes soft-delete; `POST /ai/products/:id/restore/request-approval` un-archives. They share a name but target different columns. The admin UI exposes the former; the AI agent exposes the latter.

### 6.3 No AI surface for permanent delete

By design (Decision Log #9). Permanent delete is irreversible and the blast radius for a Product (cascade to OrderItem, RentalOrder, WishlistItem, CartItem, InventoryTransaction, FlashSaleItem, etc.) hasn't been audited yet. Until that audit completes AND Phase 4 multi-approver lands, there is no AI tool for permanent delete. Operators who genuinely need to hard-delete a product use the admin endpoint.

### 6.4 Pre-rollout backfill: existing inactive rows are classified as drafts

Phase 3.1B.α (`archivedAt` schema change) deployed with **no backfill**. Every existing `isActive: false, deletedAt: null` row has `archivedAt: null` → classified as **DRAFT** under the new state machine. Operators who want a specific legacy product to be restorable via `restore_product` can run `archive_product` once to stamp the marker (consistent state after).

---

## 7. Audit trail invariants

Every state transition produces auditable evidence; the AI path additionally produces an approval-request row. The full chain for an AI transition:

| Source | Row | Purpose |
|---|---|---|
| `AgentApprovalRequest` | one row per AI transition | initiator + approver + payload hash + status |
| `AgentAuditLog` (runner-level) | one row per `approve_request` / `execute_approval` / etc. call | non-linked, for HTTP-layer forensics |
| `AgentAuditLog` (linked) | 3–6 rows linked via `approvalRequestId` | `APPROVAL_REQUESTED`, `APPROVAL_GRANTED`, `PUBLISH`/`ARCHIVE`/`RESTORE` |

For an admin manual transition:

| Source | Row | Purpose |
|---|---|---|
| `AdminActivityLog` | one row | `action='TOGGLE_ACTIVE'/'DELETE'/'RESTORE'/'PERMANENT_DELETE'` |

**Token hardening invariants** (asserted by tests):
- Raw approval token is never persisted to any column (`approvalTokenHash` stores only `sha256(rawToken)`).
- Raw token never appears in any `AgentAuditLog.inputJson` / `outputJson`.
- The full `approvalTokenHash` is wiped from the approval row after CONSUMED / REVOKED / EXHAUSTED.
- Audit GET endpoints never expose `approvalToken` or `approvalTokenHash` on the wire.
- Execute audit row carries only `tokenProvided: true` + `tokenHashPrefix` (6 hex chars of the hash) for forensic correlation.

---

## 8. Test coverage matrix

All 12 cells of §4 + visibility for all 4 states + admin-vs-public WHERE-clause invariants have explicit test coverage. Source → test mapping:

| Cell | Outcome | Test file:line |
|---|---|---|
| DRAFT × publish | ALLOW | `approval.service.spec.ts:211` (#1 happy path) |
| DRAFT × archive | REJECT | `approval.service.spec.ts:1557` (#A2) |
| DRAFT × restore | REJECT | `approval.service.spec.ts:839` (R2) |
| ACTIVE × publish | REJECT | `approval.service.spec.ts:263` (#18) |
| ACTIVE × archive | ALLOW | `approval.service.spec.ts:1528` (#A1) |
| ACTIVE × restore | REJECT | `approval.service.spec.ts:852` (R3) |
| ARCHIVED × publish | REJECT | `approval.service.spec.ts:1358` (lifecycle marker block) |
| ARCHIVED × archive | REJECT | `approval.service.spec.ts:1571` (#A2b, added 2026-05-11) |
| ARCHIVED × restore | ALLOW | `approval.service.spec.ts:814` (R1) |
| SOFT_DELETED × publish | REJECT | `approval.service.spec.ts:253` (#17) |
| SOFT_DELETED × archive | REJECT | `approval.service.spec.ts:1570` (#A3) |
| SOFT_DELETED × restore | REJECT | `approval.service.spec.ts:864` (R4) |

Visibility:
- Public DRAFT → 404: `products.service.spec.ts` findBySlug test asserts the WHERE clause excludes `isActive=false`.
- Public ACTIVE → 200: prod smoke (full E2E in every PR).
- Public ARCHIVED → 404: covered by the same WHERE clause guard (isActive=false → filtered).
- Public SOFT_DELETED → 404: same.
- Admin DRAFT/ACTIVE/ARCHIVED → visible via `findAllAdmin` (no isActive filter, only deletedAt).
- Admin SOFT_DELETED → visible via `findDeleted` (recycle bin).

Token hardening:
- `approval.service.spec.ts:1594` `Token hardening — raw approvalToken must never persist` (9 source-text invariants).
- `approval.service.spec.ts:1729+` HR1-HR5 (re-hardening pass post-tokenHashPrefix).

---

## 9. Recommended next AI tool

After publish + archive + restore, the next safest tool is a **DRAFT-only metadata update** — e.g. `update_draft_product` that lets the AI agent edit a draft product's name, description, category, or specifications. Constraints (recommended):

- Validator gates on `isActive=false, archivedAt=null, deletedAt=null` (DRAFT only).
- Forbidden fields (DTO whitelist already enforces these for Phase 2 drafts): `basePrice`, `compareAtPrice`, `rentalPricePerDay`, `rentalDepositAmount`, `latePenaltyPercent`. Pricing remains out of scope until Phase 4.
- Risk level: MEDIUM (5-min TTL) or even LOW (10-min) since the change is invisible to customers (draft).
- Maybe approval-light: a single-admin confirm rather than full four-eyes, since the product hasn't been live yet.

Explicitly NOT yet:
- Price changes (any field affecting customer-paid amounts) — needs the pricing-audit subsystem.
- Inventory adjust — needs the stock-reconciliation subsystem.
- Order/rental status changes — affects in-flight transactions, refunds, customer notifications.
- Rental policy updates — tenant-wide blast radius (CRITICAL risk).
- Permanent delete — needs cascade audit + Phase 4 multi-approver.
- Refunds / payment reversal — out of Phase 3 entirely per Decision Log #10.

---

**Document version**: 1.0 (2026-05-11). Update when a new lifecycle tool ships or the state machine changes.
