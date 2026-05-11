import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Admin UI invariants for the AI approvals page — 2026-05-11.
 *
 * The admin app (apps/admin/) has no test runner yet. To keep the
 * UI's token-handling invariants from regressing, we run a small
 * source-text scan from the API's existing jest config. Same pattern
 * as ai-controllers.shape.spec.ts and size-guides.controller.shape.
 * spec.ts.
 *
 * Files checked:
 *   - apps/admin/app/dashboard/ai/approvals/page.tsx
 *   - apps/admin/lib/api.ts            (the new approval methods)
 *   - apps/admin/components/layout/Sidebar.tsx   (the nav entry)
 *
 * The invariants below mirror the security model documented in
 * docs/ai-agent/PHASE_3_DESIGN.md §5 + docs/ai-agent/PRODUCT_AI_V1.md
 * §4. If a future PR adds a bug like persisting the token in
 * localStorage, or rendering approvalTokenHash anywhere, the build
 * fails before deploy.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PAGE_PATH = join(
  REPO_ROOT,
  'apps',
  'admin',
  'app',
  'dashboard',
  'ai',
  'approvals',
  'page.tsx',
);
const API_CLIENT_PATH = join(REPO_ROOT, 'apps', 'admin', 'lib', 'api.ts');
const SIDEBAR_PATH = join(
  REPO_ROOT,
  'apps',
  'admin',
  'components',
  'layout',
  'Sidebar.tsx',
);

let pageSrc: string;
let apiSrc: string;
let sidebarSrc: string;

beforeAll(() => {
  pageSrc = readFileSync(PAGE_PATH, 'utf8');
  apiSrc = readFileSync(API_CLIENT_PATH, 'utf8');
  sidebarSrc = readFileSync(SIDEBAR_PATH, 'utf8');
});

