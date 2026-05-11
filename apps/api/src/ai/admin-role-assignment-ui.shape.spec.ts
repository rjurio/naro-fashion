import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Admin UI invariants for the AI role-assignment page — 2026-05-11.
 *
 * The admin app has no Jest runner yet (Step A established this).
 * We keep the UI's role-handling invariants from regressing by
 * running source-text scans from the API's existing jest config,
 * exactly like admin-approvals-ui.shape.spec.ts and
 * ai-controllers.shape.spec.ts.
 *
 * Scope (Step C — AI role assignment workflow):
 *   - The page references both AI_AGENT_OPERATOR and AI_AGENT_APPROVER
 *     by their exact role-name strings (so a future refactor that
 *     renames the system roles fails the build before deploy).
 *   - The page uses the existing assignAdminUserRole /
 *     removeAdminUserRole API client methods (NOT a parallel custom
 *     endpoint, NOT raw fetch).
 *   - No new backend tool / route is wired (the build-time AI
 *     controller shape spec still asserts exactly 4 @RequiresApproval
 *     routes — proven by phase-3-foundation.spec.ts).
 *   - Every assignment is gated by useConfirm() — no silent toggles.
 *   - The approver-assignment confirm uses variant='danger' to surface
 *     the extra blast-radius warning.
 *   - The "both roles" warning text is present (operators are warned
 *     that combining roles weakens policy separation, even though the
 *     runtime four-eyes check still bites).
 *   - Self-modification is blocked client-side (the backend also
 *     rejects, but blocking in the UI gives a faster error path).
 *   - Sidebar entry exists under the AI Agent group.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PAGE_PATH = join(
  REPO_ROOT,
  'apps',
  'admin',
  'app',
  'dashboard',
  'ai',
  'role-assignments',
  'page.tsx',
);
const SIDEBAR_PATH = join(
  REPO_ROOT,
  'apps',
  'admin',
  'components',
  'layout',
  'Sidebar.tsx',
);
const API_CLIENT_PATH = join(REPO_ROOT, 'apps', 'admin', 'lib', 'api.ts');

let pageSrc: string;
let sidebarSrc: string;
let apiSrc: string;

