import { Injectable } from '@nestjs/common';

/**
 * AiSanitizerService strips sensitive fields and bounds payload size before
 * the audit service writes input/output to the database.
 *
 * Rules (kept intentionally simple — match by key name regardless of nesting):
 *   - Drop keys whose name (case-insensitive, ignoring underscores/hyphens)
 *     matches any of: password, passwordHash, passwordResetToken, secret,
 *     apiKey, clientSecret, webhookSecret, authorization, bearer, accessToken,
 *     refreshToken, token (when not "approvalToken"), creditCard, cardNumber,
 *     cvv, ccv, cardCvc, pin.
 *   - Truncate any string value > 4096 chars with a "(truncated)" suffix.
 *   - Truncate arrays > 200 items.
 *   - If the whole serialised payload exceeds 64KB, replace with a summary.
 *
 * The sanitiser never throws — failure to sanitise must not break the
 * tool call. On unexpected error we substitute `{ sanitiserError: true }`
 * so the audit row still records something useful.
 */
@Injectable()
export class AiSanitizerService {
  // Keys that are safe AI-agent control fields and must NOT be redacted
  // even though they look secret-like. `approvalToken` is the canonical
  // example: it's already consumed by the time it reaches the audit log
  // and we want to know which token was used for forensics.
  private static readonly ALLOWLIST = new Set(['approvaltoken']);

  // Match anywhere in the key (post-normalisation). The `^token$` pattern
  // catches a generic "token" key while leaving "approvalToken" alone via
  // the allowlist above.
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

        if (AiSanitizerService.ALLOWLIST.has(normalised)) {
          out[rawKey] = this.walk(raw, depth + 1);
          continue;
        }

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
