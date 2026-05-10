import { AiAuditService } from './ai-audit.service';
import { AiSanitizerService } from './ai-sanitizer.service';

describe('AiAuditService', () => {
  let prismaMock: any;
  let tenantContextMock: any;
  let request: any;
  let service: AiAuditService;
  const realSanitizer = new AiSanitizerService();

  beforeEach(() => {
    prismaMock = {
      agentAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit_test_1' }),
      },
    };
    tenantContextMock = { id: 'tenant_t1' };
    request = {
      user: { sub: 'admin_u1', isAdmin: true },
      ip: '10.0.0.1',
      headers: {
        'user-agent': 'jest',
        'x-agent-session-id': 'sess_abc',
      },
    };
    service = new AiAuditService(
      request,
      prismaMock,
      tenantContextMock,
      realSanitizer,
    );
  });

  it('writes one row per call and returns the generated id', async () => {
    const id = await service.record({
      tool: 'search_products',
      actionType: 'READ',
      input: { q: 'gown' },
      output: { count: 3 },
      status: 'SUCCESS',
    });
    expect(id).toBe('audit_test_1');
    expect(prismaMock.agentAuditLog.create).toHaveBeenCalledTimes(1);
    const args = prismaMock.agentAuditLog.create.mock.calls[0][0];
    expect(args.data.toolName).toBe('search_products');
    expect(args.data.actionType).toBe('READ');
    expect(args.data.adminUserId).toBe('admin_u1');
    expect(args.data.tenantId).toBe('tenant_t1');
    expect(args.data.sessionId).toBe('sess_abc');
    expect(args.data.ipAddress).toBe('10.0.0.1');
    expect(args.data.userAgent).toBe('jest');
    expect(args.data.status).toBe('SUCCESS');
    expect(args.data.severity).toBe('INFO');
    expect(args.data.approvalRequired).toBe(false);
    expect(args.data.approvalStatus).toBe('NOT_REQUIRED');
  });

  it('sanitises input and output before persisting', async () => {
    await service.record({
      tool: 'search_products',
      actionType: 'READ',
      input: {
        password: 'leak1',
        accessToken: 'leak2',
        approvalToken: 'safe',
      },
      output: {
        items: [{ password: 'leak3', name: 'ok' }],
      },
      status: 'SUCCESS',
    });
    const args = prismaMock.agentAuditLog.create.mock.calls[0][0];
    expect(args.data.inputJson.password).toBe('[REDACTED]');
    expect(args.data.inputJson.accessToken).toBe('[REDACTED]');
    expect(args.data.inputJson.approvalToken).toBe('safe');
    expect(args.data.outputJson.items[0].password).toBe('[REDACTED]');
    expect(args.data.outputJson.items[0].name).toBe('ok');
  });

  it('uses WARNING severity by default for non-SUCCESS status', async () => {
    await service.record({
      tool: 'search_products',
      actionType: 'READ',
      status: 'PERMISSION_DENIED',
      errorMessage: 'Missing ai-agent:use',
    });
    const args = prismaMock.agentAuditLog.create.mock.calls[0][0];
    expect(args.data.severity).toBe('WARNING');
    expect(args.data.errorMessage).toBe('Missing ai-agent:use');
  });

  it('returns empty string when no admin user is on the request', async () => {
    request.user = undefined;
    const id = await service.record({
      tool: 'search_products',
      actionType: 'READ',
      status: 'SUCCESS',
    });
    expect(id).toBe('');
    expect(prismaMock.agentAuditLog.create).not.toHaveBeenCalled();
  });

  it('never throws when Prisma write fails (audit must not break the flow)', async () => {
    prismaMock.agentAuditLog.create.mockRejectedValueOnce(new Error('db down'));
    const id = await service.record({
      tool: 'search_products',
      actionType: 'READ',
      status: 'SUCCESS',
    });
    expect(id).toBe('');
  });

  it('extracts the first IP from x-forwarded-for', async () => {
    request.headers['x-forwarded-for'] = '203.0.113.5, 10.0.0.1';
    await service.record({
      tool: 'search_products',
      actionType: 'READ',
      status: 'SUCCESS',
    });
    const args = prismaMock.agentAuditLog.create.mock.calls[0][0];
    expect(args.data.ipAddress).toBe('203.0.113.5');
  });

  it('caps sessionId at 64 chars', async () => {
    request.headers['x-agent-session-id'] = 'a'.repeat(120);
    await service.record({
      tool: 'search_products',
      actionType: 'READ',
      status: 'SUCCESS',
    });
    const args = prismaMock.agentAuditLog.create.mock.calls[0][0];
    expect(args.data.sessionId.length).toBe(64);
  });
});