beforeAll(() => {
  pageSrc = readFileSync(PAGE_PATH, 'utf8');
  sidebarSrc = readFileSync(SIDEBAR_PATH, 'utf8');
  apiSrc = readFileSync(API_CLIENT_PATH, 'utf8');
});

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('Admin UI — AI Role Assignments page invariants', () => {
  describe('Role identifiers are the exact seeded names', () => {
    it('references AI_AGENT_OPERATOR literally', () => {
      // The seeded role names live in AI_AGENT_ROLE_NAMES on the API
      // side. The UI uses the literal strings — if the seeder ever
      // renames a role, this spec catches the mismatch.
      expect(pageSrc).toMatch(/AI_AGENT_OPERATOR/);
    });

    it('references AI_AGENT_APPROVER literally', () => {
      expect(pageSrc).toMatch(/AI_AGENT_APPROVER/);
    });

    it('looks up roles by name (not by id) so seeder changes flow through', () => {
      const stripped = stripComments(pageSrc);
      // The page uses `roles.find((r) => r.name === AI_OPERATOR_NAME)`.
      // If the lookup ever changes to id-based, the page would silently
      // break the moment the role IDs differ between staging and prod.
      expect(stripped).toMatch(/r\.name === AI_OPERATOR_NAME/);
      expect(stripped).toMatch(/r\.name === AI_APPROVER_NAME/);
    });
  });

  describe('Reuses existing backend endpoints — no parallel API', () => {
    it('imports the existing API client (no raw fetch)', () => {
      const stripped = stripComments(pageSrc);
      expect(stripped).toMatch(/from '@\/lib\/api'/);
      // No raw fetch( anywhere in the page — the backend bearer-token
      // attachment + 401 refresh flow must run.
      expect(stripped).not.toMatch(/[^a-z]fetch\(/);
    });

    it('calls adminApi.assignAdminUserRole for assignment', () => {
      const stripped = stripComments(pageSrc);
      expect(stripped).toMatch(/adminApi\.assignAdminUserRole\(/);
    });

    it('calls adminApi.removeAdminUserRole for removal', () => {
      const stripped = stripComments(pageSrc);
      expect(stripped).toMatch(/adminApi\.removeAdminUserRole\(/);
    });

    it('API client methods are unchanged from Step C wiring — exact path matches', () => {
      // Sanity check: the existing methods POST to the correct paths.
      // If a future refactor renames the URL we want to catch it here.
      expect(apiSrc).toMatch(
        /assignAdminUserRole[\s\S]+?\/admin-users\/\$\{userId\}\/roles/,
      );
      expect(apiSrc).toMatch(
        /removeAdminUserRole[\s\S]+?\/admin-users\/\$\{userId\}\/roles\/\$\{roleId\}/,
      );
    });
  });

  describe('Confirmation before every assignment', () => {
    it('uses useConfirm() from the existing ConfirmDialog component', () => {
      const stripped = stripComments(pageSrc);
      expect(stripped).toMatch(/useConfirm/);
      // The toggleRole flow awaits confirm() before calling the API.
      expect(stripped).toMatch(/const ok = await confirm\(/);
    });

    it('passes variant=danger to the confirm dialog when assigning AI_AGENT_APPROVER', () => {
      const stripped = stripComments(pageSrc);
      // The danger variant surfaces extra-red styling so the operator
      // pauses on the high-blast-radius role.
      expect(stripped).toMatch(/isApprover && nextAssigned \? 'danger'/);
    });

    it('confirmation copy mentions APPROVAL responsibility for the approver role', () => {
      // Operators must see a clear "this user will be able to approve
      // risky AI actions" warning before granting AI_AGENT_APPROVER.
      // The text lives in the confirmMessage branch.
      expect(pageSrc).toMatch(
        /will be able to APPROVE risky AI actions/,
      );
    });

    it('confirmation copy mentions self-approval still blocked', () => {
      // The user's spec says: "warn that AI_AGENT_APPROVER can approve
      // risky AI actions" AND "the four-eyes rule still prevents
      // self-approval". Both messages must appear in the UI.
      expect(pageSrc).toMatch(
        /four-eyes rule still prevents self-approval/,
      );
    });
  });

  describe('Both-roles warning surface', () => {
    it('counts admins with both roles and surfaces a warning banner', () => {
      const stripped = stripComments(pageSrc);
      // The stats.both counter feeds the banner. Both must be present.
      expect(stripped).toMatch(/stats\.both/);
      expect(pageSrc).toMatch(/both AI roles assigned/i);
    });

    it('warning copy mentions four-eyes still bites despite both roles', () => {
      expect(pageSrc).toMatch(
        /four-eyes runtime check still prevents self-approval/,
      );
    });
  });

  describe('Self-modification — UI mirrors the backend service-layer check', () => {
    it('disables toggles when the target admin id matches the current user id', () => {
      const stripped = stripComments(pageSrc);
      // Two layers: the toggle component receives `disabled={isSelf}`,
      // and toggleRole() short-circuits with a toast before any API call.
      expect(stripped).toMatch(/admin\.id === user\?\.id/);
      expect(stripped).toMatch(/cannot change your own/i);
    });

    it('toggleRole bails out before calling the API on self-modification', () => {
      const stripped = stripComments(pageSrc);
      // The early-return pattern: `if (admin.id === user?.id) { toast; return; }`
      expect(stripped).toMatch(
        /toggleRole[\s\S]+?admin\.id === user\?\.id[\s\S]+?return;/,
      );
    });
  });

  describe('Sidebar entry — under AI Agent group', () => {
    it('has a sidebar link to /dashboard/ai/role-assignments', () => {
      expect(sidebarSrc).toMatch(
        /href:\s*'\/dashboard\/ai\/role-assignments'/,
      );
    });

    it('the link label is "Role Assignments"', () => {
      const stripped = stripComments(sidebarSrc);
      expect(stripped).toMatch(/label:\s*'Role Assignments'/);
    });
  });

  describe('Read-only safety — page never invents new permissions or routes', () => {
    it('does NOT reference any AI permission code outside the documented set', () => {
      // The four AI permissions are listed in the explainer cards as
      // <code>ai-agent:use</code> etc. We just sanity-check none are
      // mis-typed.
      expect(pageSrc).toMatch(/ai-agent:use/);
      expect(pageSrc).toMatch(/ai-agent:read/);
      expect(pageSrc).toMatch(/ai-agent:write-drafts/);
      expect(pageSrc).toMatch(/ai-agent:approve/);
      // No new permission codes invented:
      expect(pageSrc).not.toMatch(/ai-agent:(?!use|read|write-drafts|approve)[a-z-]+/);
    });

    it('does NOT add a new endpoint URL — only the existing /admin-users/:id/roles path is used', () => {
      const stripped = stripComments(pageSrc);
      // The page can only reach the backend via adminApi methods.
      // None of those need a new URL.
      expect(stripped).not.toMatch(/\/ai-roles\//);
      expect(stripped).not.toMatch(/\/role-assignments\/api\//);
    });
  });
});
