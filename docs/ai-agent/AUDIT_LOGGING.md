# Naro Fashion — AI Agent Audit Logging

## Two complementary audit streams

| Stream | Existing? | Scope | Purpose |
|---|---|---|---|
| **`AdminActivityLog`** | YES — `apps/api/src/audit/audit.service.ts` | All admin actions (UI + API + AI) | Single source of truth for "who did what to which entity" |
| **`AgentAuditLog`** (new) | NO — Phase 1 work | AI-agent-only actions | Adds AI-specific fields the existing schema doesn't carry: `tool_name`, `agent_session_id`, `input_json`, `output_json`, `approval_request_id`, `severity` |

We **do not** replace `AdminActivityLog`. Every AI tool call writes ONE row to `AdminActivityLog` (existing tooling, exports, dashboards keep working) AND ONE row to `AgentAuditLog` (richer detail for AI debugging). They are linked by `(adminUserId, createdAt)` and by storing the `AgentAuditLog.id` in `AdminActivityLog.details.agentAuditId`.

> **Identity attribution invariant** — both `adminUserId` columns are populated from `req.user.id`, the resolved row that `JwtStrategy.validate()` attaches to the request. **Never** read `req.user.sub` here: `sub` is the JWT payload field and is not preserved onto `req.user`. Reading it yielded `undefined` until 2026-05-11 and silently anonymised every audit row written across both streams. See `docs/SECURITY.md` § 2.X "Identity Attribution" for root cause and the build-time invariant (`apps/api/src/auth/req-user-sub.invariant.spec.ts`) that prevents regression.

## Why both

- The existing `audit` module already has a controller (`GET /audit`, `GET /audit/export`, filters), permission codes (`audit:view`, `audit:export`), and is already wired into 29 log points across products/categories/orders/rentals/CMS/flash-sales/roles/inventory. Re-using it means AI actions show up in the same admin "Activity" page admins already use. **Don't fork that view.**
- AI actions need extra context (full input + output payloads, session, approval link, agent name) that the existing `details Json?` column can hold but isn't shaped for high-volume querying. A dedicated `AgentAuditLog` table keeps that data indexable without bloating the main log.

## `AgentAuditLog` Prisma model

Add to `packages/database/prisma/schema.prisma`:

```prisma
model AgentAuditLog {
  id                  String   @id @default(cuid())
  tenantId            String?
  adminUserId         String
  agentName           String                                 // "naro-fashion-admin"
  agentSessionId      String?
  toolName            String                                 // e.g. "publish_product"
  actionType          String                                 // CREATE | UPDATE | DELETE | RESTORE | PUBLISH | ARCHIVE | STATUS_CHANGE | ADJUST_INVENTORY | NOTE | READ
  targetResourceType  String?                                // e.g. "Product"
  targetResourceId    String?
  inputJson           Json?                                  // sanitised — never includes JWT/secrets
  outputJson          Json?                                  // truncated if > 64KB
  approvalRequired    Boolean  @default(false)
  approvalStatus      String?                                // NOT_REQUIRED | PENDING | APPROVED | REJECTED | EXPIRED | CONSUMED
  approvalRequestId   String?
  approvalToken       String?                                // tokens are short-lived; storing the id is enough but the token is captured for forensics
  status              String                                 // SUCCESS | FAILED | REJECTED | UNAUTHORIZED | VALIDATION_ERROR | PERMISSION_DENIED | MODULE_DISABLED
  errorMessage        String?
  severity            String   @default("INFO")              // INFO | NOTICE | WARNING | CRITICAL
  ipAddress           String?
  userAgent           String?
  durationMs          Int?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([tenantId, createdAt])
  @@index([adminUserId, createdAt])
  @@index([toolName])
  @@index([targetResourceType, targetResourceId])
  @@index([severity])
  @@index([approvalRequestId])
}
```

## Field semantics

