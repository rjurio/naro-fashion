import { assertAiUrlSafe } from './ai-assistant.service';

// Regression guards for the path-traversal vector flagged in the May 2026
// security review. Without these, the AI tool runner could be tricked (by
// prompt injection or a buggy `buildUrl`) into calling a non-AI endpoint
// like /api/v1/admin-users with the operator's bearer token.
describe('assertAiUrlSafe', () => {
  const BASE = 'http://localhost:4000/api/v1';

  it('accepts a well-formed AI tool URL', () => {
    const u = assertAiUrlSafe('/ai/products', BASE, 'list_products');
    expect(u.pathname).toBe('/api/v1/ai/products');
  });

  it('accepts AI tool URLs with encoded id path params', () => {
    const id = encodeURIComponent('cm1abc123');
    const u = assertAiUrlSafe(`/ai/products/${id}`, BASE, 'get_product');
    expect(u.pathname).toBe('/api/v1/ai/products/cm1abc123');
  });

  it('rejects paths that traverse outside /ai/ via ../', () => {
    expect(() =>
      assertAiUrlSafe('/ai/../admin-users', BASE, 'malicious'),
    ).toThrow(/blocked non-AI URL/);
  });

  it('rejects paths that traverse outside /ai/ via doubled ../', () => {
    expect(() =>
      assertAiUrlSafe('/ai/products/../../admin-users', BASE, 'malicious'),
    ).toThrow(/blocked non-AI URL/);
  });

  it('rejects absolute URLs to other hosts', () => {
    expect(() =>
      assertAiUrlSafe('http://evil.example.com/ai/products', BASE, 'evil'),
    ).toThrow(/blocked non-AI URL|invalid URL/);
  });

  it('rejects paths that aren\'t under /ai/ at all', () => {
    expect(() =>
      assertAiUrlSafe('/admin-users', BASE, 'wrong_prefix'),
    ).toThrow(/blocked non-AI URL/);
  });

  it('rejects malformed URLs', () => {
    // The `:` in the path makes the joined URL parse to a scheme on its own
    // origin and throws non-AI URL; either error mode is acceptable.
    expect(() =>
      assertAiUrlSafe('not a url at all', BASE, 'broken'),
    ).toThrow();
  });

  it('treats encodeURIComponent-escaped slashes as literal characters', () => {
    // encodeURIComponent('../../admin-users') = '..%2F..%2Fadmin-users'.
    // The URL parser does NOT normalise %2F to /, so the pathname stays
    // inside /ai/products/. This is the defence-in-depth that combines
    // with encodeURIComponent in the tool registry.
    const sneaky = encodeURIComponent('../../admin-users');
    const u = assertAiUrlSafe(`/ai/products/${sneaky}`, BASE, 'get_product');
    expect(u.pathname).toBe('/api/v1/ai/products/..%2F..%2Fadmin-users');
  });
});
