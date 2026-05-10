# Phase 3 Design — AI Agent Approval Workflow

**Status**: design approved 2026-05-10. Implementation NOT started — this document is the canonical spec the implementing PR must satisfy.

**Cross-references**:
- [`AI_TOOLS.md`](./AI_TOOLS.md) — tool catalogue (Phase 3 introduces the risky/write tools)
- [`APPROVAL_WORKFLOW.md`](./APPROVAL_WORKFLOW.md) — original v0 workflow sketch; **superseded by this doc** for permission model and four-eyes rule
- [`AUDIT_LOGGING.md`](./AUDIT_LOGGING.md) — `AgentAuditLog` schema and sanitiser rules
- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — phase roadmap

---

## Decision log — LOCKED 2026-05-10

Five decisions locked before implementation begins. This table is the authoritative summary; the detail and reasoning live in the linked sections.

| # | Decision | Status | Detail |
|---|---|---|---|
| 1 | Rollback semantics on handler failure | **APPROVED** | If the consume/write transaction fails, the approval row reverts to `APPROVED` so the operator can retry with the same token within the unchanged TTL. Better than forcing a fresh approval cycle for transient errors. See §5. |
| 2 | SUPER_ADMIN demotion (Phase 3.2) | **APPROVED** | After 2–4 weeks of Phase 3.1 soak, a migration script removes `ai-agent:approve` from `SUPER_ADMIN`. End state: SUPER_ADMIN is **not** automatically an AI approver. AI approval power must be intentionally granted via `AI_AGENT_APPROVER`. **A tenant with no `AI_AGENT_APPROVER` assigned cannot run risky AI writes** — initiation works, but no one can approve. The friction is intentional. See §9. |
| 3 | Multi-approver requirement | **DEFERRED to Phase 4** | Phase 3 v1 is **single-approver only**. Two-approver requirements for high-blast actions (`permanently_delete_record`, refunds, `update_rental_policy`) are deferred to Phase 4. Phase 3 ships with `requiredApproverCount = 1` implied; the column itself is not added until Phase 4 to keep the v1 schema minimal. See §11. |
| 4 | Approval revocation (APPROVED → REJECTED) | **APPROVED** | The original approver may revoke an APPROVED-but-not-yet-CONSUMED token via `POST /api/v1/ai/approvals/:id/revoke`. A "higher-privilege AI approval admin" override is **not** in Phase 3.1; if defined later, that admin could also revoke. If implementation complexity grows, original-approver-only revocation is the minimum bar that must ship. See §7. |
| 5 | Implementation sequence | **APPROVED** | Phase 3.0 (schema + roles + perms + decorator/guard wired, **no behaviour change**) → Phase 3.1 (risky tools + four-eyes + cron + 30 tests) → Phase 3.2 (SUPER_ADMIN demotion migration script). See §9. |

These decisions are locked. Reopening any of them requires a separate amendment commit to this document.

---

## 1. Why Phase 3 needs its own design doc

Phase 1 (read-only) and Phase 2 (drafts) had a single permission gate: `ai-agent:use`. That worked for low-risk operations because the worst outcome of a leaked AI session was an extra inactive draft in the recycle bin.

Phase 3 introduces **risky writes**: `publish_product`, `update_product` (incl. pricing), `delete_*`, `update_order_status`, `mark_rental_returned`, `record_rental_damage`, `adjust_inventory`, `update_rental_policy`, `permanently_delete_record`, refunds, etc. Each can move money, take products live to customers, or destroy data. A single permission flag isn't enough — we need:

1. A **two-person rule** preventing the same admin from both initiating and approving a destructive action.
2. **Permission separation** so approver-only accounts can't run risky writes themselves.
3. **Cryptographic binding** between an approval and the exact payload it approved.
4. **Auditable, replayable** state — every initiate / approve / reject / consume / expire transition is logged with linkage.

This doc formalises all of the above.

---

## 2. Permission model

Four scope-tiered AI permissions, all under the `ai-agent:*` namespace.

