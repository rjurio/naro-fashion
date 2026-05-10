# Naro Fashion — AI Agent Approval Workflow

Two-phase commit for risky AI agent actions. The agent never executes a destructive or financially significant action in a single call: it first **requests approval** (phase 1), shows the operator the plain-English summary, receives a token from the operator, then **executes with the token** (phase 2). The token is short-lived, single-use, and tied to the exact action payload.

## Why two-phase

- The agent's input parsing can hallucinate or mis-summarise.
- An operator must see the concrete change before it lands.
- Audit logs need a clear "approved by X at Y" linkage even when the AdminUser running the agent is the same person who approves — every approval is a deliberate second click, not a side-effect of the chat.

## Actions that require approval

Hard list — must match `AI_TOOLS.md`. Any tool not on this list is non-destructive.

| Action | Reason |
|---|---|
| `publish_product` | Goes live on storefront |
| `update_product` with pricing fields | Affects revenue |
| `archive_product` (soft) | Removes from storefront listings |
| `delete_product` (permanent) | Irreversible |
| `restore_product` | Re-publishes a previously deleted record |
| `delete_category` | Affects every product under it |
| `restore_category` | Re-exposes deleted nodes |
| `delete_size`, `restore_size` | Affects variant size labels |
| `update_order_status` | Triggers inventory + payment side-effects |
| `add_order_note` | NO (notes are reversible) |
| `update_rental_status`, `mark_rental_returned` | Late-fee assessment, status workflow |
| `record_rental_damage` | Money + inventory |
| `adjust_inventory` | Direct stock change |
| `update_rental_policy` | Affects every future rental |
| `update_size_guide_entry` with `isActive: true` or `isDefault: true` | Public-facing content swap |
| `delete_size_guide_entry` | Customers may rely on it |
| `restore_deleted_record` | Re-exposes a deleted record |
| `permanently_delete_record` | Irreversible — fresh-token rule applies |
| Any future refund / payment action | Money out the door |

## Data model

New Prisma model — add to `packages/database/prisma/schema.prisma`:

```prisma
model AgentApprovalRequest {
  id                String   @id @default(cuid())
  tenantId          String?
  adminUserId       String                            // who must approve (and who triggered)
  agentSessionId    String?
  toolName          String                            // e.g. "publish_product"
  targetResourceType String                           // e.g. "Product"
  targetResourceId   String?                          // when known
  inputJson         Json                              // exact payload that will be executed
  payloadHash       String                            // sha256(toolName + canonicalJSON(inputJson))
  summary           String                            // plain-English description shown to operator
  status            String   @default("PENDING")      // PENDING | APPROVED | REJECTED | EXPIRED | CONSUMED
  approvalToken     String?  @unique                  // present once status=APPROVED
  approvedBy        String?                           // adminUserId who approved
  approvedAt        DateTime?
  rejectedAt        DateTime?
  consumedAt        DateTime?                         // when the executing call used the token
  expiresAt         DateTime
  ipAddress         String?
  userAgent         String?
  createdAt         DateTime @default(now())

  @@index([tenantId])
  @@index([adminUserId])
  @@index([status])
  @@index([expiresAt])
}
```

## Token rules

| Rule | Default action | Permanent delete |
|---|---|---|
| Default TTL | 5 minutes | **60 seconds** |
| Reusable | No (single-use; `status` flips to `CONSUMED`) | No |
| Cacheable on agent side | No | **No, ever** |
| Tied to exact payload | Yes — `payloadHash` must match at execute time | Yes |
| Approver must be the same `adminUserId` who requested | Yes | Yes |
| Same person, separate click | Yes | Yes — operator must type `approve permanent <token>` (full phrase) |

If the operator alters any field between request and execute, `payloadHash` differs → the executing endpoint rejects with `409 payload_mismatch`. The agent must re-request approval.

## Phase 1 — request approval

The agent calls the executing AI tool with the relevant `input` but no `approvalToken`. The endpoint:

1. Runs validation as if it were going to execute (so the operator sees real validation errors before approving).
2. Computes `payloadHash = sha256(tool || canonicalJSON(input))`.
3. Inserts `AgentApprovalRequest` with `status: 'PENDING'`, `expiresAt: now() + ttl`.
4. Returns `400` (or `200` with an envelope; we use `200 + ok:false + error:'approval_required'` for cleaner agent UX):

```json
{
  "ok": false,
  "error": "approval_required",
  "approvalRequest": {
    "id": "appr_req_2026_05_10_a1b2",
    "summary": "Publish product 'Floral Mermaid Gown' (TZS 850,000, category Wedding Dresses, 3 variants, 5 images). Will become visible on https://www.narofashion.co.tz immediately.",
    "expiresAt": "2026-05-10T11:35:00Z",
    "ttlSeconds": 300,
    "tool": "publish_product",
    "targetResourceType": "Product",
    "targetResourceId": "cm123abc"
  }
}
```

