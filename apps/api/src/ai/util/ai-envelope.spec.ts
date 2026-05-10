import {
  buildSuccessEnvelope,
  buildErrorEnvelope,
  mapHttpStatusToErrorCode,
} from './ai-envelope';

describe('ai-envelope', () => {
  describe('buildSuccessEnvelope', () => {
    it('produces the canonical success shape', () => {
      const env = buildSuccessEnvelope({
        tool: 'search_products',
        data: { count: 3 },
        auditId: 'audit_abc',
      });
      expect(env).toEqual({
        success: true,
        tool: 'search_products',
        data: { count: 3 },
        approvalRequired: false,
        auditId: 'audit_abc',
      });
    });

    it('includes message when provided', () => {
      const env = buildSuccessEnvelope({
        tool: 'search_products',
        data: { count: 0 },
        auditId: 'audit_abc',
        message: 'Found 0 products.',
      });
      expect(env.message).toBe('Found 0 products.');
    });

    it('omits message when undefined', () => {
      const env = buildSuccessEnvelope({
        tool: 'search_products',
        data: {},
        auditId: 'audit_abc',
      });
      expect('message' in env).toBe(false);
    });

    it('always sets approvalRequired:false in Phase 1', () => {
      const env = buildSuccessEnvelope({
        tool: 'x',
        data: {},
        auditId: 'a',
      });
      expect(env.approvalRequired).toBe(false);
    });
  });

  describe('buildErrorEnvelope', () => {
    it('produces the canonical error shape', () => {
      const env = buildErrorEnvelope({
        tool: 'search_products',
        code: 'permission_denied',
        message: 'Missing permission: ai-agent:use',
        auditId: 'audit_xyz',
      });
      expect(env).toEqual({
        success: false,
        tool: 'search_products',
        error: {
          code: 'permission_denied',
          message: 'Missing permission: ai-agent:use',
        },
        approvalRequired: false,
        auditId: 'audit_xyz',
      });
    });
  });

  describe('mapHttpStatusToErrorCode', () => {
    it.each([
      [400, 'validation_error'],
      [401, 'unauthorized'],
      [403, 'permission_denied'],
      [404, 'not_found'],
      [409, 'conflict'],
      [422, 'unprocessable'],
      [429, 'rate_limited'],
      [500, 'server_error'],
      [502, 'server_error'],
      [418, 'error'], // unknown 4xx
    ])('maps %i to %s', (status, expected) => {
      expect(mapHttpStatusToErrorCode(status)).toBe(expected);
    });
  });
});