| Code | Gates | Phase introduced |
|---|---|---|
| `ai-agent:use` | Access to any `/api/v1/ai/*` route at all | Phase 1 (existing) |
| `ai-agent:read` | GET tools — search, get, list, reports | Phase 3 (NEW; today's reads gated only by `:use`) |
| `ai-agent:write-drafts` | POST tools that create drafts or notes (Phase 2 surface — `create_product_draft`, `add_order_note`, `create_size_guide_entry`, `create_size`) | Phase 3 (NEW; today's drafts gated only by `:use`) |
| `ai-agent:approve` | Issue / revoke approval tokens for risky actions | Phase 3 (NEW) |

### Composition rule

Every Phase 3+ AI route checks both:
1. **`ai-agent:use`** — proves the caller is allowed to use the agent at all.
2. **The route's required scope perm** (one of `:read`, `:write-drafts`, `:approve`) — proves the caller is allowed to perform that *kind* of action.

A user with only `:use` can call **nothing** under Phase 3 enforcement. The `:use` gate is necessary but no longer sufficient.

### Implementation hook (planned, NOT in this doc)

Add a `@RequiresAiPermission(code: string)` decorator + reflector check inside `AiPermissionGuard`. The guard reads both class-level (default for the controller) and method-level (override for specific routes) metadata.

```ts
// Pseudo-code — Phase 3.1 implementation
@AiSecured()
@RequiresAiPermission('ai-agent:read')
@Controller('ai/products')
export class ProductsAiController {
  @Get('search')
  search(...) {} // inherits :read

  @RequiresAiPermission('ai-agent:write-drafts')
  @Post('draft')
  draft(...) {}

  @RequiresAiPermission('ai-agent:write-drafts')   // initiate
  @Post(':id/publish')
  publish(...) {}                                   // also requires approval token at runtime
}
```

### Migration window for existing Phase 1/2 routes

When Phase 3.0 ships (schema + roles + permissions seeded, NO enforcement change), the existing AI routes keep working with just `:use` — no break. Phase 3.1 adds the per-route scope check; at that point operators must have already assigned `:read` and `:write-drafts` to their AI users. The migration script (§9) handles this for SUPER_ADMIN automatically.

---

## 3. System roles

Two new system roles seeded per-tenant on first boot via `OnModuleInit` (mirrors how `SUPER_ADMIN`/`MANAGER`/`STAFF` are seeded today).

### `AI_AGENT_OPERATOR`
The day-to-day agent user. Drafts, edits-via-approval-request, runs reports.

```
permissions:
  ai-agent:use
  ai-agent:read
  ai-agent:write-drafts
  (NOT ai-agent:approve)
```

**Cannot approve risky actions, even ones they didn't initiate.** This is enforced at the route guard layer (`:approve` not granted → POST to `/approvals/:id/approve` returns 403).

### `AI_AGENT_APPROVER`
The reviewer. Reads everything, approves or rejects requests opened by operators.

```
permissions:
  ai-agent:use
  ai-agent:read
  ai-agent:approve
  (NOT ai-agent:write-drafts)
```

**Cannot initiate risky writes.** Even though `:approve` is held, attempting to POST a draft or risky tool returns 403 because the route requires `:write-drafts`.

### Why two distinct roles instead of one combined role

You could grant both `:write-drafts` AND `:approve` to a single user (and SUPER_ADMIN does, during the migration window — see §9). But the **technical four-eyes enforcement** at approval time (§4) still prevents that user from approving their *own* requests. The roles split the perms by default to make policy violations impossible without explicit, deliberate configuration.

### Composition is allowed but discouraged

A tenant CAN assign both roles to the same admin (or grant both perms via a custom role). The four-eyes rule (§4) still bites: the same `adminUserId` cannot appear as both initiator and approver on a single `AgentApprovalRequest`. The role split is policy guidance + bulk grants; the technical gate is the runtime check.

---

## 4. Four-eyes rule (the headline protection)

> **The same admin user must not both initiate and approve the same risky action.**

Two layers of enforcement.

### Layer 1 — runtime check (the actual gate)

In the approve endpoint:
```ts
// Pseudo-code — POST /api/v1/ai/approvals/:id/approve
if (req.user.id === approvalRequest.initiatorAdminUserId) {
  await audit.recordSelfApprovalAttempt(...); // severity: WARNING
  throw new ForbiddenException({ code: 'forbidden_self_approval' });
}
```

This bites regardless of role configuration. Even a SUPER_ADMIN with both perms cannot approve their own request.

The attempt is logged at `WARNING` severity so it surfaces in any abuse-detection dashboard.

### Layer 2 — role design (the policy guidance)

`AI_AGENT_OPERATOR` doesn't carry `:approve`; `AI_AGENT_APPROVER` doesn't carry `:write-drafts`. The default seeded roles make four-eyes the path of least resistance.

### Same-tenant requirement (implicit, made explicit here)

The approver must be in the same tenant as the initiator. This is enforced by `TenantContext.requireId` on the approve route — the `AgentApprovalRequest` row is scoped by `tenantId`, so a different-tenant approver simply can't see the request. No explicit cross-tenant check is needed beyond the existing tenant scoping.

### Multi-approver escalation (out of scope for Phase 3 v1)

Phase 3 v1 is single-approver: one approval ⇒ token issued. Some actions (permanent-delete, large refunds) might benefit from two-approver requirements — that's noted in §11 (Open questions) and tagged for Phase 4.

---

## 5. Approval token mechanics

### Generation

- 256-bit random hex via `crypto.randomBytes(32).toString('hex')` (64 hex chars).
- Stored in `AgentApprovalRequest.approvalToken` with `@unique` constraint.
- Returned to the approver in the JSON response of `POST /approvals/:id/approve`. Never logged in plaintext to `AgentAuditLog.outputJson` (the sanitiser drops `approvalToken` *only when present as input* — for the issuance response we deliberately log just the token id, not the value).

### Lifetime

| Action class | TTL |
|---|---|
| Default risky action (publish, status change, inventory adjust, etc.) | **5 minutes** |
| Permanent delete (any `permanently_delete_record`) | **60 seconds** |
| Refunds / payment-reversal (when added) | **60 seconds** |
| `update_rental_policy` (tenant-wide blast radius) | **2 minutes** |

`expiresAt = createdAt + ttl`. After `expiresAt`, status flips to `EXPIRED` (auto-expiry cron, §7) and the token can never be consumed.

### Single-use

`consumedAt` is set in the **same Prisma transaction** as the underlying write. The transaction:
1. `SELECT ... FOR UPDATE` the approval row by token.
2. Verify status = APPROVED, `expiresAt > now`, `consumedAt IS NULL`.
3. Recompute payload hash, compare.
4. Update approval: `status = 'CONSUMED'`, `consumedAt = now()`.
5. Run the actual operation (Prisma write).
6. If step 5 fails: rollback the transaction → approval row reverts to APPROVED. The operator may retry with the same token (still single-use; `consumedAt` rolled back).
7. If steps 1–4 fail: throw the appropriate error envelope (410 expired, 410 consumed, 409 payload_mismatch).

The transaction guarantees a token can only ever apply to one successful write. A concurrent retry will deadlock at `SELECT ... FOR UPDATE` and the loser sees `consumed` after the winner commits.

**Decision: rollback semantics on handler failure — LOCKED 2026-05-10 (Decision Log #1).** The alternative (fail-forward — keep status=CONSUMED even if write fails) is simpler but forces a fresh approval cycle on every transient error. Rollback gives operators a clean retry window within TTL. The rollback path is fully tested (test #13 in §10).

### Payload hash binding

```ts
// Canonical JSON: lexicographic key order, no whitespace, ints stay ints.
payloadHash = sha256(`${toolName}::${canonicalJSON(input)}`)
```

Computed at:
- **Initiate time** — stored on the approval row.
- **Execute time** — recomputed from the incoming body, compared to the stored hash. Mismatch → 409 `payload_mismatch` and the approval is **invalidated** (status → EXPIRED, audit row WARNING). The operator must re-initiate.

This prevents the "approve A, execute B" attack where an operator gets approval for a tame change then swaps in a destructive payload before pressing execute.

The canonical JSON helper is its own utility with its own unit tests (re-ordered keys produce the same hash; nested objects and arrays canonicalise; numbers don't unify with their string representation).

---

## 6. Audit log linkage

### `AgentAuditLog` schema additions (NEW — Phase 3 schema migration)

Adds **one** column to the existing model:

```prisma
model AgentAuditLog {
  // ... existing fields from Phase 1 ...
  approvalRequestId  String?   // NEW — FK-soft to AgentApprovalRequest.id

  @@index([approvalRequestId])  // NEW — for joined queries on the activity dashboard
}
```

### `AgentApprovalRequest` schema (NEW model)

```prisma
model AgentApprovalRequest {
  id                    String    @id @default(cuid())
  tenantId              String?

  initiatorAdminUserId  String                                    // who opened the request
  approverAdminUserId   String?                                   // who approved/rejected (null until acted)
  approverIp            String?                                   // for forensics; matches the approve POST

  toolName              String                                    // e.g. "publish_product"
  targetResourceType    String?                                   // e.g. "Product"
  targetResourceId      String?
  inputJson             Json                                      // sanitised — same rules as AgentAuditLog
  payloadHash           String                                    // sha256(toolName || canonicalJSON(input))
  summary               String                                    // human-readable, shown to approver

  approvalToken         String?   @unique                         // present once status=APPROVED; null after CONSUMED
  status                String    @default("PENDING")             // PENDING | APPROVED | REJECTED | EXPIRED | CONSUMED | CANCELLED
  rejectionReason       String?

  expiresAt             DateTime
  approvedAt            DateTime?
  rejectedAt            DateTime?
  cancelledAt           DateTime?
  consumedAt            DateTime?

  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  initiator AdminUser  @relation("AgentApprovalInitiator", fields: [initiatorAdminUserId], references: [id], onDelete: Cascade)
  approver  AdminUser? @relation("AgentApprovalApprover",  fields: [approverAdminUserId],  references: [id], onDelete: SetNull)

  @@index([tenantId, status])
  @@index([initiatorAdminUserId, createdAt])
  @@index([approverAdminUserId, createdAt])
  @@index([expiresAt])
}
```

`AdminUser` gains two back-relations:
```prisma
agentApprovalsInitiated AgentApprovalRequest[] @relation("AgentApprovalInitiator")
agentApprovalsReviewed  AgentApprovalRequest[] @relation("AgentApprovalApprover")
```

### Linkage chain

A risky action produces 3–5 `AgentAuditLog` rows, all sharing the same `approvalRequestId`:

| # | actionType | severity | When | Notes |
|---|---|---|---|---|
| 1 | `APPROVAL_REQUESTED` | NOTICE | initiator POSTs without token | input is sanitised; outputJson contains the new approval id |
| 2a | `APPROVAL_GRANTED` | NOTICE | approver POSTs `/approvals/:id/approve` | logs approverAdminUserId, ipAddress |
| 2b | `APPROVAL_REJECTED` | NOTICE | approver POSTs `/approvals/:id/reject` | logs `rejectionReason` |
| 2c | `APPROVAL_CANCELLED` | INFO | initiator DELETEs `/approvals/:id` | only valid while status=PENDING |
| 2d | `APPROVAL_EXPIRED` | INFO | cron flips PENDING/APPROVED→EXPIRED | written by the cron, adminUserId=null |
| 3 | (the actual action — `PUBLISH`/`UPDATE`/`DELETE`/etc.) | NOTICE or CRITICAL | initiator re-POSTs with token | links the original audit chain to the underlying operation |

The activity page (Phase 4 work) groups rows by `approvalRequestId` to show a complete request → approval → execution timeline.

### Sanitisation reuse

The existing `AiSanitizerService` (Phase 1) sanitises `inputJson` identically for both `AgentAuditLog` and `AgentApprovalRequest`. The `summary` field is generated server-side from a per-tool template and may contain operator-friendly text like `"Publish 'Floral Mermaid Gown' (TZS 850,000) to the storefront"`. Templates live in `apps/api/src/ai/services/approval-summary.service.ts` (Phase 3.1).

---

## 7. State machine + workflows

### State diagram

```
                   ┌── (cancel) ──→ CANCELLED
                   │
                   ├── (expire)  ──→ EXPIRED
                   │
PENDING ──(approve)──→ APPROVED ─┬─ (consume) ──→ CONSUMED
                   │              │
                   ├── (reject)   └── (expire)   ──→ EXPIRED
                   │
                   └→ REJECTED
```

All transitions are one-way. No row goes back to PENDING once it leaves.

### Workflow 1 — initiate

1. Operator (must hold `ai-agent:write-drafts` for now; specific risky-action perms in Phase 3.2) POSTs the action with no `approvalToken`.
2. The handler runs DTO validation as if it were going to execute (so the operator sees real validation errors before approval). On success:
   - Computes `payloadHash`.
   - Creates `AgentApprovalRequest` with status=PENDING, expiresAt=now+TTL.
   - Writes `AgentAuditLog` row (#1 above) with `actionType: 'APPROVAL_REQUESTED'`.
   - Returns the `approval_required` envelope:
     ```json
     {
       "success": false,
       "tool": "publish_product",
       "error": { "code": "approval_required", "message": "Approval required — see approvalRequest." },
       "approvalRequired": true,
       "auditId": "...",
       "approvalRequest": {
         "id": "appr_req_...",
         "summary": "...",
         "expiresAt": "...",
         "ttlSeconds": 300
       }
     }
     ```

Note: `approvalRequired: true` (Phase 1/2 always emits `false`).

### Workflow 2 — approve

1. Approver (holds `ai-agent:approve`) POSTs `/api/v1/ai/approvals/:id/approve`.
2. Guards check:
   - `status === 'PENDING'` (else return 410 with current status code)
   - `req.user.id !== request.initiatorAdminUserId` (else 403 `forbidden_self_approval`, audit WARNING)
   - `expiresAt > now` (else trigger expiry path, return 410 `approval_expired`)
3. Generate token, store, set `status=APPROVED`, `approvedAt`, `approverAdminUserId`.
4. Audit row (#2a) `APPROVAL_GRANTED`.
5. Return `{ approvalToken, expiresAt, summary }` to approver.

### Workflow 3 — reject

1. Approver POSTs `/api/v1/ai/approvals/:id/reject` with `{ reason: string }`.
2. Same self-approval check (also blocked from self-rejection — same logic).
3. Set `status=REJECTED`, `rejectedAt`, `rejectionReason`, `approverAdminUserId`.
4. Audit row (#2b) `APPROVAL_REJECTED`.
5. Return ack.

### Workflow 4 — initiator cancels (before approval)

1. Initiator DELETEs `/api/v1/ai/approvals/:id`.
2. Guards: must be initiator AND status=PENDING.
3. Set `status=CANCELLED`, `cancelledAt`.
4. Audit row (#2c) `APPROVAL_CANCELLED`.

Useful when the operator realises a mistake in the request before any approver has acted.

### Workflow 4.5 — approver revokes (between APPROVED and CONSUMED) — Decision Log #4

1. Original approver POSTs `/api/v1/ai/approvals/:id/revoke` with optional `{ reason: string }`.
2. Guards:
   - status === 'APPROVED' (else 409 — already CONSUMED, EXPIRED, REJECTED, or CANCELLED is final).
   - `req.user.id === request.approverAdminUserId` — **only the original approver may revoke**. A different approver POSTing returns 403 `forbidden_not_original_approver`.
   - `req.user` still holds `ai-agent:approve` (rules out post-revocation perm-loss exploits).
3. In a Prisma transaction:
   - Set `status='REJECTED'`, `rejectedAt=now()`, `rejectionReason = revocationReason ?? 'revoked by approver'`.
   - **Clear the `approvalToken` field** (defence-in-depth: any in-flight execute attempt fails the unique-token lookup).
4. Audit row (#2b-revoke) — `actionType: 'APPROVAL_REVOKED'`, severity NOTICE, `approvalRequestId` linked.
5. Return ack to approver.

If a CONSUME attempt races with REVOKE, the `SELECT ... FOR UPDATE` in the consume path serialises against this transaction. Whichever commits first wins:
- Consume wins → write succeeds, status=CONSUMED, revoke returns 409.
- Revoke wins → status=REJECTED + token cleared, consume returns 410 `approval_revoked`.

A "higher-privilege AI approval admin" override (allowing someone other than the original approver to revoke) is **not** in Phase 3.1. Decision Log #4 leaves room for it as a future option but the v1 minimum is original-approver-only.

### Workflow 5 — execute (consume token)

1. Operator (must be the original initiator) re-POSTs the original tool with `approvalToken` in the body.
2. Handler opens a Prisma transaction:
   - `SELECT ... FOR UPDATE` the approval row by token.
   - Validate: status=APPROVED, `expiresAt > now`, `consumedAt IS NULL`, `initiatorAdminUserId === req.user.id`, recomputed payload hash matches.
   - On any check failing: throw the appropriate error envelope and abort.
3. Inside the same transaction:
   - Mark `status=CONSUMED`, `consumedAt=now()`, clear `approvalToken` (defence-in-depth so accidentally-leaked-after-the-fact tokens are useless).
   - Run the actual write via the existing service.
4. On success: write audit row (#3) with the operation's actionType + `approvalRequestId`.
5. On handler error inside step 3: rollback the entire transaction. The token reverts to APPROVED and may be retried within TTL.

### Workflow 6 — auto-expiry (cron)

A `@nestjs/schedule` cron runs every **60 seconds**:
```sql
UPDATE "AgentApprovalRequest"
   SET status = 'EXPIRED',
       updatedAt = NOW()
 WHERE status IN ('PENDING', 'APPROVED')
   AND "expiresAt" < NOW();
```

For each affected row, write `AgentAuditLog` row (#2d) with `severity: 'INFO'`, `adminUserId: null` (system action). One audit row per expired request — the cron loops, doesn't bulk-write.

---

## 8. Route-level enforcement (planned routes)

### New approval-management routes

```
POST   /api/v1/ai/approvals/:id/approve       perm: ai-agent:approve
POST   /api/v1/ai/approvals/:id/reject        perm: ai-agent:approve
DELETE /api/v1/ai/approvals/:id               perm: ai-agent:write-drafts (initiator only)
GET    /api/v1/ai/approvals?status=PENDING    perm: ai-agent:read
GET    /api/v1/ai/approvals/:id               perm: ai-agent:read
```

### New risky-action routes (subset; full list lands with Phase 3.1)

```
POST   /api/v1/ai/products/:id/publish        perm: ai-agent:write-drafts + approval token
POST   /api/v1/ai/products/:id/archive        perm: ai-agent:write-drafts + approval token
POST   /api/v1/ai/products/:id/restore        perm: ai-agent:write-drafts + approval token
POST   /api/v1/ai/products/:id/permanent-delete  perm: ai-agent:write-drafts + 60s approval token + 'DELETE <type> <id>' confirm body
PATCH  /api/v1/ai/products/:id                perm: ai-agent:write-drafts + approval token (when pricing fields touched; non-pricing in Phase 3.1)
POST   /api/v1/ai/orders/:id/status           perm: ai-agent:write-drafts + approval token
POST   /api/v1/ai/rentals/:id/return          perm: ai-agent:write-drafts + approval token
POST   /api/v1/ai/inventory/adjust            perm: ai-agent:write-drafts + approval token
PATCH  /api/v1/ai/rental-policies             perm: ai-agent:write-drafts + approval token
```

**`@Patch` and `@Delete` are forbidden under `/api/v1/ai/*` until Phase 3.1.** The shape invariant test in `ai-controllers.shape.spec.ts` blocks them today; Phase 3.1 updates the allowlist alongside the route additions.

### Guard stack (per route)

```
JwtAuthGuard
  → AdminGuard
    → AiPermissionGuard   (checks ai-agent:use)
      → RequiresAiPermissionGuard  (checks the @RequiresAiPermission() metadata, NEW in Phase 3.0)
        → ModuleGuard       (existing — for module-gated tools)
          → controller
            → AiToolRunner
              → (if @RequiresApproval()) ApprovalTokenInterceptor
                → handler
```

`ApprovalTokenInterceptor` reads the `approvalToken` from the request body, runs the validation transaction, and forwards execution. If the token is absent on a route marked `@RequiresApproval()`, it triggers the Workflow 1 (initiate) path automatically — same handler, branched output.

---

## 9. SUPER_ADMIN migration plan

Goal: end-state has SUPER_ADMIN with `:use + :read + :write-drafts + :approve` **only if explicitly granted**, not by default. Same admin can't approve their own request regardless.

### Phase 3.0 — schema + roles + permissions, NO enforcement change

- Adds `AgentApprovalRequest` model + `AgentAuditLog.approvalRequestId` column.
- Seeds `AI_AGENT_OPERATOR` and `AI_AGENT_APPROVER` system roles per tenant.
- Seeds `ai-agent:read`, `ai-agent:write-drafts`, `ai-agent:approve` permissions.
- **`AiPermissionGuard` still only checks `ai-agent:use`.** Phase 1/2 routes unchanged.
- Adds the `@RequiresAiPermission()` decorator + `RequiresAiPermissionGuard` but they're not yet wired into any route.
- One-off migration script: for every tenant, grant `:read`, `:write-drafts`, `:approve` to the existing `SUPER_ADMIN` role. (Backfills so when 3.1 enforcement lands, SUPER_ADMINs don't lose access.)

**Rollout rule**: Phase 3.0 ships a deploy with **no behaviour change**. Safe.

### Phase 3.1 — risky tools + per-route enforcement live

- Adds the risky write routes (publish, archive, restore, status, etc.) with `@RequiresAiPermission(...)` + `@RequiresApproval()`.
- Adds the approval-management routes.
- Adds the four-eyes runtime check.
- Adds the cron expiry job.
- `AiPermissionGuard` now respects `@RequiresAiPermission()` metadata — routes without the decorator still gate on `:use` only (back-compat for Phase 1/2 reads + drafts).
- SUPER_ADMIN holds all four perms thanks to the 3.0 backfill, so they keep working as before — except they can no longer approve their own requests.

**Operators can NOW assign `AI_AGENT_OPERATOR`/`AI_AGENT_APPROVER` to other admin accounts** if they want fine-grained separation. Default state for non-SUPER_ADMIN admins remains: no AI access.

### Phase 3.2 — SUPER_ADMIN demotion (post-soak, 2-4 weeks after 3.1) — Decision Log #2

- One-off migration script removes `ai-agent:approve` from `SUPER_ADMIN.RolePermission` for every tenant.
- Effect: SUPER_ADMINs can still initiate AI write actions, but they cannot approve them — they need a separate person (or a dedicated `AI_AGENT_APPROVER` account) to review.
- Operators are notified ahead of time (in-app banner or email) and asked to deliberately grant `AI_AGENT_APPROVER` to a reviewer account.
- This is **the preferred production setup** — approval power is intentional, never automatic.

**Final production target (locked)**:
- SUPER_ADMIN is **not** automatically treated as an AI approver forever.
- AI approval power is intentionally assigned through `AI_AGENT_APPROVER`.
- A tenant with no `AI_AGENT_APPROVER` assigned to any active admin cannot approve risky AI writes — initiation works, but the approval queue is unactionable.

This friction is intentional and safer. Operators who don't want any AI risky-write capability can simply not assign `AI_AGENT_APPROVER` to anyone — the surface stays read-only-and-drafts in practice even though the routes exist.

### Migration script naming

```
scripts/ai/3.0-grant-super-admin-ai-perms.js     # backfill before 3.1
scripts/ai/3.2-revoke-super-admin-ai-approve.js  # demotion after 3.1 soak
```

Both idempotent. Both write `AdminActivityLog` rows so the change is traceable.

---

## 10. Tests required (must all pass before Phase 3.1 ships)

The test list maps 1:1 to the 11 categories specified. File names are illustrative; layout follows the existing `apps/api/src/ai/**.spec.ts` colocation.

### A. Four-eyes rule

| # | Test | What it proves |
|---|---|---|
| 1 | `forbids self-approval — same admin cannot approve own request` | Initiator POSTs `/approve`; expect 403 `forbidden_self_approval`. AgentAuditLog row `severity: 'WARNING'`, `actionType: 'APPROVAL_REJECTED'` (or a dedicated `SELF_APPROVAL_BLOCKED`) |
| 2 | `forbids self-rejection — same admin cannot reject own request` | Symmetric to #1 |
| 3 | `allows different admin in same tenant to approve` | Different `adminUserId` on approve → 200 |
| 4 | `cross-tenant approval is invisible (404)` | Approver in tenant B tries to GET request id from tenant A → 404 |

### B. Permission boundaries

| # | Test | What it proves |
|---|---|---|
| 5 | `user without ai-agent:approve cannot approve` | Operator role POSTs `/approve` → 403 `permission_denied`, error names the missing perm |
| 6 | `user with only ai-agent:approve cannot initiate` | Approver-only role POSTs a risky tool → 403 `permission_denied`, error names `ai-agent:write-drafts` |
| 7 | `user without ai-agent:use cannot reach AI surface at all` | 403 from outer AiPermissionGuard |
| 8 | `user without ai-agent:read cannot list approvals` | 403 |

### C. Token lifecycle

| # | Test | What it proves |
|---|---|---|
| 9 | `token TTL respected — expired token returns 410 approval_expired` | Time-travel test using a stub clock |
| 10 | `permanent-delete uses 60s TTL` | Schema/contract test |
| 11 | `single-use — second consume returns 410 approval_consumed` | Sequential POSTs |
| 12 | `concurrent consume — only one wins, the other returns 410` | Two parallel requests with the same token; transactional `SELECT FOR UPDATE` serialises them |
| 13 | `handler failure rolls back the transaction — token still consumable within TTL` | Fail-on-write test |

### D. Payload binding

| # | Test | What it proves |
|---|---|---|
| 14 | `payload mismatch returns 409` | Approve payload A, execute payload B → 409 `payload_mismatch`, approval invalidated |
| 15 | `canonicalJSON is order-insensitive` | Re-ordered keys in input → same hash |
| 16 | `nested object reordering produces same hash` | |
| 17 | `numeric vs string forms don't unify` | `{ x: 1 }` and `{ x: "1" }` produce different hashes |

### E. State machine

| # | Test | What it proves |
|---|---|---|
| 18 | `pending → approved → consumed happy path` | End-to-end |
| 19 | `pending → rejected — no token issued` | |
| 20 | `pending → cancelled by initiator only` | Non-initiator gets 403; non-PENDING state gets 409 |
| 21 | `auto-expiry cron flips PENDING and APPROVED to EXPIRED` | |
| 22 | `cannot transition out of terminal states` | E.g. APPROVED → REJECTED returns 409 |

### F. Audit linkage

| # | Test | What it proves |
|---|---|---|
| 23 | `every transition writes an AgentAuditLog row with approvalRequestId` | Count check |
| 24 | `inputJson is sanitised — no password/token/secret leaks` | Reuses Phase 1 sanitiser tests |
| 25 | `tenantId on audit row matches tenantId on approval request` | |
| 26 | `approver row records approverIp` | |

### G. Route-level enforcement (HTTP, supertest)

| # | Test | What it proves |
|---|---|---|
| 27 | `risky tool without token returns approval_required` | |
| 28 | `risky tool with stale/expired token returns 410` | |
| 29 | `risky tool with valid token executes and consumes` | |
| 30 | `non-risky tool (Phase 2 draft) does NOT trigger approval flow` | Confirms route metadata is read correctly |

---

## 11. Open design questions (need decisions before Phase 3.1 implementation begins)

> Items previously here as #4 (multi-approver) and #5 (revocation) have been promoted to **locked decisions** in the Decision Log at the top of this doc — see entries #3 and #4 there. Multi-approver is deferred to Phase 4; original-approver revocation is approved for Phase 3.1.

1. **Approver notification channel**: how does the approver learn there's a pending request? Email? In-app banner? Slack webhook? **Recommendation**: email-only for v1 via the existing Brevo integration; in-app banner in Phase 4 alongside the approval admin page.

2. **Approval admin UI**: where do approvers manage requests? Via a future `/dashboard/ai/approvals` page (Phase 4) or via the bare API? **Recommendation**: API-only for Phase 3.1; UI deferred to Phase 4.

3. **Token transport in agent UX**: when the agent runtime (LLM or operator chat) holds the conversation, does it carry the approval token through, or does the operator paste it manually? **Recommendation**: agent runtime fetches it after the operator presses an Approve button — the token never leaves the API/UI sandwich, lowering leakage risk.

4. **Approval delegation**: can an approver delegate to another approver for a fixed window? **Out of scope for Phase 3.** Add via a `Delegation` model later.

5. **Cron timing — every 60s vs every 30s**: 60s leaves up to ~60s of "expired but still PENDING" before the cron flips it. The state-machine guards in workflows 2/5 also re-check `expiresAt < now`, so the cron is only for cleanup. 60s is fine. **Confirmed.**

6. **Higher-privilege AI approval admin override for revocation**: locked decision #4 leaves room for a future role that can revoke any approver's token (not just their own). Whether to add it, what perm code to use, and what the audit treatment looks like — all deferred. Not in Phase 3.1.

---

## 12. Out of scope for Phase 3 (deliberately)

- An LLM client (Anthropic/OpenAI) — separate piece of work.
- An admin UI for approval management — Phase 4.
- Per-resource approver assignment (e.g. "only Faith can approve product price changes") — Phase 4.
- Multi-approver escalation — Phase 4.
- Approval delegation — later.
- Real-time notifications (in-app banners, push, websocket) — Phase 4.
- Approval analytics dashboard (avg-time-to-approve, top-rejected-reasons, etc.) — Phase 4.
- AI-side risk scoring (auto-flag suspicious requests for extra review) — Phase 5+.
- Per-tool approval policy (e.g. "auto-approve `archive_product` for users with X years tenure") — explicitly NEVER. The whole point of approvals is human review of every risky action.

---

## 13. Definition of done for Phase 3.1

- [ ] `AgentApprovalRequest` model + `AgentAuditLog.approvalRequestId` shipped via `prisma db push`.
- [ ] Three new permissions seeded; two new system roles seeded per tenant.
- [ ] `RequiresAiPermissionGuard` + `@RequiresAiPermission()` decorator wired into `AiPermissionGuard`.
- [ ] `ApprovalTokenInterceptor` + `@RequiresApproval()` decorator implemented and tested.
- [ ] Approval-management routes (approve, reject, cancel, list, get) live.
- [ ] At least 4 risky-action routes live: `publish_product`, `archive_product`, `update_order_status`, `adjust_inventory`. Others land in Phase 3.1.x patches.
- [ ] All 30 tests in §10 pass; build fails if any are skipped.
- [ ] `ai-controllers.shape.spec.ts` updated to allow Phase 3 verbs on the explicit allowlist.
- [ ] Cron expiry job tested with a time-stub.
- [ ] CHANGELOG / `IMPLEMENTATION_PLAN.md` updated with Phase 3.1 status.
- [ ] Operator-facing migration note shipped (in-app banner or email) before Phase 3.2 demotion script runs.

When all checked: cut a `release/phase-3.1` tag, push to prod with the new deploy.sh, monitor `AgentAuditLog` for `severity: WARNING` rows for one week, then schedule Phase 3.2 demotion.
