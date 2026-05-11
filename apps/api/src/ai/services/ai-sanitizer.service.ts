import { Injectable } from '@nestjs/common';

/**
 * AiSanitizerService strips sensitive fields and bounds payload size before
 * the audit service writes input/output to the database.
 *
 * Rules (kept intentionally simple — match by key name regardless of nesting):
 *   - Drop keys whose name (case-insensitive, ignoring underscores/hyphens)
 *     matches any of: password, passwordHash, passwordResetToken, secret,
 *     apiKey, clientSecret, webhookSecret, authorization, bearer, accessToken,
 *     refreshToken, token, approvalToken (Phase 3.1A hardening — 2026-05-11,
 *     was previously allowlisted; the leak surfaced in production smoke and
 *     we now strip the raw value at every layer), creditCard, cardNumber,
 *     cvv, ccv, cardCvc, pin.
 *   - Truncate any string value > 4096 chars with a "(truncated)" suffix.
 *   - Truncate arrays > 200 items.
 *   - If the whole serialised payload exceeds 64KB, replace with a summary.
 *
 * The sanitiser never throws — failure to sanitise must not break the
 * tool call. On unexpected error we substitute `{ sanitiserError: true }`
 * so the audit row still records something useful.
 *
 * **No allowlist**: there are NO key names exempt from redaction. The
 * previous `approvalToken` allowlist (Phase 3.1A initial commit) was
 * removed in the hardening pass after we confirmed leaked tokens in
 * production. Forensic traceability comes from `approvalRequestId` (a
 * stable, non-secret pointer) plus the `tokenProvided` boolean the
 * controllers now log instead of the raw value.
 */
@Injectable()
export class AiSanitizerService {
  // Match anywhere in the key (post-normalisation).
  //
  // `approvaltoken` MUST be redacted: even though the token is single-use
  // and inert by the time the audit row is written, we want defence-in-
  // depth — historical logs are still a leak surface (backups, debug
  // dumps, dev-tool screenshots). Tokens never live in storage anywhere
  // outside the approver's HTTP response.
  private static readonly REDACT_PATTERNS: RegExp[] = [
    /password/,
    /passwordhash/,
    /passwordresettoken/,
    /secret/,
    /apikey/,
    /clientsecret/,
    /webhooksecret/,
    /authorization/,
    /^bearer$/,
    /accesstoken/,
    /refreshtoken/,
    /approvaltoken/, // NEW 2026-05-11 — Phase 3.1A hardening
    /^token$/,
    /creditcard/,
    /cardnumber/,
    /^cvv$/,
    /^ccv$/,
    /cardcvc/,
    /^pin$/,
  ];

  private static readonly MAX_STRING_LENGTH = 4096;
  private static readonly MAX_ARRAY_LENGTH = 200;
  private static readonly MAX_PAYLOAD_BYTES = 64 * 1024;
  private static readonly REDACTED_PLACEHOLDER = '[REDACTED]';

  sanitize(value: unknown): unknown {
    try {
      const cleaned = this.walk(value, 0);

      // Bound the whole payload — prevents an exotic structure from
      // bloating the audit table.
      const serialised = JSON.stringify(cleaned ?? null);
      if (serialised.length > AiSanitizerService.MAX_PAYLOAD_BYTES) {
        return {
          truncated: true,
          originalSize: serialised.length,
          sample: serialised.slice(0, 4096),
        };
      }
      return cleaned;
    } catch {
      return { sanitiserError: true };
    }
  }

  private walk(value: unknown, depth: number): unknown {
    if (depth > 16) return '[max depth]';
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
      return value.length > AiSanitizerService.MAX_STRING_LENGTH
        ? value.slice(0, AiSanitizerService.MAX_STRING_LENGTH) + '… (truncated)'
        : value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      const slice = value.length > AiSanitizerService.MAX_ARRAY_LENGTH
        ? value.slice(0, AiSanitizerService.MAX_ARRAY_LENGTH)
        : value;
      const out = slice.map((item) => this.walk(item, depth + 1));
      if (value.length > AiSanitizerService.MAX_ARRAY_LENGTH) {
        out.push(`… (${value.length - AiSanitizerService.MAX_ARRAY_LENGTH} more items truncated)`);
      }
      return out;
    }

    if (typeof value === 'object') {
      // Handle Date / Decimal / Buffer-like objects by stringifying them so
      // they survive a JSON round-trip. Buffer becomes its byteLength only.
      if (value instanceof Date) return value.toISOString();
      if (Buffer.isBuffer(value)) return `[binary ${value.byteLength} bytes]`;

      const out: Record<string, unknown> = {};
      for (const [rawKey, raw] of Object.entries(value as Record<string, unknown>)) {
        const normalised = rawKey.toLowerCase().replace(/[_\-\s]/g, '');

        if (this.shouldRedact(normalised)) {
          out[rawKey] = AiSanitizerService.REDACTED_PLACEHOLDER;
          continue;
        }

        out[rawKey] = this.walk(raw, depth + 1);
      }
      return out;
    }

    // Symbols, functions, BigInt, etc — drop them.
    return undefined;
  }

  private shouldRedact(normalisedKey: string): boolean {
    return AiSanitizerService.REDACT_PATTERNS.some((re) => re.test(normalisedKey));
  }
}