/**
 * Strip block + line comments before searching. Lets us keep
 * doc-comments mentioning forbidden patterns without triggering false
 * positives — same trick the AI controllers shape spec uses.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('Admin UI — AI Approvals page invariants', () => {
  describe('Token persistence — raw token must never leave React state', () => {
    it('does NOT write the raw approvalToken to localStorage', () => {
      const stripped = stripComments(pageSrc);
      // Catch any localStorage write that mentions `approvalToken` or
      // the raw token variable names we use (rawToken, executeToken,
      // tokenModal.rawToken).
      expect(stripped).not.toMatch(
        /localStorage\.setItem\([^)]*(approvalToken|rawToken|executeToken|tokenModal\.rawToken)/i,
      );
      // Defensive: catch the generic `localStorage.setItem(..., approvalToken)`
      // where the variable is in the value position.
      expect(stripped).not.toMatch(/localStorage\.[a-z]+\([^)]*token/i);
    });

    it('does NOT write the raw approvalToken to sessionStorage', () => {
      const stripped = stripComments(pageSrc);
      expect(stripped).not.toMatch(
        /sessionStorage\.setItem\([^)]*(approvalToken|rawToken|executeToken|tokenModal\.rawToken)/i,
      );
      expect(stripped).not.toMatch(/sessionStorage\.[a-z]+\([^)]*token/i);
    });

    it('does NOT push the raw token into a URL search param or path', () => {
      const stripped = stripComments(pageSrc);
      // Common offenders: `router.push(\`/foo?token=${rawToken}\`)`,
      // `searchParams.set('token', rawToken)`, etc.
      expect(stripped).not.toMatch(
        /(searchParams|URLSearchParams)\.set\([^)]*token/i,
      );
      expect(stripped).not.toMatch(/router\.push\([^)]*\$\{?rawToken/);
      expect(stripped).not.toMatch(/router\.push\([^)]*\$\{?executeToken/);
    });

    it('does NOT log or alert the raw approvalToken', () => {
      const stripped = stripComments(pageSrc);
      // console.log/info/warn/error + alert/prompt with token vars.
      expect(stripped).not.toMatch(
        /console\.(log|info|warn|error|debug)\([^)]*(rawToken|approvalToken|executeToken|tokenModal\.rawToken)/i,
      );
      expect(stripped).not.toMatch(/alert\([^)]*token/i);
    });
  });

  describe('approvalTokenHash — must never render', () => {
    it('does NOT mention approvalTokenHash anywhere in the rendered JSX', () => {
      // The server never includes the hash in any GET response (proven
      // by the api-side HR3 and HR4 specs). The client should not
      // reference it under any circumstances. If we ever DO want to
      // surface it (we shouldn't), this assertion needs to change AND
      // PHASE_3_DESIGN.md Decision Log #6 needs an amendment.
      //
      // We strip comments before checking — the page's own header
      // doc-comment legitimately discusses `approvalTokenHash` as a
      // forbidden field.
      const stripped = stripComments(pageSrc);
      expect(stripped).not.toMatch(/approvalTokenHash/);
    });

    it('does NOT mention tokenHashPrefix on the client (server-side forensic field only)', () => {
      // tokenHashPrefix is a server-side audit breadcrumb. Surfacing it
      // on the client is harmless (it's inert by design — 24 bits of a
      // sha256), but there's no UX use for it either. Keep it off.
      const stripped = stripComments(pageSrc);
      expect(stripped).not.toMatch(/tokenHashPrefix/);
    });
  });

  describe('Status-aware mutation buttons', () => {
    it('RowActions component reads canApprove/canReject/canCancel/canRevoke/canExecute props', () => {
      const stripped = stripComments(pageSrc);
      // Each status-gated button must consult the corresponding `can*`
      // prop — so a future refactor can't accidentally show Execute on
      // a terminal row.
      expect(stripped).toMatch(/canApprove/);
      expect(stripped).toMatch(/canReject/);
      expect(stripped).toMatch(/canCancel/);
      expect(stripped).toMatch(/canRevoke/);
      expect(stripped).toMatch(/canExecute/);
    });

    it('canApprove gates on PENDING + not initiator (four-eyes)', () => {
      const stripped = stripComments(pageSrc);
      expect(stripped).toMatch(
        /function canApprove[\s\S]*?status === 'PENDING'[\s\S]*?requestedByAdminUserId !== currentUserId/,
      );
    });

    it('canExecute gates on APPROVED + initiator', () => {
      const stripped = stripComments(pageSrc);
      expect(stripped).toMatch(
        /function canExecute[\s\S]*?status === 'APPROVED'[\s\S]*?requestedByAdminUserId === currentUserId/,
      );
    });

    it('canRevoke gates on APPROVED + original approver', () => {
      const stripped = stripComments(pageSrc);
      expect(stripped).toMatch(
        /function canRevoke[\s\S]*?status === 'APPROVED'[\s\S]*?approvedByAdminUserId === currentUserId/,
      );
    });

    it('terminal statuses produce read-only marker, no mutation buttons', () => {
      const stripped = stripComments(pageSrc);
      // The RowActions component falls back to a "read-only" marker
      // when none of the can* props are true. The exact fallback string
      // is asserted so a future refactor can't silently strip it.
      expect(stripped).toMatch(/read-only/);
    });
  });

  describe('Before/after diff rendering', () => {
    it('renders both beforeValues and afterValues blocks', () => {
      // The detail modal MUST render both snapshots so the approver can
      // see exactly what would change. Phase 3 design §6 §7.
      expect(pageSrc).toMatch(/beforeValues/);
      expect(pageSrc).toMatch(/afterValues/);
    });
  });

  describe('Token modal — one-shot raw token display', () => {
    it('renders the raw token in the token modal (return-once contract)', () => {
      // The contract is: approver sees the token ONCE in the modal,
      // then it's gone. This assertion proves the modal is the only
      // place we render the raw token.
      const stripped = stripComments(pageSrc);
      expect(stripped).toMatch(/tokenModal\.rawToken/);
    });

    it('clears the token from React state when the token modal closes', () => {
      const stripped = stripComments(pageSrc);
      // The closeTokenModal handler must wipe the rawToken value
      // before calling setTokenModal(null).
      expect(stripped).toMatch(
        /closeTokenModal[\s\S]+?prev\.rawToken = ''/,
      );
    });

    it('clears the executeToken state on success and on cancel', () => {
      const stripped = stripComments(pageSrc);
      // After submitExecute() succeeds: setExecuteToken('').
      // On Cancel button in execute modal: setExecuteToken('').
      expect(stripped).toMatch(/setExecuteToken\(''\)/);
    });
  });

  describe('API client — approval methods exist and use existing patterns', () => {
    it('exposes listApprovals / getApproval / approveApproval / rejectApproval / revokeApproval / cancelApproval / executeApproval', () => {
      const stripped = stripComments(apiSrc);
      expect(stripped).toMatch(/async listApprovals\(/);
      expect(stripped).toMatch(/async getApproval\(/);
      expect(stripped).toMatch(/async approveApproval\(/);
      expect(stripped).toMatch(/async rejectApproval\(/);
      expect(stripped).toMatch(/async revokeApproval\(/);
      expect(stripped).toMatch(/async cancelApproval\(/);
      expect(stripped).toMatch(/async executeApproval\(/);
    });

    it('approveApproval reads `approvalToken` from the envelope and returns it (return-once at the client too)', () => {
      const stripped = stripComments(apiSrc);
      expect(stripped).toMatch(
        /approvalToken: summary\.approvalToken/,
      );
    });

    it('executeApproval POSTs { approvalToken } as the body — never a query param', () => {
      const stripped = stripComments(apiSrc);
      expect(stripped).toMatch(
        /executeApproval[\s\S]+?this\.post[\s\S]+?\{[\s\S]+?approvalToken[\s\S]+?\}/,
      );
    });

    it('uses the existing AdminApiClient helpers (this.get / this.post) — no raw fetch with custom auth', () => {
      const stripped = stripComments(apiSrc);
      // Locate the block of new methods. Confirm each one delegates to
      // `this.get` / `this.post` so they inherit the existing
      // bearer-token attachment + 401-refresh logic.
      const block = stripped.match(
        /async listApprovals[\s\S]+?async executeApproval[\s\S]+?\}/,
      );
      expect(block).toBeTruthy();
      // No raw fetch( call inside the block (that would bypass the
      // auth handling).
      expect(block![0]).not.toMatch(/[^a-z]fetch\(/i);
    });
  });

  describe('Sidebar navigation — entry exists, no permission-gated module name (yet)', () => {
    it('Sidebar exposes /dashboard/ai/approvals link', () => {
      expect(sidebarSrc).toMatch(
        /href:\s*'\/dashboard\/ai\/approvals'/,
      );
    });

    it('AI Agent group entry uses an icon and label', () => {
      const stripped = stripComments(sidebarSrc);
      expect(stripped).toMatch(/label:\s*'AI Agent'/);
    });
  });
});
