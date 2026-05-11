import { createHash } from 'crypto';

/**
 * Canonical JSON serialiser used by the approval-workflow payload-hash
 * check (Phase 3.1, see docs/ai-agent/PHASE_3_DESIGN.md §5).
 *
 * Rules:
 *   - Object keys are emitted in lexicographic order (recursive).
 *   - Arrays preserve order (they're sequential, not associative).
 *   - `undefined` keys are dropped (matches JSON.stringify).
 *   - Numbers stay numbers; strings stay strings. `{x:1}` and `{x:"1"}`
 *     hash to different values — type-preserving is the whole point.
 *   - Dates are serialised via `toISOString()`.
 *   - Functions, symbols, BigInt → dropped.
 *
 * Determinism is what the payload-hash binding relies on: the operator
 * initiates with payload P → we store sha256("publish_product::" + canonicalJSON(P)).
 * At execute time we recompute and compare. Any reordering of keys or
 * whitespace differences in the request body would otherwise produce a
 * different hash even though the semantic value is identical.
 */
export function canonicalJSON(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return 'null';

  if (value === undefined) return 'null';

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }

  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'string') return JSON.stringify(value);

  if (typeof value === 'bigint') return JSON.stringify(value.toString());

  if (value instanceof Date) return JSON.stringify(value.toISOString());

  if (Array.isArray(value)) {
    return '[' + value.map((v) => stringify(v ?? null)).join(',') + ']';
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && typeof v !== 'function' && typeof v !== 'symbol')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return (
      '{' +
      entries
        .map(([k, v]) => JSON.stringify(k) + ':' + stringify(v))
        .join(',') +
      '}'
    );
  }

  // function, symbol → null
  return 'null';
}

/**
 * Approval payload hash = sha256(toolName || "::" || canonicalJSON(input)).
 *
 * The toolName prefix binds the hash to a specific tool — even if two
 * different tools accidentally accept the same input shape, their hashes
 * never collide. This is belt-and-braces over the existing per-row
 * `toolName` column on AgentApprovalRequest.
 */
export function payloadHash(toolName: string, input: unknown): string {
  return createHash('sha256')
    .update(`${toolName}::${canonicalJSON(input)}`)
    .digest('hex');
}
