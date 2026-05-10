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
| 6 | Approval token storage: **hash only** | **APPROVED** | The raw token is generated, returned to the approver **once**, and then thrown away. Only `sha256(rawToken)` is stored on `AgentApprovalRequest.approvalTokenHash`. Raw token never logged, never exposed via the audit API, never persisted. Match the existing password-reset-token pattern in `AdminUser.passwordResetToken` (also SHA-256 hashed). Prefer protected UI/API integration over operator copy-paste. See §5. |
| 7 | Approval summary: **structured snapshot** | **APPROVED** | Every `AgentApprovalRequest` carries explicit fields the approver UI can render without reaching back to the original resource: `actionTitle`, `businessSummary`, `targetResourceType`, `targetResourceId`, `targetResourceName`, `requestedByAdminUserId`, `riskLevel`, `beforeValues` (JSON snapshot), `afterValues` (JSON snapshot of the proposed change), `expiresAt`. Frozen at request time so a stale-but-honest view is shown to the approver even if the resource changes underneath (see decision #12). See §6. |
| 8 | Risk levels: `LOW \| MEDIUM \| HIGH \| CRITICAL` | **APPROVED** | Each approval-gated tool declares a hard-coded risk level via its `@RequiresApproval(riskLevel)` decorator. Drives: (a) token TTL (CRITICAL=60s, HIGH=2min, MEDIUM=5min, LOW=10min — though LOW is unused in Phase 3 because LOW actions don't need approval), (b) approver-UI warning intensity (red/orange/yellow/grey), (c) future multi-approver count (Phase 4: CRITICAL→2 approvers, others→1). Stored on `AgentApprovalRequest.riskLevel`. See §5. |
| 9 | **Permanent delete excluded** from Phase 3.1 | **APPROVED** | `permanently_delete_record` is **NOT** wired in Phase 3.1. Recycle-bin **restore** ships normally; permanent removal is blocked until: (a) a Prisma FK/cascade audit confirms the blast radius for each soft-deletable model (Product → ProductVariant/ProductImage/OrderItem etc.), AND (b) Phase 4 multi-approver lands. See §8 and §12. |
| 10 | **Refunds/payments out of Phase 3 entirely** | **APPROVED** | No refund tools, no payment-reversal tools, no `Payment` mutations via the AI agent in Phase 3. These need payment-specific controls (gateway reconciliation, fund movement compliance, etc.) that are out of scope for the generic approval workflow. Will land as their own subsystem later. See §12. |
| 11 | Tenant isolation tests: **mandatory** | **APPROVED** | Four explicit tests required in addition to the existing test list — see §10.H. Tenant scoping is enforced today by `TenantContext.requireId` + the AdminGuard guard chain, but Phase 3 introduces approval rows + tokens that span request → approval → execute, and we want belt-and-braces coverage. |
| 12 | Stale-data protection: `expectedUpdatedAt` | **APPROVED** | At request time, capture the target resource's current `updatedAt` into `AgentApprovalRequest.expectedUpdatedAt`. At execute time, the consume transaction re-reads the resource and compares; mismatch → **409 stale_data**, approval invalidated (status → `EXPIRED` with `expirationReason: 'stale_data'`), operator must re-initiate so they see the new state. Prevents "approve A, race a manual edit, then execute on the wrong baseline". See §7 Workflow 5. |
| 13 | Execution retry limit: **max 3 attempts** | **APPROVED** | `AgentApprovalRequest.executionAttempts` increments on every consume attempt, win or lose. After the **3rd** failed attempt, the approval is marked `status='EXHAUSTED'` and the token is invalidated. The operator must re-initiate. Bounds the cost of an operator hammering retry through transient errors. See §7 Workflow 5. |
| 14 | Revocation: **original approver only** (Phase 3.1) | **APPROVED** | Reaffirms decision #4 with explicit constraints: revocation is allowed **only** by `request.approverAdminUserId === req.user.id`, **only** while `status === 'APPROVED'`, **only** before `consumedAt` is set. No higher-privilege override in Phase 3.1. See §7 Workflow 4.5. |

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

## 5. Approval token mechanics + risk levels

### Risk levels — drive TTL, UI, and (Phase 4) multi-approver count

Decision Log #8. Every approval-gated tool declares a hard-coded `riskLevel` via the `@RequiresApproval(riskLevel)` decorator. The level is stored on `AgentApprovalRequest.riskLevel` at request time and is what the approver UI keys off for warning intensity.

| Risk level | Token TTL (Phase 3.1) | Approver UI warning | Phase 4 multi-approver | Example tools |
|---|---|---|---|---|
| `LOW` | 10 min | grey badge | 1 | (unused in Phase 3 — LOW actions don't go through approval at all) |
| `MEDIUM` | 5 min | yellow badge | 1 | `archive_product`, `restore_product`, `restore_*` from recycle bin, `update_size_guide_entry` (toggle isActive) |
| `HIGH` | 2 min | orange banner | 1 | `publish_product`, `update_product` (incl. pricing), `update_order_status`, `update_rental_status`, `mark_rental_returned`, `adjust_inventory` |
| `CRITICAL` | 60 sec | **red full-width warning** + extra confirmation phrase | **2** (Phase 4 only — single-approver in Phase 3.1) | `update_rental_policy`, `record_rental_damage` with deposit deduction |

**Permanent delete and refunds are NOT in Phase 3.1** (Decision Log #9 and #10). When permanent-delete eventually lands it will be CRITICAL with the 60s TTL and a Phase-4 dual-approver requirement.

`expiresAt = createdAt + ttlForLevel(riskLevel)`. After `expiresAt`, the auto-expiry cron flips status to `EXPIRED` (§7 Workflow 6).

### Token generation, storage, and transport — Decision Log #6

The raw token is generated **once**, returned to the approver **once**, and the database **only ever stores its hash**.

```ts
// Pseudo-code at approval time
const rawToken = crypto.randomBytes(32).toString('hex');           // 64-char hex, ~256 bits
const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
await prisma.agentApprovalRequest.update({
  where: { id },
  data: { approvalTokenHash: tokenHash, status: 'APPROVED', approvedAt: new Date(), approverAdminUserId: req.user.id },
});
return res.json({ approvalToken: rawToken, expiresAt, ... });        // raw returned ONCE — then forgotten by the server
```

**Hardline rules** (each fails the build via a unit test if violated):
- ❌ The raw token is **never** persisted to any table. Only `sha256(rawToken)` is stored.
- ❌ The raw token is **never** written to `AgentAuditLog` (input or output). The sanitiser already strips `approvalToken` keys; in addition, the approve handler does not include `rawToken` in its `outputJson` audit fragment.
- ❌ The raw token is **never** returned by any audit API (`GET /api/v1/ai/audit`, `GET /api/v1/ai/approvals/:id`). Only the approval id, status, and `approvalTokenIssued: boolean` are exposed.
- ❌ The raw token is **never** rendered into a server log line in any environment.
- ❌ Consume sets `approvalTokenHash = NULL` on success — even the hash is wiped after use.

**Lookup at execute time**: the operator (or agent runtime) sends the raw token in the request body. The handler hashes it (`sha256`) and looks up the row by `approvalTokenHash = <hash>`. Same `@unique` constraint, same single-row lookup, but the DB never sees the raw value.

**Preferred transport** — Decision Log #6 reaffirmed. Operators should **not** copy-paste tokens between consoles. The approval cycle is meant to run inside protected UI/API surface where the token never leaves the trust boundary:

1. Approver clicks "Approve" in the (Phase 4) admin UI → server holds the raw token in a short-lived in-memory queue keyed by `approvalRequestId`.
2. The agent runtime calls `GET /api/v1/ai/approvals/:id/redeemable-token` (perm: `ai-agent:write-drafts` AND `req.user.id === request.initiatorAdminUserId`) — server pops the token from the in-memory queue, returns it once.
3. The agent runtime calls the executing endpoint with the token in the request body. Token is hashed and matched.

If the in-memory queue is unavailable (e.g. server restart between approve and execute), the approver must re-approve — same TTL, same payload hash, fresh token. **No copy-paste fallback**; if Phase 3.1 ships before the queue exists, the approver UI itself holds the token in browser memory and posts directly to the agent backend on behalf of the operator.

Phase 3.1 ships with the **direct approver-pastes-into-API** path as the bare minimum so the workflow can land before the UI exists; the full protected-token path lands in Phase 4 alongside the admin UI.

### Single-use + retry limit

`consumedAt` is set in the **same Prisma transaction** as the underlying write. The transaction:
1. `SELECT ... FOR UPDATE` the approval row by `approvalTokenHash = sha256(incomingRawToken)`.
2. Verify `status = 'APPROVED'`, `expiresAt > now`, `consumedAt IS NULL`, `executionAttempts < 3` (Decision Log #13).
3. Increment `executionAttempts`. **This always commits**, win or lose, so a transient failure burns one of the 3 attempts.
4. **Stale-data check** (Decision Log #12): re-read the target resource (`SELECT updatedAt FROM <Resource> WHERE id = ?`). If `<resource.updatedAt> != approvalRequest.expectedUpdatedAt` → rollback the increment, set `status='EXPIRED'` with `expirationReason='stale_data'`, throw 409 `stale_data`.
5. Recompute payload hash from the incoming body, compare to stored. Mismatch → rollback the increment, set `status='EXPIRED'` with `expirationReason='payload_mismatch'`, throw 409.
6. Update approval: `status = 'CONSUMED'`, `consumedAt = now()`, `approvalTokenHash = NULL` (defence-in-depth — even the hash is wiped on success).
7. Run the actual operation (Prisma write) inside the same transaction.
8. **Rollback on handler failure** (Decision Log #1): if step 7 fails, rollback the entire transaction. Approval row reverts to `APPROVED` AND `executionAttempts` reverts to its pre-increment value. The operator may retry with the same token within TTL.
9. After 3rd failed attempt — i.e. when step 2 sees `executionAttempts >= 3` — the approval is set to `status='EXHAUSTED'` immediately, hash cleared, and the executing call returns 410 `approval_exhausted`. The operator must re-initiate from scratch.

The transaction guarantees a token can only ever apply to one successful write. A concurrent retry will deadlock at `SELECT ... FOR UPDATE` and the loser sees `consumed` after the winner commits.

**Decision: rollback semantics on handler failure — LOCKED 2026-05-10 (Decision Log #1).** The alternative (fail-forward — keep status=CONSUMED even if write fails) is simpler but forces a fresh approval cycle on every transient error. Rollback gives operators a clean retry window within TTL — bounded by the 3-attempt cap (Decision Log #13) so a buggy retry loop can't burn through unlimited tries.

**Counter-intuitive subtlety on `executionAttempts`**: it commits even when the transaction is otherwise rolled back, so the cap is enforced even across crash-restart boundaries. Implementation: do a separate transaction to bump the counter BEFORE the consume transaction starts, then run the consume transaction atomically. If the consume fails, the counter stays bumped (correct — you used an attempt). If the consume succeeds, the counter is irrelevant (status=CONSUMED is the terminal state). See §10 test #13a covering the bump-on-failure semantics.

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

Updated 2026-05-10 to reflect Decision Log #6 (token hash), #7 (snapshot fields), #8 (risk level), #12 (expectedUpdatedAt), #13 (executionAttempts).

```prisma
model AgentApprovalRequest {
  id                    String    @id @default(cuid())
  tenantId              String?                                   // tenant scoping — see §10.H tests

  // ─── Identity ───────────────────────────────────────────────────────
  initiatorAdminUserId  String                                    // who opened the request
  approverAdminUserId   String?                                   // who approved/rejected (null until acted)
  approverIp            String?                                   // for forensics; matches the approve POST

  // ─── Tool + payload ─────────────────────────────────────────────────
  toolName              String                                    // e.g. "publish_product"
  targetResourceType    String?                                   // e.g. "Product"
  targetResourceId      String?
  targetResourceName    String?                                   // human-readable label, e.g. "Floral Mermaid Gown"
  inputJson             Json                                      // sanitised input — same rules as AgentAuditLog
  payloadHash           String                                    // sha256(toolName || canonicalJSON(input))

  // ─── Approval summary snapshot — Decision Log #7 ────────────────────
  // All four fields are frozen at request time so the approver UI can
  // render a stable, complete view without reaching back to the resource.
  // If the resource changes after request time, the diff in beforeValues
  // vs the live state is what triggers the stale_data check at execute
  // time (Decision Log #12).
  actionTitle           String                                    // short verb, e.g. "Publish wedding gown"
  businessSummary       String                                    // one-line plain-English explanation
  riskLevel             String                                    // LOW | MEDIUM | HIGH | CRITICAL — Decision Log #8
  beforeValues          Json?                                     // snapshot of relevant fields BEFORE the action
  afterValues           Json?                                     // snapshot of fields the action would set
  expectedUpdatedAt     DateTime?                                 // resource.updatedAt at request time — Decision Log #12

  // ─── Token (HASHED) — Decision Log #6 ───────────────────────────────
  // Raw token is generated, returned to approver once, then forgotten.
  // Only sha256(rawToken) is ever persisted. Lookup at execute time
  // hashes the incoming raw token and compares.
  approvalTokenHash     String?   @unique                         // present once status=APPROVED; CLEARED after CONSUMED or revocation

  // ─── State machine ──────────────────────────────────────────────────
  status                String    @default("PENDING")             // PENDING | APPROVED | REJECTED | EXPIRED | CONSUMED | CANCELLED | EXHAUSTED
  rejectionReason       String?                                   // populated for REJECTED (incl. revocation)
  expirationReason      String?                                   // populated for EXPIRED — 'ttl' | 'stale_data' | 'payload_mismatch'
  executionAttempts     Int       @default(0)                     // increments each consume try; cap at 3 (Decision Log #13)

  // ─── Lifecycle timestamps ───────────────────────────────────────────
  expiresAt             DateTime                                  // = createdAt + ttlForLevel(riskLevel)
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
  @@index([riskLevel, status])                                    // for "show me all open CRITICAL approvals" dashboards
}
```

`AdminUser` gains two back-relations:
```prisma
agentApprovalsInitiated AgentApprovalRequest[] @relation("AgentApprovalInitiator")
agentApprovalsReviewed  AgentApprovalRequest[] @relation("AgentApprovalApprover")
```

### Linkage chain

A risky action produces 3–6 `AgentAuditLog` rows, all sharing the same `approvalRequestId`:

| # | actionType | severity | When | Notes |
|---|---|---|---|---|
| 1 | `APPROVAL_REQUESTED` | NOTICE | initiator POSTs without token | input is sanitised; outputJson contains the new approval id, riskLevel, expiresAt |
| 2a | `APPROVAL_GRANTED` | NOTICE | approver POSTs `/approvals/:id/approve` | logs approverAdminUserId, ipAddress; **never logs the raw token** |
| 2b | `APPROVAL_REJECTED` | NOTICE | approver POSTs `/approvals/:id/reject` | logs `rejectionReason` |
| 2b' | `APPROVAL_REVOKED` | NOTICE | original approver POSTs `/approvals/:id/revoke` | only valid while status=APPROVED; clears token hash |
| 2c | `APPROVAL_CANCELLED` | INFO | initiator DELETEs `/approvals/:id` | only valid while status=PENDING |
| 2d | `APPROVAL_EXPIRED` | INFO | cron flips PENDING/APPROVED→EXPIRED | written by the cron, adminUserId=null; `expirationReason` distinguishes `ttl` vs `stale_data` vs `payload_mismatch` |
| 2e | `APPROVAL_EXHAUSTED` | WARNING | 3rd consume attempt fails | Decision Log #13 — operator must re-initiate |
| 3 | (the actual action — `PUBLISH`/`UPDATE`/`DELETE`/etc.) | NOTICE or CRITICAL | initiator re-POSTs with valid raw token | links the original audit chain to the underlying operation |

The activity page (Phase 4 work) groups rows by `approvalRequestId` to show a complete request → approval → execution timeline.

### What audit APIs are allowed to expose — Decision Log #6

The audit endpoints (`GET /api/v1/ai/audit`, `GET /api/v1/ai/approvals/:id`, `GET /api/v1/ai/approvals?status=...`) MUST NOT include the raw approval token in any response — not in `inputJson`, not in `outputJson`, not in any field. They MAY include:

- The `approvalRequestId`.
- `status`, `riskLevel`, `expiresAt`, all timestamps.
- `payloadHash` (it's already public after request — anyone with the input can compute it).
- A boolean `tokenIssued: boolean` (true after approve, false otherwise) — derived from `status === 'APPROVED' && approvalTokenHash !== null`.
- The hash itself MUST NOT be exposed via the audit API either; it's defence-in-depth that should stay internal.

Phase 3.1 implementation must include unit tests asserting that the audit serialiser strips both raw-token-shaped fields AND the `approvalTokenHash` field before sending to the wire.

### Sanitisation reuse

The existing `AiSanitizerService` (Phase 1) sanitises `inputJson` identically for both `AgentAuditLog` and `AgentApprovalRequest`. The `actionTitle` and `businessSummary` fields are generated server-side from a per-tool template and may contain operator-friendly text like:

- `actionTitle`: `"Publish 'Floral Mermaid Gown'"`
- `businessSummary`: `"Make this product visible on https://www.narofashion.co.tz immediately. Current price: TZS 850,000. Active variants: 3."`

Templates live in `apps/api/src/ai/services/approval-summary.service.ts` (Phase 3.1).

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

1. Operator (must hold `ai-agent:write-drafts`) POSTs the action with no `approvalToken`.
2. The handler runs DTO validation as if it were going to execute (so the operator sees real validation errors before approval).
3. On validation success, the handler builds the **approval snapshot** (Decision Log #7) by combining:
   - The route's hard-coded `riskLevel` from `@RequiresApproval(riskLevel)`.
   - A per-tool `approval-summary.service.ts` resolver that returns `{ actionTitle, businessSummary, beforeValues, afterValues, targetResourceName }`. Resolvers re-read the target resource (single Prisma query) and compose human-readable text + structured before/after diffs.
   - The current `<resource>.updatedAt` → `expectedUpdatedAt` (Decision Log #12). Captured atomically with the snapshot — the resolver returns it.
4. Creates `AgentApprovalRequest`:
   - `status='PENDING'`, `expiresAt = now + ttlForLevel(riskLevel)`, `executionAttempts=0`.
   - `actionTitle`, `businessSummary`, `beforeValues`, `afterValues`, `targetResourceName`, `riskLevel`, `expectedUpdatedAt` — all from the snapshot.
   - `inputJson` (sanitised) and `payloadHash`.
5. Writes `AgentAuditLog` row (#1 above) with `actionType: 'APPROVAL_REQUESTED'`.
6. Returns the `approval_required` envelope:
   ```json
   {
     "success": false,
     "tool": "publish_product",
     "error": { "code": "approval_required", "message": "Approval required — see approvalRequest." },
     "approvalRequired": true,
     "auditId": "...",
     "approvalRequest": {
       "id": "appr_req_...",
       "actionTitle": "Publish 'Floral Mermaid Gown'",
       "businessSummary": "Make this product visible on the storefront. Current price: TZS 850,000. Active variants: 3.",
       "riskLevel": "HIGH",
       "targetResourceType": "Product",
       "targetResourceId": "cm123abc",
       "targetResourceName": "Floral Mermaid Gown",
       "beforeValues": { "isActive": false, "compareAtPrice": null },
       "afterValues":  { "isActive": true,  "compareAtPrice": null },
       "expiresAt": "2026-05-10T11:35:00Z",
       "ttlSeconds": 120
     }
   }
   ```

Note: `approvalRequired: true` (Phase 1/2 always emits `false`). The envelope **does not** contain any token field — tokens are issued only on approve.

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

1. Operator (must be the original initiator) re-POSTs the original tool with the **raw** `approvalToken` in the body.
2. Handler hashes the incoming raw token: `tokenHash = sha256(rawToken)`. Discards the raw value immediately — only the hash is held for the lookup.
3. **Pre-flight attempt-counter bump (separate transaction)**: increment `executionAttempts` for the row matching `approvalTokenHash = tokenHash` if `status='APPROVED' AND consumedAt IS NULL`. This commits before the main transaction so the cap is enforced even if the consume crashes mid-write. If the row is now at `executionAttempts > 3`, set `status='EXHAUSTED'`, clear `approvalTokenHash`, write audit row #2e, return 410 `approval_exhausted`.
4. Handler opens the **main consume transaction** (Prisma `$transaction`):
   - `SELECT ... FOR UPDATE` the approval row by `approvalTokenHash`. Not found → 410 `approval_invalid_or_consumed`.
   - Validate:
     - `status === 'APPROVED'` (else 410 with the actual current status)
     - `expiresAt > now` (else flip to `EXPIRED` with `expirationReason='ttl'`, return 410 `approval_expired`)
     - `consumedAt IS NULL` (else 410 `approval_consumed`)
     - `initiatorAdminUserId === req.user.id` (else 403 `forbidden_not_initiator`)
   - **Stale-data check** (Decision Log #12): single-row read of the target resource by id, compare `<resource>.updatedAt` to `approvalRequest.expectedUpdatedAt`. Mismatch → set `status='EXPIRED'` with `expirationReason='stale_data'`, clear `approvalTokenHash`, write audit row, throw 409 `stale_data` with a body that includes the new `<resource>.updatedAt` so the operator UI can re-fetch and re-initiate.
   - **Payload hash check**: recompute `sha256(toolName || canonicalJSON(input))` from the incoming body, compare to stored. Mismatch → set `status='EXPIRED'` with `expirationReason='payload_mismatch'`, clear hash, throw 409 `payload_mismatch`.
5. All checks pass → inside the same transaction:
   - `status='CONSUMED'`, `consumedAt=now()`, clear `approvalTokenHash` (defence-in-depth — even the hash is gone after success).
   - Run the actual write via the existing service.
6. On commit: write audit row (#3) with the operation's actionType + `approvalRequestId`. Severity follows `riskLevel` (CRITICAL → CRITICAL, HIGH → NOTICE, MEDIUM → INFO).
7. On handler error inside step 5: **rollback the entire main transaction** — but the pre-flight bump from step 3 stays committed (you used an attempt). Status goes back to `APPROVED`, hash is back, operator may retry within TTL up to the 3-attempt cap.

Net effect: the token is single-use on **success**, retryable on **transient failure**, capped at 3 attempts, and invalidated on **stale-data** or **payload-mismatch** (which require a fresh approval cycle so the approver re-sees the new state).

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
POST   /api/v1/ai/approvals/:id/approve       perm: ai-agent:approve  (NOT initiator — four-eyes)
POST   /api/v1/ai/approvals/:id/reject        perm: ai-agent:approve  (NOT initiator — four-eyes)
POST   /api/v1/ai/approvals/:id/revoke        perm: ai-agent:approve  (ORIGINAL approver only — Decision Log #14)
DELETE /api/v1/ai/approvals/:id               perm: ai-agent:write-drafts  (initiator only, while PENDING)
GET    /api/v1/ai/approvals?status=PENDING    perm: ai-agent:read
GET    /api/v1/ai/approvals/:id               perm: ai-agent:read
```

### Phase 3.1 risky-action routes — locked list

| Route | Risk | Approval | Notes |
|---|---|---|---|
| `POST /api/v1/ai/products/:id/publish` | HIGH | required | toggles `isActive: true` |
| `POST /api/v1/ai/products/:id/archive` | MEDIUM | required | soft-delete (sets `deletedAt`) |
| `POST /api/v1/ai/products/:id/restore` | MEDIUM | required | clears `deletedAt`; from recycle bin |
| `PATCH /api/v1/ai/products/:id` | HIGH if pricing-touched, MEDIUM otherwise | required | the new DTO permits pricing fields here (unlike the Phase 2 draft DTO); the runner picks the risk level by inspecting which fields appear in the input |
| `POST /api/v1/ai/orders/:id/status` | HIGH | required | follows the existing transition matrix in `OrdersService.updateStatus` |
| `POST /api/v1/ai/rentals/:id/return` | HIGH | required | triggers late-fee calc |
| `POST /api/v1/ai/inventory/adjust` | HIGH | required | direct stock change |
| `PATCH /api/v1/ai/rental-policies` | CRITICAL | required | tenant-wide blast radius; 60s TTL |
| `POST /api/v1/ai/categories/:id/restore` | MEDIUM | required | from recycle bin |

### Explicitly NOT in Phase 3.1 (Decision Log #9 and #10)

- ❌ `POST /api/v1/ai/products/:id/permanent-delete` — blocked until Prisma FK/cascade audit is complete (Product → ProductVariant, ProductImage, OrderItem, RentalOrder, etc.) AND Phase 4 multi-approver is wired. The recycle-bin **restore** path is allowed; permanent removal is not.
- ❌ Refund and payment-reversal tools (any `Payment` mutation via the AI agent) — these need payment-gateway-specific controls (gateway reconciliation, fund movement compliance, audit symmetry between gateway events and our local Payment model). Out of scope for Phase 3 entirely. Will land as their own subsystem alongside the existing payment provider work.
- ❌ Bulk operations — `bulk_update_*`, `bulk_delete_*`, etc. Single-resource operations only in Phase 3.

The `ai-controllers.shape.spec.ts` invariant test is updated alongside Phase 3.1 to allowlist exactly the routes in the table above. Anything else — including any future permanent-delete or refund attempt — must come with its own ADR / amendment commit.

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
- One-off migration script: for every tenant, **temporarily** grant `:read`, `:write-drafts`, AND `:approve` to the existing `SUPER_ADMIN` role. **This is a rollout convenience only** — it ensures SUPER_ADMINs retain access through 3.1 while operators have time to assign `AI_AGENT_OPERATOR`/`AI_AGENT_APPROVER` to the right people. The grant of `:approve` to SUPER_ADMIN will be **removed** in Phase 3.2. See Decision Log #2.

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

### H. Tenant isolation — Decision Log #11 (mandatory)

These tests run against a Jest setup with two seeded tenants `T1` and `T2`, each with its own SUPER_ADMIN, operator, and approver. All four MUST pass before Phase 3.1 ships.

| # | Test | What it proves |
|---|---|---|
| 31 | `tenant A approver cannot approve tenant B's request` | T2 approver POSTs `/approvals/<T1-request-id>/approve` → **404** (the row is invisible due to `TenantContext.requireId` scoping; we return 404 not 403 to avoid leaking existence) |
| 32 | `tenant A initiator cannot execute tenant B's approved action` | T2 operator holds a (somehow leaked) raw token from T1 and POSTs the executing tool with it → the hash lookup is scoped by `tenantId` and returns no row → 410 `approval_invalid_or_consumed` |
| 33 | `approval tokens are tenant-scoped (hash collisions don't cross tenants)` | Two requests in T1 and T2 with byte-identical inputs produce different `approvalTokenHash` rows because the hash incorporates `tenantId` AND `toolName` AND payload. Even if rawToken collides (cryptographically impossible but tested explicitly), the row lookup still won't return a row from the wrong tenant. |
| 34 | `audit logs are tenant-scoped` | T2 admin GETs `/api/v1/ai/audit?approvalRequestId=<T1-request-id>` → returns no rows. The Phase 1 `AgentAuditLog` query already filters by `tenantId`; this test asserts that filter is still on after the Phase 3 audit serialiser change (the one that adds `approvalRequestId` filtering). |

The four-eyes test (#1) and tenant-isolation tests (#31-34) overlap conceptually but are independent failure modes: four-eyes is intra-tenant, tenant-isolation is inter-tenant. Both must hold.

### I. Stale-data + retry-limit — Decision Log #12 + #13

| # | Test | What it proves |
|---|---|---|
| 35 | `stale_data check fires when resource updatedAt drifts after request` | Request approval for product X. Manually `UPDATE Product SET updatedAt = NOW() WHERE id = X` (simulating a parallel admin edit). Approve and execute. Expect: 409 `stale_data`, approval row → `status='EXPIRED'` with `expirationReason='stale_data'`, `approvalTokenHash=NULL`, audit row written. |
| 36 | `expectedUpdatedAt is captured atomically with the snapshot` | Two concurrent initiate calls in different threads produce two different `expectedUpdatedAt` values that match the `updatedAt` at their respective request times. (Tests the resolver's read-and-stamp atomicity.) |
| 37 | `executionAttempts increments on every consume try` | Mock the underlying service to throw on first 2 attempts, succeed on 3rd. After 3rd attempt: `executionAttempts=3`, `status='CONSUMED'` (operation succeeded just in time). |
| 38 | `4th attempt returns 410 approval_exhausted` | Mock the service to always throw. After 3rd failure, 4th call → 410 `approval_exhausted`, audit row #2e written. Token is invalidated; operator must re-initiate. |
| 39 | `attempt counter survives a crash mid-write` | Simulate a crash inside the consume transaction on attempt 2. Restart, retry: counter is 2 (not reset). Bumps to 3 on this attempt. Asserts the pre-flight bump-then-transact pattern is correct. |
| 40 | `revocation invalidates token even with consume in flight` | Open the consume transaction (hold open via test fixture). Approver revokes. Consume completes — should fail with `approval_invalid_or_consumed` because the hash lookup post-revoke returns no row. |

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

### Explicitly blocked until later phases — Decision Log #9 and #10

- ❌ **Permanent delete via AI** — `permanently_delete_record` and any equivalent `DELETE` route under `/api/v1/ai/*`. Blocked until: (a) a Prisma FK/cascade audit confirms the blast radius for each soft-deletable model. Specifically: what happens to `OrderItem` rows when a Product is hard-deleted (`Restrict`? `SetNull`? `Cascade`?), what happens to `RentalOrder.productId`, `WishlistItem`, `CartItem`, etc. AND (b) Phase 4 multi-approver lands so CRITICAL-tier actions require two approvers. Recycle-bin **restore** ships in Phase 3.1 and is sufficient for the recovery story until then.
- ❌ **Refund / payment-reversal tools** — any mutation on the `Payment` model, any call into Selcom/ClickPesa refund APIs, anything that moves money. These need payment-gateway-specific controls (gateway reconciliation, fund movement compliance, audit symmetry between gateway events and our local Payment model) that the generic approval workflow doesn't cover. Will land as their own subsystem.
- ❌ **Bulk operations** — `bulk_update_*`, `bulk_delete_*`, `bulk_publish_*`. The single-resource approval flow keeps the audit story clean; bulk needs its own design (snapshot per resource? one approval covering N resources? what happens if 3 of 10 fail?).

### Phase 4+ (planned)

- An LLM client (Anthropic/OpenAI) — separate piece of work.
- An admin UI for approval management — Phase 4.
- Per-resource approver assignment (e.g. "only Faith can approve product price changes") — Phase 4.
- Multi-approver escalation (CRITICAL → 2 approvers required) — Phase 4. Decision Log #3.
- Higher-privilege "AI approval admin" override that can revoke any approver's token — Phase 4.
- Approval delegation (approver A delegates to approver B for a window) — later.
- Real-time notifications (in-app banners, push, websocket) — Phase 4.
- Approval analytics dashboard (avg-time-to-approve, top-rejected-reasons, etc.) — Phase 4.
- AI-side risk scoring (auto-flag suspicious requests for extra review) — Phase 5+.

### Explicitly NEVER

- **Per-tool approval policy** that auto-approves a class of action under any condition (e.g. "auto-approve `archive_product` for users with X years tenure"). The whole point of approvals is human review of every risky action; auto-approval defeats the purpose.

---

## 13. Definition of done for Phase 3.1

- [ ] `AgentApprovalRequest` model with all snapshot + risk + retry + stale-data fields (Decision Log #6, #7, #8, #12, #13) shipped via `prisma db push`.
- [ ] `AgentAuditLog.approvalRequestId` column added.
- [ ] Three new permissions seeded; two new system roles seeded per tenant.
- [ ] `RequiresAiPermissionGuard` + `@RequiresAiPermission()` decorator wired into `AiPermissionGuard`.
- [ ] `ApprovalTokenInterceptor` + `@RequiresApproval(riskLevel)` decorator implemented and tested.
- [ ] Approval-management routes (approve, reject, **revoke**, cancel, list, get) live with documented perms.
- [ ] All Phase 3.1 risky-action routes from §8 are live. **Permanent delete is NOT among them** (Decision Log #9). **Refunds are NOT among them** (Decision Log #10).
- [ ] All 40 tests in §10 pass (30 original + 4 tenant-isolation in §10.H + 6 stale-data/retry in §10.I); build fails if any are skipped.
- [ ] `ai-controllers.shape.spec.ts` updated to allow Phase 3 verbs on the explicit allowlist (and to keep blocking `permanent-delete` / refund / bulk verbs).
- [ ] Cron expiry job tested with a time-stub.
- [ ] **Token-storage audit pass**: explicit unit tests asserting (a) raw token never persists, (b) raw token never appears in `AgentAuditLog.outputJson` after approve, (c) audit serialiser strips `approvalTokenHash` from any GET response.
- [ ] CHANGELOG / `IMPLEMENTATION_PLAN.md` updated with Phase 3.1 status.
- [ ] Operator-facing migration note shipped (in-app banner or email) before Phase 3.2 demotion script runs.

When all checked: cut a `release/phase-3.1` tag, push to prod with the new deploy.sh, monitor `AgentAuditLog` for `severity: WARNING` rows for one week, then schedule Phase 3.2 demotion.
