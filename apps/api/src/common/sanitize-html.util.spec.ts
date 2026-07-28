import { sanitizeRichText } from './sanitize-html.util';

// Locks the write-time XSS guard applied to CMS pages, size guides, and
// newsletter bodies (2026-07-28 review). Admin rich-text is stored sanitized
// so every consumer (storefront + admin, both via dangerouslySetInnerHTML) is
// protected at the source.
describe('sanitizeRichText', () => {
  it('strips <script> tags', () => {
    const out = sanitizeRichText('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toContain('<script');
    expect(out.toLowerCase()).not.toContain('alert(1)');
  });

  it('strips event-handler attributes (onerror/onclick)', () => {
    const out = sanitizeRichText('<img src="x" onerror="fetch(\'//evil\')">');
    expect(out).not.toMatch(/onerror/i);
  });

  it('strips javascript: URLs on links', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('click');
  });

  it('strips data: URLs on images', () => {
    const out = sanitizeRichText('<img src="data:text/html,<script>alert(1)</script>">');
    expect(out).not.toMatch(/data:/i);
  });

  it('strips <svg onload> vectors', () => {
    const out = sanitizeRichText('<svg onload="alert(1)"></svg>');
    expect(out).not.toMatch(/onload/i);
    expect(out).not.toContain('<svg');
  });

  it('keeps normal rich-text formatting intact', () => {
    const input =
      '<h2>Title</h2><p><strong>Bold</strong> and <em>italic</em></p>' +
      '<ul><li>one</li><li>two</li></ul>' +
      '<a href="https://example.com" title="ex">link</a>' +
      '<table><tr><td>cell</td></tr></table>';
    const out = sanitizeRichText(input);
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<strong>Bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('<td>cell</td>');
  });

  it('forces rel=noopener on links', () => {
    const out = sanitizeRichText('<a href="https://example.com">x</a>');
    expect(out).toMatch(/rel="[^"]*noopener/);
  });

  it('handles null/undefined/empty', () => {
    expect(sanitizeRichText(null)).toBe('');
    expect(sanitizeRichText(undefined)).toBe('');
    expect(sanitizeRichText('')).toBe('');
  });
});
