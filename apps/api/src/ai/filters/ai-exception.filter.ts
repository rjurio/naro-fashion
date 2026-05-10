import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import {
  AiErrorEnvelope,
  buildErrorEnvelope,
  mapHttpStatusToErrorCode,
} from '../util/ai-envelope';

/**
 * Catches anything thrown inside an AI route handler and re-shapes it
 * into the AiErrorEnvelope. The HTTP status is preserved (so monitoring,
 * proxies, and the agent runtime see real error codes), the body is the
 * envelope.
 *
 * Apply via @UseFilters(AiExceptionFilter) at the controller-class level
 * on every AI controller. We deliberately do NOT register it globally —
 * only AI endpoints should produce this shape; other routes keep their
 * native NestJS error format.
 */
@Catch()
export class AiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AiExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<any>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Pull the message out of either the HttpException response or the
    // bare error object. NestJS DTO validation errors come back as a
    // string[]; flatten so the agent can show one line.
    let message = 'Internal server error';
    if (exception instanceof HttpException) {
      const responseBody = exception.getResponse();
      if (typeof responseBody === 'string') {
        message = responseBody;
      } else if (responseBody && typeof responseBody === 'object') {
        const m = (responseBody as any).message;
        if (Array.isArray(m)) message = m.join('; ');
        else if (typeof m === 'string') message = m;
      }
    } else if (typeof exception?.message === 'string') {
      message = exception.message;
    }

    const tool: string = exception?.__aiTool ?? this.toolFromPath(req?.path);
    const auditId: string = exception?.__aiAuditId ?? '';

    if (status >= 500) {
      // Log unexpected server errors with stack so we can debug. Don't log
      // 4xx — those are normal client errors and would only spam logs.
      this.logger.error(
        `AI tool ${tool} failed: ${message}`,
        exception?.stack,
      );
    }

    const envelope: AiErrorEnvelope = buildErrorEnvelope({
      tool,
      code: mapHttpStatusToErrorCode(status),
      message: this.boundedMessage(message),
      auditId,
    });

    res.status(status).json(envelope);
  }

  private toolFromPath(path?: string): string {
    if (!path || typeof path !== 'string') return 'unknown';
    // /api/v1/ai/products/search → products/search
    const m = path.match(/\/ai\/(.+?)(?:\?|$)/);
    return m?.[1] ?? 'unknown';
  }

  private boundedMessage(msg: string): string {
    return msg.length > 500 ? msg.slice(0, 500) + '…' : msg;
  }
}
