import { FilterXSS } from 'xss';

/**
 * Server-side sanitizer for admin-authored rich-text HTML (CMS pages, size
 * guides, newsletter bodies). This is the single source of truth — the
 * storefront and admin render these values via dangerouslySetInnerHTML, so
 * sanitizing at write time protects every consumer at once.
 *
 * Uses the `xss` package (pure CommonJS, no ESM subdeps — jest-friendly). The
 * allowlist permits normal rich-text formatting (headings, lists, links,
 * images, tables, basic inline styles) but strips <script>, event-handler
 * attributes (onerror/onclick/...), and dangerous URL schemes
 * (javascript:/data:) — exactly what the RichTextEditor "HTML source" mode
 * could otherwise smuggle in. `xss` strips javascript:/data: from href/src by
 * default and, with stripIgnoreTagBody:['script'], removes script content too.
 */
const filter = new FilterXSS({
  whiteList: {
    h1: ['class', 'style'],
    h2: ['class', 'style'],
    h3: ['class', 'style'],
    h4: ['class', 'style'],
    h5: ['class', 'style'],
    h6: ['class', 'style'],
    p: ['class', 'style'],
    br: [],
    hr: [],
    span: ['class', 'style'],
    div: ['class', 'style'],
    strong: [],
    b: [],
    em: [],
    i: [],
    u: [],
    s: [],
    strike: [],
    sub: [],
    sup: [],
    small: [],
    mark: [],
    blockquote: ['class', 'style'],
    pre: ['class'],
    code: ['class'],
    ul: ['class'],
    ol: ['class'],
    li: ['class'],
    a: ['href', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    table: ['class', 'style'],
    thead: [],
    tbody: [],
    tfoot: [],
    tr: [],
    th: ['colspan', 'rowspan', 'scope', 'style'],
    td: ['colspan', 'rowspan', 'style'],
    caption: [],
    colgroup: [],
    col: ['span'],
    figure: ['class'],
    figcaption: ['class'],
  },
  stripIgnoreTag: true, // drop disallowed tags entirely
  stripIgnoreTagBody: ['script', 'style'], // and remove their contents
  // NOTE: deliberately no onTag override — returning a custom string there
  // would bypass xss's per-attribute safeAttrValue (which strips
  // javascript:/data: from href/src). rel injection happens as a post-process
  // on the already-sanitized output below instead.
});

export function sanitizeRichText(dirty: string | null | undefined): string {
  if (!dirty) return '';
  const clean = filter.process(dirty);
  // Add rel="noopener noreferrer" to any anchor missing rel (reverse-tabnabbing
  // hardening). Safe: operates on already-sanitized HTML.
  return clean.replace(/<a\b(?![^>]*\brel=)/gi, '<a rel="noopener noreferrer"');
}
