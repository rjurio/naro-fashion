import { AiSanitizerService } from './ai-sanitizer.service';

describe('AiSanitizerService', () => {
  let sanitizer: AiSanitizerService;

  beforeEach(() => {
    sanitizer = new AiSanitizerService();
  });

  describe('sensitive key redaction', () => {
    it('redacts password fields', () => {
      const out = sanitizer.sanitize({
        email: 'a@b.com',
        password: 'hunter2',
        passwordHash: 'argon2id$...',
        passwordResetToken: 'r3set',
      }) as any;
      expect(out.email).toBe('a@b.com');
      expect(out.password).toBe('[REDACTED]');
      expect(out.passwordHash).toBe('[REDACTED]');
      expect(out.passwordResetToken).toBe('[REDACTED]');
    });

    it('redacts auth-related fields case-insensitively', () => {
      const out = sanitizer.sanitize({
        Authorization: 'Bearer abc',
        ACCESS_TOKEN: 'xyz',
        Refresh_Token: 'xyz',
        APIKey: 'k1',
        clientSecret: 's1',
      }) as any;
      expect(out.Authorization).toBe('[REDACTED]');
      expect(out.ACCESS_TOKEN).toBe('[REDACTED]');
      expect(out.Refresh_Token).toBe('[REDACTED]');
      expect(out.APIKey).toBe('[REDACTED]');
      expect(out.clientSecret).toBe('[REDACTED]');
    });

    it('redacts payment-card fields', () => {
      const out = sanitizer.sanitize({
        cardNumber: '4242424242424242',
        cvv: '123',
        cardCvc: '321',
        pin: '0000',
      }) as any;
      expect(out.cardNumber).toBe('[REDACTED]');
      expect(out.cvv).toBe('[REDACTED]');
      expect(out.cardCvc).toBe('[REDACTED]');
      expect(out.pin).toBe('[REDACTED]');
    });

    it('preserves approvalToken (allow-listed)', () => {
      const out = sanitizer.sanitize({
        approvalToken: 'appr_abc123',
        accessToken: 'leaked',
      }) as any;
      expect(out.approvalToken).toBe('appr_abc123');
      expect(out.accessToken).toBe('[REDACTED]');
    });

    it('redacts a generic "token" key but not "approvalToken"', () => {
      const out = sanitizer.sanitize({
        token: 'leaked',
        approvalToken: 'safe',
      }) as any;
      expect(out.token).toBe('[REDACTED]');
      expect(out.approvalToken).toBe('safe');
    });

    it('redacts at any nesting level', () => {
      const out = sanitizer.sanitize({
        user: {
          profile: {
            password: 'hunter2',
            name: 'Asha',
          },
        },
      }) as any;
      expect(out.user.profile.password).toBe('[REDACTED]');
      expect(out.user.profile.name).toBe('Asha');
    });

    it('redacts inside arrays', () => {
      const out = sanitizer.sanitize({
        users: [
          { id: 1, password: 'p1' },
          { id: 2, password: 'p2' },
        ],
      }) as any;
      expect(out.users[0].password).toBe('[REDACTED]');
      expect(out.users[1].password).toBe('[REDACTED]');
      expect(out.users[0].id).toBe(1);
    });
  });

  describe('size bounds', () => {
    it('truncates long strings', () => {
      const huge = 'x'.repeat(5000);
      const out = sanitizer.sanitize({ note: huge }) as any;
      expect(out.note.length).toBeLessThan(5000);
      expect(out.note.endsWith('… (truncated)')).toBe(true);
    });

    it('truncates long arrays with marker', () => {
      const big = Array.from({ length: 250 }, (_, i) => i);
      const out = sanitizer.sanitize({ items: big }) as any;
      expect(out.items.length).toBe(201); // 200 + truncation marker
      expect(out.items[200]).toContain('truncated');
    });

    it('summarises payloads larger than 64KB', () => {
      const huge = { data: 'x'.repeat(70 * 1024) };
      // The string itself is also truncated to 4096 first; build a payload
      // that survives string truncation but exceeds the JSON-payload cap
      // by virtue of having many keys.
      const wide: any = {};
      for (let i = 0; i < 5000; i++) wide['key' + i] = 'v'.repeat(50);
      const out = sanitizer.sanitize(wide) as any;
      expect(out.truncated).toBe(true);
      expect(typeof out.originalSize).toBe('number');
      expect(typeof out.sample).toBe('string');
    });
  });

  describe('weird inputs', () => {
    it('handles null and undefined', () => {
      expect(sanitizer.sanitize(null)).toBeNull();
      expect(sanitizer.sanitize(undefined)).toBeUndefined();
    });

    it('handles primitives', () => {
      expect(sanitizer.sanitize(42)).toBe(42);
      expect(sanitizer.sanitize('hello')).toBe('hello');
      expect(sanitizer.sanitize(true)).toBe(true);
    });

    it('serialises Date to ISO string', () => {
      const d = new Date('2026-05-10T11:30:00.000Z');
      expect(sanitizer.sanitize(d)).toBe(d.toISOString());
    });

    it('replaces Buffer with byte-length placeholder', () => {
      const buf = Buffer.from('hello');
      const out = sanitizer.sanitize({ blob: buf }) as any;
      expect(out.blob).toBe('[binary 5 bytes]');
    });

    it('drops symbols and functions', () => {
      const out = sanitizer.sanitize({
        valid: 1,
        fn: () => 'x',
        sym: Symbol('x'),
      }) as any;
      expect(out.valid).toBe(1);
      expect(out.fn).toBeUndefined();
      expect(out.sym).toBeUndefined();
    });

    it('caps deeply nested objects', () => {
      let obj: any = { value: 'deep' };
      for (let i = 0; i < 25; i++) obj = { next: obj };
      const out = sanitizer.sanitize(obj);
      // Should produce a value, not throw — depth guard kicks in at 16.
      expect(out).toBeDefined();
    });
  });
});
