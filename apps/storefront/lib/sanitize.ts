/**
 * Render-side HTML sanitizer (defense in depth).
 *
 * Admin rich text is already sanitized on WRITE by the API
 * (`apps/api/src/common/sanitize-html.util.ts`). This second pass protects the
 * storefront if a row predates that, was written by another path, or the API
 * sanitizer regresses. Dependency-free: uses the browser's inert DOMParser
 * (parsing with DOMParser never executes scripts or loads resources).
 *
 * The CMS/product HTML on the storefront is fetched client-side, so this runs
 * in the browser. On the server (no DOMParser) it falls back to escaping the
 * whole string as text — never to passing raw HTML through.
 */

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's',
  'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'u', 'ul', 'mark', 'del', 'ins', 'caption', 'colgroup', 'col',
]);

// Removed together with their content.
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'form',
  'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'svg', 'math',
  'frame', 'frameset', 'applet', 'audio', 'video', 'source', 'track', 'canvas',
]);

const GLOBAL_ATTRS = new Set(['class', 'style', 'title', 'dir', 'lang']);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colspan', 'rowspan', 'align']),
  th: new Set(['colspan', 'rowspan', 'align', 'scope']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  ol: new Set(['start', 'type']),
};

// Leading `//`, `/\`, `\` = protocol-relative to another host → rejected.
const SAFE_HREF = /^(?![\/\\][\/\\])(?!\\)(?:https?:|mailto:|tel:|#|\/|[^:]*$)/i;
const SAFE_IMG_SRC = /^(?![\/\\][\/\\])(?:https?:|\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;
const UNSAFE_CSS = /(?:url\s*\(|expression\s*\(|javascript:|behavior\s*:|-moz-binding|@import)/i;

function cleanUrl(value: string): string {
  // Strip whitespace/control chars browsers ignore inside schemes (`java\tscript:`).
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000- \u007F]+/g, '');
}

function sanitizeNode(node: Element, doc: Document) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 8 /* comment */) {
      child.remove();
      continue;
    }
    if (child.nodeType !== 1 /* element */) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (DROP_WITH_CONTENT.has(tag)) {
      el.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: keep (sanitized) children, drop the element itself.
      sanitizeNode(el, doc);
      const frag = doc.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      el.replaceWith(frag);
      continue;
    }

    const allowed = TAG_ATTRS[tag];
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!GLOBAL_ATTRS.has(name) && !allowed?.has(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style' && UNSAFE_CSS.test(attr.value)) el.removeAttribute(attr.name);
      if (name === 'href' && !SAFE_HREF.test(cleanUrl(attr.value))) el.removeAttribute(attr.name);
      if (name === 'src' && !SAFE_IMG_SRC.test(cleanUrl(attr.value))) el.removeAttribute(attr.name);
    }

    if (tag === 'a') {
      if (el.getAttribute('target')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer nofollow');
      } else {
        el.removeAttribute('rel');
      }
    }
    if (tag === 'img' && !el.getAttribute('src')) {
      el.remove();
      continue;
    }

    sanitizeNode(el, doc);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return escapeHtml(html);
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  sanitizeNode(doc.body, doc);
  return doc.body.innerHTML;
}

/**
 * Returns the URL only if it is an absolute `https:` URL; otherwise null.
 * Use for user-submitted outbound links (event social links etc.).
 */
export function safeHttpsUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
