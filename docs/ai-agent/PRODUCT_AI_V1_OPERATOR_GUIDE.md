# Product AI v1 — Operator Guide

**Audience**: Tenant admins, operators, approvers, and store managers who use the Naro Fashion admin dashboard.
**Status**: Live in production as of 2026-05-11.
**Companion reference**: [`PRODUCT_AI_V1.md`](./PRODUCT_AI_V1.md) — the engineering-side canonical reference. This document is the *business* counterpart.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Current live AI product capabilities](#2-current-live-ai-product-capabilities)
3. [Product lifecycle explained](#3-product-lifecycle-explained)
4. [Approval workflow](#4-approval-workflow)
5. [Admin dashboard usage](#5-admin-dashboard-usage)
6. [Roles and responsibilities](#6-roles-and-responsibilities)
7. [What the AI can safely do now](#7-what-the-ai-can-safely-do-now)
8. [What the AI cannot do yet](#8-what-the-ai-cannot-do-yet)
9. [Safety rules for admins](#9-safety-rules-for-admins)
10. [Common workflows](#10-common-workflows)
11. [Troubleshooting](#11-troubleshooting)
12. [Audit and accountability](#12-audit-and-accountability)
13. [Current production status](#13-current-production-status)
14. [Recommended operating model](#14-recommended-operating-model)
15. [Release note — Product AI v1](#15-release-note--product-ai-v1)
16. [Developer appendix](#16-developer-appendix)

---

## 1. Executive summary

Naro Fashion now has an **AI-assisted admin workflow for product management**. The AI helps with the slow, repetitive parts of running a fashion catalogue — creating new product drafts, tidying up product descriptions, and moving products through the publish → archive → restore lifecycle — without taking the human out of the loop on anything that touches what your customers see or what your business owes.

Three things to keep in mind:

1. **The AI can help create drafts, update drafts, and manage product visibility.** Drafts are invisible to customers, so the AI can iterate freely on names, descriptions, and metadata.
2. **Risky actions require approval before execution.** Anything that changes what customers see (publishing a draft, archiving a live product, restoring an archived product) is held in a pending state until a *different* admin approves it.
3. **The system uses a four-eyes approval model.** The same admin cannot both request *and* approve a risky action. There must be two human admins in the loop — the **operator** who requests, and the **approver** who reviews and authorises. This is enforced at the database level; it is not a UI nicety that can be turned off.

> Net effect: the AI accelerates the work of running a Naro Fashion tenant without giving up control over anything customer-visible or money-touching.

---

## 2. Current live AI product capabilities

Six tools are live in production. Three are read-only, one is a draft writer, three are approval-gated lifecycle actions, and one is approval-gated draft editing. Plus an approval-management surface for the approver side.

### Read / search

| Tool | What it does | Who can use it |
|---|---|---|
| `search_products` | Searches the product catalogue by name, slug, category, etc. | Anyone with `ai-agent:use` and `ai-agent:read` |
| `get_product` | Retrieves the full record for a single product (admin view, including draft + archived products) | Same as above |

### Draft creation

| Tool | What it does | Who can use it |
|---|---|---|
| `create_product_draft` | Creates a new product in the **DRAFT** state — invisible to customers, safe to iterate on. | Anyone with `ai-agent:write-drafts` |

### Draft editing (approval-gated)

| Tool | What it does | Risk |
|---|---|---|
| `update_draft_product` | Edits non-pricing, non-lifecycle fields on a DRAFT product (name, description, slug, category, specifications, supplier info, rental window, size guide). Pricing and inventory are explicitly excluded. | MEDIUM — 5-minute approval window |

### Approval-controlled lifecycle

| Tool | What it does | Risk |
|---|---|---|
| `publish_product` | Promotes a DRAFT to ACTIVE (visible to customers). | HIGH — 2-minute approval window |
| `archive_product` | Hides an ACTIVE product from customers (still in the admin; not deleted). | HIGH — 2-minute approval window |
| `restore_product` | Brings an ARCHIVED product back to ACTIVE. | HIGH — 2-minute approval window |

### Approval management (the dashboard side)

These are the actions the approval dashboard at `/dashboard/ai/approvals` exposes. They are the **same regardless of which risky tool created the request** — one shared management surface.

| Action | Who can do it | When |
|---|---|---|
| List approvals (filter by status) | `ai-agent:read` | Any time |
| View approval details (before/after values) | `ai-agent:read` | Any time |
| Approve | `ai-agent:approve`, NOT the original requester | While status is `PENDING` |
| Reject | `ai-agent:approve`, NOT the original requester | While status is `PENDING` |
| Revoke (cancel an already-granted approval) | The original approver only | While status is `APPROVED` and not yet executed |
| Cancel (operator pulls back their own request) | The original requester only | While status is `PENDING` |
| Execute (run the approved action) | The original requester only | While status is `APPROVED` |

---

## 3. Product lifecycle explained

Every product is in exactly one state. The AI tools enforce the legal transitions between them.

### DRAFT — work in progress

- **Customer view**: not visible. Customers cannot find this product anywhere on the storefront.
- **What the AI can do**: create the draft, update its metadata freely (`update_draft_product`), and request approval to publish it.
- **What admins should know**: drafts are the safe space. Iterate freely. Nothing customer-facing changes until you publish.

### ACTIVE — live on the storefront

- **Customer view**: fully visible — appears in category pages, search, recommendations, sitemap, manifest.
- **What the AI can do**: request approval to archive it. Cannot edit metadata directly; metadata edits would require the product to go back to DRAFT first (not a v1 capability — see § 8).
- **What admins should know**: every change to an ACTIVE product goes through approval. This is the protective layer for your live catalogue.

### ARCHIVED — hidden but recoverable

- **Customer view**: not visible. Slug returns 404 on the storefront.
- **What the AI can do**: request approval to restore it back to ACTIVE.
- **What admins should know**: archive is **not** a delete. The product, its photos, its history, and its SKU are all preserved. Use archive when a product is seasonal, out of stock long-term, or being phased out — anything that might come back.

### SOFT_DELETED — recycle bin

- **Customer view**: not visible. Treated as gone.
- **What the AI can do**: nothing in v1. Soft-deleted products are managed entirely through the existing Recycle Bin admin UI.
- **What admins should know**: this is the "I really meant it, but I might still want it back" state. Permanent deletion requires multi-approver workflows that are not yet built.

### Technical state mapping (for reference / forensic queries)

| State | `isActive` | `archivedAt` | `deletedAt` |
|---|:---:|:---:|:---:|
| DRAFT | `false` | `null` | `null` |
| ACTIVE | `true` | `null` | `null` |
| ARCHIVED | `false` | not null | `null` |
| SOFT_DELETED | (any) | (any) | not null |

The transitions enforced by the AI lifecycle tools:

```
DRAFT  --publish_product-->  ACTIVE  --archive_product-->  ARCHIVED
                                 ^                              |
                                 |                              |
                                 +---- restore_product ---------+
```

`update_draft_product` operates **only** on DRAFT-state rows.

---

## 4. Approval workflow

The approval workflow is the heart of Product AI v1. It exists so no single person — and no single AI tool call — can change the public store catalogue or push a draft live without a second pair of eyes.

### The seven steps

1. **Operator requests an action.** The operator (a human admin with `ai-agent:write-drafts`) asks the AI to publish, archive, restore, or edit a draft. The system *does not* execute immediately. Instead it creates an **approval request** in the `PENDING` state and records the proposed change (before/after values, the exact product id, who requested it, and a snapshot of when the product was last updated).
2. **System creates approval request.** The request appears on the approval dashboard at `/dashboard/ai/approvals` for everyone with the approver permission.
3. **Approver reviews before/after values.** A *different* admin opens the request, reads the before/after diff, checks that the product id, slug, and category match what was expected.
4. **Approver approves or rejects.** Approval and rejection are both terminal for the approver side. Rejection ends the workflow with a reason. Approval moves the request to `APPROVED` and generates a token.
5. **A one-time approval token is shown.** After successful approval, the dashboard displays a long hexadecimal string — this is the **approval token**. It is shown **exactly once** and then never again. Only the hash of this token is stored; the raw value lives only in the approver's browser window for that moment.
6. **Operator executes the approved action using the token.** The operator copies the token, returns to their flow, and submits it to the execute endpoint. The system verifies the token hash matches, re-checks that the product hasn't been modified in the meantime, and runs the change.
7. **System updates the product and records audit logs.** Two log rows are written: one to `AdminActivityLog` (the standard admin audit stream, where all admin actions live) and one to `AgentAuditLog` (the AI-specific stream with full input/output payloads).

### Rules you must know

- **The same user cannot approve their own request.** The system rejects self-approval at the service layer (`forbidden_self_approval`) and records a WARNING audit entry. This is the four-eyes rule.
- **Approval tokens are shown once.** If you close the browser window or lose the token, you cannot retrieve it. The approval must be revoked and re-requested.
- **Tokens should not be shared casually.** Treat them like a one-time password. Do not paste them in chat, email, Slack, screenshots, or anywhere else. Use them immediately in the execute step and discard.
- **Tokens are not stored in logs.** Audit rows store only the **hash** of the token. Even an admin with database access cannot recover the raw token from the audit table.
- **Expired approvals must be re-requested.** Each approval has a TTL (2 minutes for HIGH-risk, 5 minutes for MEDIUM). If the operator doesn't execute within the window, the request flips to `EXPIRED` and the operator must request approval again.

### Stale-data and tamper guards

When the operator finally executes, the system runs two extra checks **before** it actually changes the product:

- **Stale-data check** — compares the product's current `updatedAt` against the snapshot captured at approval time. If anyone (a human admin, another AI flow, anything) changed the product in between, the execute fails with `stale_data`. The approval must be re-requested.
- **Payload-hash check** — re-derives the hash of the proposed input from what was stored at approval time. If the stored input has been tampered with at the database layer, the execute fails with `payload_mismatch`.

Both guards force a fresh approval, which is the only safe path.

---

## 5. Admin dashboard usage

### Approval dashboard — `/dashboard/ai/approvals`

This is where every approval lives. Admins with `ai-agent:read` (or higher) can browse it.

What you can see:

- **One row per approval request** — the tool name (e.g., `publish_product`), the product slug, the requesting operator, the current status, the risk badge, and the time remaining before TTL expiry.
- **Status filters** — `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CONSUMED`, `REVOKED`, `EXHAUSTED`, `CANCELLED`. Default view typically shows PENDING + APPROVED so reviewers see what needs action.
- **Risk badges** — HIGH (red, 2-min TTL) for lifecycle transitions; MEDIUM (amber, 5-min TTL) for draft metadata edits.
- **Before/after values** — every approval shows the proposed change as a side-by-side diff. The approver should read both columns top to bottom before clicking Approve.
- **Per-row actions** — based on status and your relationship to the request, the action buttons that appear are: Approve, Reject, Revoke, Cancel, Execute. Buttons you cannot legally use (e.g., Approve on your own request) are hidden, not just disabled.

### Role assignment dashboard — `/dashboard/ai/role-assignments`

This is where the two AI roles are assigned to admin users. Admins with role-management permission see it under the sidebar's **AI Agent** group.

What you can see:

- **One row per admin user** with two toggle controls: one for `AI_AGENT_OPERATOR` and one for `AI_AGENT_APPROVER`.
- **Live stats** — count of operators, count of approvers, count of admins with both roles.
- **Warning banner** when any admin has both roles assigned. The system will still bite via the runtime four-eyes check (it always does), but the role-level separation is what keeps people from accidentally getting in a single-admin-approves-everything habit.
- **Self-modification block** — you cannot toggle your own role from this UI. The backend also rejects self-role-modification (`Cannot change your own roles`).

> **Why separate people should normally hold these roles**: assigning both to one admin technically still respects the four-eyes runtime check at execution time (a person literally cannot self-approve because their user id is checked at the boundary), but it weakens the *organisational* control. Two distinct humans is the spirit of the rule, not just two distinct accounts owned by the same person.

---

## 6. Roles and responsibilities

There are three relevant roles in Product AI v1:

### `SUPER_ADMIN`

- Can do everything in the tenant: manage users, products, payments, settings.
- **Currently retains broad AI access** including the approver permission. This is convenient for early operation but **should not be the long-term default**. Plan to demote SUPER_ADMIN's `ai-agent:approve` permission once you have a few dedicated approvers.
- Treat as a break-glass account, not the daily-driver login.

### `AI_AGENT_OPERATOR`

- Can use AI tools to read, search, and create/edit drafts.
- Can **initiate** lifecycle approval requests (publish/archive/restore) and draft-metadata approval requests.
- **Cannot approve** their own or anyone else's risky action. The approver permission is not in this role.
- This is the "production operator" role — the person who works with the AI day-to-day.

### `AI_AGENT_APPROVER`

- Can review, approve, reject, and revoke risky AI actions.
- **Should be a different human** from the operator. The runtime check bites if it isn't, but the organisational pattern matters.
- Should understand the business impact of each action before clicking Approve. Approvers are the brake pedal.
- Note: an approver who *also* needs to initiate a request must hold `ai-agent:write-drafts` separately — those are independent capabilities.

---

## 7. What the AI can safely do now

Concrete examples of the in-scope capabilities:

- **Create a draft product.** "I'm adding a new wedding gown line — make me a draft for an ivory mermaid silhouette in size 12, with these specifications."
- **Update draft product name / description / specifications.** "Rewrite the description of the draft I made yesterday to emphasise the lace detail." The AI prepares an approval request; an approver reviews the before/after; the operator executes.
- **Request approval to publish a product.** Once a draft is ready, the AI submits a publish request. After approval, the product goes live.
- **Request approval to archive an active product.** Useful for seasonal items going out of rotation. The product stays in admin; customers stop seeing it.
- **Request approval to restore an archived product.** When the season turns back, restore brings it back to ACTIVE without re-uploading photos or re-entering SKU data.
- **Search products.** "Find me all ball-gown drafts with no photos uploaded yet" — direct, read-only.
- **View approval history.** Approvers can scroll back through every PENDING / APPROVED / REJECTED / EXPIRED / CONSUMED record and see who did what when.

---

## 8. What the AI cannot do yet

This list is **explicit** so there's no ambiguity. The following capabilities are **not** in Product AI v1 and should not be expected from the agent:

- **Change product prices.** Base price, sale price, rental rate — none of these are AI-editable.
- **Change rental prices or deposits.** Same as above.
- **Adjust inventory.** Stock-on-hand changes go through the existing admin inventory flow only.
- **Change order status.** Orders are humans-only in v1.
- **Change rental status.** Rental orders are humans-only in v1.
- **Process payments or refunds.** Money movement has no AI surface.
- **Permanently delete records.** Soft delete + recycle bin are humans-only; permanent delete requires a multi-approver workflow that is not yet built.
- **Manage rental policies.** Buffer days, late fees, deposit ratios — none of these are AI-editable.
- **Update active product pricing.** Even with approval, the AI cannot edit price fields on a live product.
- **Bypass approval.** There is no "trusted operator" mode. Every risky action goes through four-eyes.
- **Approve its own action.** The same operator cannot approve their own request. Period.
- **Publish, archive, restore, or update directly without approval.** Direct write endpoints for these actions do not exist on the AI surface. The only way through is `request-approval` → `approve` → `execute`.

If you find yourself wanting any of the above, please open a feature request — do not look for a workaround.

---

## 9. Safety rules for admins

These are operational habits. They are not enforced by software (the software already enforces what it can); they are what you and your team should commit to.

- **Always review before/after values.** Read the diff. Both columns. Do not approve based on the title alone.
- **Do not approve actions you do not understand.** It is fine to ask the requester for clarification before approving. There is no time pressure that justifies a guess.
- **Do not share approval tokens in chat, email, or screenshots.** Treat them like an OTP. Use the token immediately or discard it.
- **Confirm product name / slug / category before publishing.** Slugs are forever — they end up in search engines and customer bookmarks.
- **Confirm the archived/restored product is the right product.** Especially restore — a product that's been archived for months may be out of date in ways you didn't predict.
- **Use reject if the request is unclear.** Rejecting is cheap. The operator just submits a clearer request.
- **Use revoke if an approval was granted by mistake before execution.** Once executed, the action is done. Before execution, revoke is the safe undo.
- **Report unexpected behavior immediately.** If you see a request you didn't make, or an audit row you can't explain, escalate. The system has audit trails for a reason.

---

## 10. Common workflows

Step-by-step recipes for the typical operator + approver dance.

### Workflow A — Create draft → update draft → publish

1. **Operator** (chat / admin UI / AI surface): "Create a draft product for *Ivory Lace Mermaid Gown Size 12*."
2. **System**: creates a DRAFT row. No approval needed. Returns the draft id.
3. **Operator** iterates: "Add a description, set the category to Wedding Dresses → Mermaid, set the size guide to the wedding-dress one."
4. **System**: each metadata change is an approval request (MEDIUM risk, 5-min TTL). Operator submits.
5. **Approver** opens `/dashboard/ai/approvals`, reviews each pending edit, approves the ones that look right.
6. **Operator** clicks Execute on the approved request — change lands in the draft.
7. When the draft is fully ready: **Operator** asks the AI to publish. Approval request appears (HIGH risk, 2-min TTL).
8. **Approver** opens the request, sees a clean before/after (`isActive: false → true`), confirms the slug + category, clicks Approve.
9. **Operator** copies the approval token, clicks Execute. Product is now ACTIVE.
10. Both audit streams record the publish, attributed to the operator with the approver linked via `approvalRequestId`.

### Workflow B — Archive an active product

1. **Operator**: "Archive the *Black Velvet Cocktail Dress* — it's out of season."
2. **System**: creates approval request (HIGH, 2-min TTL).
3. **Approver**: opens the request. Sees `isActive: true → false, archivedAt: null → 2026-05-11 …`. Confirms it's the right product. Approves.
4. **Operator**: copies token, executes within 2 minutes. Product disappears from the storefront. SKU, photos, history all preserved.

### Workflow C — Restore an archived product

1. **Operator**: "Bring the *Black Velvet Cocktail Dress* back — autumn is starting."
2. **System**: creates approval request (HIGH, 2-min TTL). The validator confirms the product is in ARCHIVED state (not DRAFT, not SOFT_DELETED).
3. **Approver**: reviews — `isActive: false → true, archivedAt: 2026-05-11 → null`. Approves.
4. **Operator**: executes. Product is live again.

### Workflow D — Reject a bad approval request

1. **Operator** accidentally requests archive on the wrong product.
2. **Approver** opens the request, notices the product slug doesn't match what was discussed.
3. **Approver** clicks Reject, enters reason: "Wrong product — operator likely meant the *Maroon* variant, not the *Burgundy*."
4. **System** terminates the request with status `REJECTED`. Operator sees the rejection reason. No state change to the product.
5. Operator submits a corrected request.

### Workflow E — Revoke an approval before execution

1. **Operator** requests publish on a draft. **Approver** approves.
2. Before the operator executes, the operator notices a missing photo. They want to fix the draft first, then re-request publish.
3. **Approver** (who is also the original approver) opens the still-`APPROVED` request and clicks Revoke. Reason: "Operator needs to add hero photo before publish."
4. **System** flips status to `REVOKED`, clears the stored token hash, and writes an audit row. The product remains in DRAFT.
5. Operator fixes the draft. Submits a fresh publish request. Workflow A continues normally.

---

## 11. Troubleshooting

These are the error codes the AI surface returns. They are short on purpose — translation for humans:

| Code | What it means in plain English | What to do |
|---|---|---|
| `forbidden_self_approval` | You tried to approve a request you made yourself. The system refuses — that's the four-eyes rule. | Ask a different admin to approve. |
| `stale_data` | Between approval and execute, somebody (or something) modified the product. The approval is no longer safe to execute. | Re-request approval. The fresh request will see the new state. |
| `payload_mismatch` | The stored proposal hash doesn't match what's about to execute. Usually means the input was tampered with at the DB layer, or there's a code-level bug. | Stop. Don't retry blindly. Escalate. |
| `approval_invalid_or_consumed` | The approval token is wrong, or the approval has already been executed (each token can only run once). | Check you copied the token correctly. If yes, the approval was already consumed — submit a new request. |
| `approval_expired` | The TTL ran out (2 min for HIGH, 5 min for MEDIUM) before you executed. | Submit a new approval request. The product hasn't changed. |
| `approval_exhausted` | The execute attempt has been retried more than the allowed cap (3). | The approval is dead. Submit a fresh request. If you keep hitting this, escalate — something is failing systematically. |
| `validation_error` | The input you submitted didn't pass the DTO checks (e.g., a required field is missing, an enum value is wrong, a price is negative). | Read the error message — it names the field. Fix the input and resubmit. |
| `permission_denied` | Your role doesn't have the permission this action requires. | Ask an admin to grant you the right role (`ai-agent:write-drafts` for initiating, `ai-agent:approve` for approving). |

If you see anything not in this list, treat it as an unexpected error and report it.

---

## 12. Audit and accountability

Three things are true about every AI action that runs in production:

1. **Every AI action is logged.** Both audit streams (`AdminActivityLog` for the general admin trail, `AgentAuditLog` for the AI-specific detail) write a row for every tool call — read or write, success or failure.
2. **Approval requests are stored.** Every approval request lives in `AgentApprovalRequest` from creation to terminal state (`CONSUMED`, `REJECTED`, `EXPIRED`, `REVOKED`, `EXHAUSTED`, `CANCELLED`). You can query history at any time.
3. **Admin identity attribution has been fixed to use the real admin user id.** As of 2026-05-11, every audit row written records the actual `adminUserId` of the human who triggered the action. (Prior to that date, the audit columns silently wrote `null` due to a subtle JWT-payload bug. See `docs/SECURITY.md` § 2.X and `apps/api/src/auth/req-user-sub.invariant.spec.ts` for the technical fix and the build-time invariant that prevents recurrence.)

Plus two protective properties:

- **Approval tokens are not stored in audit logs.** Only the SHA-256 hash of the token is persisted. Even if an attacker reads the audit table, the tokens are useless.
- **Product changes can be reviewed later.** Both the `before` and `after` snapshots of every approval are stored in the approval request row. You can answer "what did this product look like before X happened" at any time.

---

## 13. Current production status

- **Product AI v1 is live.** Six product-touching AI tools (read, draft create, draft edit, publish, archive, restore) are in production. See § 2 for the full list.
- **Approval dashboard is live** at `/dashboard/ai/approvals`. PENDING / APPROVED / executed states all routable.
- **Role assignment dashboard is live** at `/dashboard/ai/role-assignments`. Both AI roles assignable, with the four-eyes warning banner active.
- **Product lifecycle tools are live.** DRAFT → publish → ACTIVE → archive → ARCHIVED → restore → ACTIVE — all transitions enforced via approval workflow.
- **Smoke artefacts have been cleaned.** Transient test role assignments created during smoke runs (on `storekeeper` and `admin@`) were reverted on 2026-05-11. `qa-approver` retains `AI_AGENT_APPROVER` as the canonical four-eyes smoke counterparty for future testing.
- **Historical audit rows before the attribution fix may have null `adminUserId`.** Rows written before commit `ec37b1e` (2026-05-11) may carry null in the actor column due to the prior bug. New rows are correctly attributed. No backfill has been performed — the original actor is typically reconstructable from server logs (timestamp + IP), but not from the DB row itself.

---

## 14. Recommended operating model

- **At least one `AI_AGENT_OPERATOR`** — the human who does day-to-day product work with the AI.
- **At least one different `AI_AGENT_APPROVER`** — the human who reviews and signs off on risky changes. Not the same person as the operator.
- **Keep `qa-approver` only for QA / smoke tests.** Do not use the qa-approver account for real catalogue changes. Treat it as a reserved smoke counterparty.
- **Do not give both roles to the same person unless absolutely necessary.** Even when the runtime four-eyes check still bites (it does), single-person ownership of both roles defeats the organisational purpose.
- **Use `SUPER_ADMIN` carefully.** It currently retains all four AI permissions including approver. Plan to demote `ai-agent:approve` from SUPER_ADMIN once your tenant has stable named approvers. SUPER_ADMIN should be a break-glass account, not a daily login.
- **Review approvals daily.** The approval dashboard accumulates EXPIRED and REJECTED rows over time — they are useful forensic breadcrumbs but you also want fresh PENDING requests not to age out unnecessarily.

---

## 15. Release note — Product AI v1

- **Version**: Product AI v1
- **Date**: 2026-05-11
- **Major features**:
  - 6 product-touching AI tools live: `search_products`, `get_product`, `create_product_draft`, `update_draft_product`, `publish_product`, `archive_product`, `restore_product`.
  - Approval workflow with one-time hashed tokens, four-eyes rule, payload-hash binding, stale-data guard, TTL expiry cron, and 3-attempt cap.
  - Approval dashboard at `/dashboard/ai/approvals` with status-aware action buttons.
  - Role assignment dashboard at `/dashboard/ai/role-assignments` for the two AI roles.
  - Full audit trail across `AdminActivityLog` and `AgentAuditLog`, both attributed to the real admin user id.
- **Security controls**:
  - Self-approval blocked at the service layer (`forbidden_self_approval`).
  - Approval tokens stored as hash only — raw tokens never persisted, never logged.
  - DTO whitelist + `forbidNonWhitelisted` enforced on all AI write endpoints.
  - Build-time invariants pin the read-only contract on Phase 1 controllers, the approval-decorator count on Phase 3 controllers, and the global `req.user.id` attribution pattern.
  - Tenant isolation: all approval lookups scoped by `tenantId`; cross-tenant access returns 404 (not 403) to avoid leaking existence.
- **Known limitations** (see § 8 for the full list):
  - No pricing edits, no inventory adjustments, no order/rental state changes, no payments/refunds, no permanent deletes, no rental policy management.
  - `SUPER_ADMIN` still retains `ai-agent:approve` (planned demotion in a future phase).
  - Historical audit rows before 2026-05-11 may carry null `adminUserId`.
- **Next recommended improvements**:
  - Demote `ai-agent:approve` from `SUPER_ADMIN` once tenants have stable approvers (Phase 3.2 in the roadmap).
  - Phase 4 candidates: permanent delete with multi-approver, refund workflows, multi-approver for CRITICAL actions, in-dashboard chat surface for the agent.
  - Operator UX: in-dashboard "Run as AI" widget so operators don't have to context-switch to a separate AI surface.

---

## 16. Developer appendix

Technical references for engineers extending or maintaining Product AI v1:

- [`docs/ai-agent/PRODUCT_AI_V1.md`](./PRODUCT_AI_V1.md) — engineering-side canonical reference (tool roster, route inventory, decision log).
- [`docs/ai-agent/PRODUCT_LIFECYCLE.md`](./PRODUCT_LIFECYCLE.md) — state machine + admin paths.
- [`docs/ai-agent/PHASE_3_DESIGN.md`](./PHASE_3_DESIGN.md) — approval workflow design (token hashing, four-eyes, TTL, payload hash, expiry cron).
- [`docs/ai-agent/AUDIT_LOGGING.md`](./AUDIT_LOGGING.md) — two-stream audit design and identity-attribution invariant.
- [`docs/ai-agent/APPROVAL_WORKFLOW.md`](./APPROVAL_WORKFLOW.md) — lifecycle states + DB constraints on `AgentApprovalRequest`.
- [`apps/api/src/auth/req-user-sub.invariant.spec.ts`](../../apps/api/src/auth/req-user-sub.invariant.spec.ts) — global source-text invariant that forbids `req.user.sub` re-introduction.

For operator-side questions about a specific tool that's not in this guide, start at `PRODUCT_AI_V1.md` and follow the cross-references from there.