The agent shows the `summary` to the operator and asks: *"Reply `approve` to publish, or `cancel` to abort."*

## Phase 1.5 — operator approves (or rejects)

`POST /api/v1/ai/approvals/:id/approve` — requires the same admin JWT that opened the request.
Returns:
```json
{
  "ok": true,
  "approvalToken": "appr_tok_2026_05_10_x9y8",
  "expiresAt": "2026-05-10T11:35:00Z",
  "tool": "publish_product"
}
```

`POST /api/v1/ai/approvals/:id/reject` — sets `status: 'REJECTED'`, no token issued.

In a chat-style agent, "approve" / "reject" buttons (or `approve` / `cancel` text replies) call these endpoints behind the scenes. The agent never types the token itself — it asks the system for one only after the operator's positive intent is captured.

## Phase 2 — execute

The agent re-calls the original tool with the same `input` plus `approvalToken`. The executing endpoint:

1. Looks up `AgentApprovalRequest` by token.
2. Checks `status === 'APPROVED'`, `expiresAt > now()`, `consumedAt IS NULL`.
3. Recomputes `payloadHash` from the incoming `input`. Rejects with `409 payload_mismatch` if it differs from the stored hash.
4. Confirms the requesting `adminUserId` matches the JWT subject.
5. Marks `consumedAt = now()`, `status = 'CONSUMED'` in the same Prisma transaction as the actual write.
6. Calls the existing service (e.g. `productsService.toggleActive(id)`), letting all the existing validation / module / tenant guards run.
7. Logs to `AuditService` AND `AgentAuditLog` (see `AUDIT_LOGGING.md`) with `approvalRequestId` linked.
8. Returns the success envelope.

If any check fails the request is rejected with a clear message; the operator can re-issue from phase 1.

## Permanent-delete extra rules

`permanently_delete_record` requires:

- TTL: 60 seconds (vs 5 minutes default).
- The agent's prompt to the operator MUST include the exact resource label and ID, and the phrase *"This cannot be undone."*
- The approve call requires `confirmText: "DELETE <resourceType> <resourceId>"` body field — typed verbatim.
- `recycle-bin:permanent-delete` permission required at both phases.
- AgentAuditLog records `severity: 'CRITICAL'` so it surfaces in the daily ops digest.

## Who can approve

- The same `AdminUser` who opened the request (default — single-person approval is fine for most actions).
- For `permanently_delete_record` and `update_rental_policy`, optionally require a different SUPER_ADMIN approver. Implementation: when the operator's role is not SUPER_ADMIN, the approve endpoint returns `403 needs_super_admin_approver` and the workflow re-prompts. Phase 4 enhancement.

## Failure modes

| Code | Meaning | What the agent should say |
|---|---|---|
| `approval_required` | Tool requires approval and no token supplied | Show summary, ask operator to approve/cancel |
| `approval_expired` | Token outside TTL | "The approval window expired. Want me to start over?" |
| `approval_consumed` | Token already used | "This action was already executed. Do you want to do it again?" |
| `payload_mismatch` | Input changed between request and execute | "The request changed since approval. I'll re-request." |
| `approver_mismatch` | A different user tried to approve | Refuse — log to audit |
| `permission_denied` | The operator lacks the action's permission | Name the missing permission code, stop |
| `module_disabled` | `@RequiresModule()` returned false | Tell operator to enable the module |
| `validation` | DTO whitelist rejected a field | Show the field and let operator correct |

## Example conversation

```
Operator: Publish the Floral Mermaid Gown.

Agent: Found one match: Floral Mermaid Gown (id cm123abc, draft, TZS 850,000,
       category Wedding Dresses, 3 variants, 5 images, 0 reviews).
       This will become visible on https://www.narofashion.co.tz immediately.
       Reply `approve` to publish, or `cancel` to abort. (Window: 5 minutes.)

Operator: approve

Agent: Done. Floral Mermaid Gown is live. Audit id audit_2026_05_10_p4q5,
       approval id appr_req_2026_05_10_a1b2.
```

## Endpoints (planned)

```
POST  /api/v1/ai/<tool>                       # Phase 1 (no approvalToken) → returns approval_required
POST  /api/v1/ai/approvals/:id/approve        # Operator approves → token issued
POST  /api/v1/ai/approvals/:id/reject         # Operator rejects → request closed
POST  /api/v1/ai/<tool>                       # Phase 2 (with approvalToken) → executes
GET   /api/v1/ai/approvals?status=PENDING     # List the operator's open requests
GET   /api/v1/ai/approvals/:id                # Inspect one (for the agent to re-render the summary)
```

All endpoints require `JwtAuthGuard + AdminGuard + 'ai-agent:use'` permission.
