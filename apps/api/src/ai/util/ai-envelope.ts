// Response envelope shared by every /api/v1/ai/* endpoint.
//
// Success responses are returned directly by AiToolRunner.
// Error responses are produced by AiExceptionFilter, which catches
// any exception thrown inside an AI route handler and re-shapes it
// into the same envelope so the client never sees a bare NestJS error.

export interface AiSuccessEnvelope<T> {
  success: true;
  tool: string;
  data: T;
  approvalRequired: false;
  auditId: string;
  message?: string;
}

export interface AiErrorEnvelope {
  success: false;
  tool: string;
  error: {
    code: string;
    message: string;
  };
  approvalRequired: false;
  auditId: string;
}

export type AiEnvelope<T = unknown> = AiSuccessEnvelope<T> | AiErrorEnvelope;

export function buildSuccessEnvelope<T>(args: {
  tool: string;
  data: T;
  auditId: string;
  message?: string;
}): AiSuccessEnvelope<T> {
  return {
    success: true,
    tool: args.tool,
    data: args.data,
    approvalRequired: false,
    auditId: args.auditId,
    ...(args.message ? { message: args.message } : {}),
  };
}

export function buildErrorEnvelope(args: {
  tool: string;
  code: string;
  message: string;
  auditId: string;
}): AiErrorEnvelope {
  return {
    success: false,
    tool: args.tool,
    error: {
      code: args.code,
      message: args.message,
    },
    approvalRequired: false,
    auditId: args.auditId,
  };
}

// Map an HTTP status to a stable, machine-readable code the agent can branch on.
export function mapHttpStatusToErrorCode(status: number): string {
  switch (status) {
    case 400:
      return 'validation_error';
    case 401:
      return 'unauthorized';
    case 403:
      return 'permission_denied';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'server_error' : 'error';
  }
}