| Field | Notes |
|---|---|
| `tenantId` | Always set unless the operator is a PlatformAdmin (which is out of scope for this agent). |
| `adminUserId` | The JWT subject. Same person who approved if `approvalRequired = true`. |
| `agentName` | Always `"naro-fashion-admin"` for now; future agents add their own name. |
| `agentSessionId` | Opaque string the agent runtime generates per chat session. Used to group all writes done in one operator conversation. |
| `toolName` | One of the keys in `AI_TOOLS.md`. |
| `actionType` | High-level verb. CREATE/UPDATE/DELETE/RESTORE/PUBLISH/ARCHIVE/STATUS_CHANGE/ADJUST_INVENTORY/NOTE/READ. |
| `inputJson` | Sanitised — strip `password*`, `passwordResetToken`, `Authorization`, anything matching `/secret/i`, `/key/i`, `/token/i` except `approvalToken` (which is fine to log because it's already consumed). |
| `outputJson` | Same sanitisation. Truncate at 64KB; replace overflow with `{ truncated: true, originalSize: N }`. |
| `approvalRequestId` | FK-soft to `AgentApprovalRequest.id`. Linked record carries `payloadHash` for forensic re-verification. |
| `severity` | `INFO` for normal writes; `NOTICE` for status changes; `WARNING` for approval rejections / validation failures; `CRITICAL` for `permanently_delete_record` (whether successful or not), policy changes, and any failure mid-write. |
| `durationMs` | Wall time for the AI route handler (excluding network). Useful to spot slow tools. |

## What gets written

- **Every** AI tool call writes exactly one `AgentAuditLog` row, regardless of success/failure (including 400/403/404/409/422/500 paths and approval rejections).
- **Read-only tools** also write rows but with `actionType: 'READ'` and `severity: 'INFO'`. The agent will be querying a lot — index on `createdAt` keeps this manageable; consider 90-day rolling retention for `READ` rows in Phase 4.
- **Successful writes** also write to `AdminActivityLog` via the existing `AuditService.log(action, entity, entityId, details, overrideAdminUserId?)`. The agent layer passes `details: { agentAuditId, agentSessionId, toolName, approvalRequestId? }`.

## Sanitisation rules (applied before persisting `inputJson` / `outputJson`)

Implement once in `apps/api/src/ai/util/audit-sanitise.ts` (Phase 1):

- Drop keys whose name matches `/^(password|passwordHash|passwordResetToken|secret|api[-_]?key|client[-_]?secret|webhook[-_]?secret|authorization|bearer)$/i`.
- Truncate any string value > 4KB to first 4096 chars + `… (truncated)`.
- Truncate any array > 200 items to first 200 + `…`.
- Replace whole-payload size > 64KB with `{ truncated: true, originalSize, sample: <first 4KB JSON> }`.
- Never log raw images / file blobs — log the URL only.

## Service implementation sketch

```ts
// apps/api/src/ai/services/agent-audit.service.ts (Phase 1)
@Injectable({ scope: Scope.REQUEST })
export class AgentAuditService {
  constructor(
    @Inject(REQUEST) private readonly request: Request,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,        // existing
  ) {}

  async record(args: {
    toolName: string;
    actionType: string;
    targetResourceType?: string;
    targetResourceId?: string;
    input?: any;
    output?: any;
    status: 'SUCCESS' | 'FAILED' | 'REJECTED' | 'UNAUTHORIZED' | 'VALIDATION_ERROR' | 'PERMISSION_DENIED' | 'MODULE_DISABLED';
    errorMessage?: string;
    severity?: 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL';
    approvalRequired?: boolean;
    approvalStatus?: string;
    approvalRequestId?: string;
    durationMs?: number;
  }) {
    const req = this.request as any;
    const adminUserId = req.user?.sub ?? null;
    if (!adminUserId) return;

    const sanitisedInput  = sanitise(args.input);
    const sanitisedOutput = sanitise(args.output);

    const row = await this.prisma.agentAuditLog.create({
      data: {
        tenantId: this.tenantContext.id,
        adminUserId,
        agentName: 'naro-fashion-admin',
        agentSessionId: req.headers?.['x-agent-session-id'] ?? null,
        toolName: args.toolName,
        actionType: args.actionType,
        targetResourceType: args.targetResourceType,
        targetResourceId: args.targetResourceId,
        inputJson: sanitisedInput,
        outputJson: sanitisedOutput,
        approvalRequired: args.approvalRequired ?? false,
        approvalStatus: args.approvalStatus,
        approvalRequestId: args.approvalRequestId,
        status: args.status,
        errorMessage: args.errorMessage,
        severity: args.severity ?? (args.status === 'SUCCESS' ? 'INFO' : 'WARNING'),
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
        durationMs: args.durationMs,
      },
    });

    // Also feed the existing log for write actions so the regular admin
    // activity page surfaces them.
    if (args.actionType !== 'READ' && args.status === 'SUCCESS' && args.targetResourceType) {
      await this.auditService.log(
        args.actionType,
        args.targetResourceType,
        args.targetResourceId,
        { agentAuditId: row.id, agentSessionId: row.agentSessionId, toolName: row.toolName, approvalRequestId: row.approvalRequestId },
      );
    }

    return row;
  }
}
```

The AI route layer wraps every handler in a try/catch that calls `record()` exactly once, regardless of branch.

## Querying & exporting

- Reuse `apps/api/src/audit/audit.controller.ts` — but add a separate read endpoint for the richer table:
  - `GET /api/v1/ai/audit?toolName=&adminUserId=&severity=&from=&to=&page=&limit=` (perm: `audit:view`)
  - `GET /api/v1/ai/audit/export?from=&to=` returns CSV (perm: `audit:export`).
- Daily ops digest (Phase 4): a scheduled job emails CRITICAL rows to platform admins.

## Retention

- `AdminActivityLog`: keep indefinitely (existing behaviour).
- `AgentAuditLog`:
  - `severity = 'INFO'` (mostly READs and routine writes): 365 days, then prune.
  - `severity ≥ 'NOTICE'`: keep indefinitely.
- Implement as a nightly cron (`@Cron('0 3 * * *')`) in Phase 4 — not Phase 1; data volume is low at first.

## Privacy / GDPR notes

- The `inputJson` may contain customer PII (names, phones, addresses) for `create_rental` and `add_order_note`. The existing privacy posture treats `AdminActivityLog` as confidential admin data — `AgentAuditLog` inherits the same posture.
- IP addresses are kept (matches `AdminActivityLog`). If a future Tanzanian data-protection requirement forces redaction, redact `ipAddress` after 90 days via the same nightly cron.

## What we explicitly do NOT log

- Raw JWTs, refresh tokens, password hashes, env-var secrets — sanitiser drops them.
- Customer payment card numbers — none of the AI tools accept these.
- Storefront customer chat / browsing — out of scope.
