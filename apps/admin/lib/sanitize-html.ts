/**
 * Render-side HTML sanitizer — defence in depth for admin-authored rich text
 * (newsletter bodies, CMS pages, size guides) shown via dangerouslySetInnerHTML.
 *
 * The API already sanitizes these fields on write (`sanitizeRichText()` in
 * apps/api/src/common/sanitize-html.util.ts). This guards against legacy rows
 * written before that fix, and against unsaved editor content in previews.
 *
 * Allow-list based, dependency-free: parses with the browser's DOMParser
 * (scripts in a DOMParser document never execute), walks the tree, drops
 * dangerous elements/attributes/URLs, and re-serialises. On the server (no
 * DOMParser) it falls back to escaping everything — these previews are
 * populated client-side, so SSR output is empty in practice.
 */

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup',
  'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'iframe', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'small', 'span',
  'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);

/** Removed together with their content (everything else unknown is unwrapped). */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'noscript', 'template', 'object', 'embed', 'applet', 'link', 'meta', 'base',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'svg', 'math', 'frame', 'frameset', 'title', 'head',
]);

const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'width', 'height', 'style', 'class', 'target', 'rel', 'colspan', 'rowspan',
  'align', 'valign', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'color', 'face', 'size', 'dir',
  'lang', 'start', 'type', 'frameborder', 'allowfullscreen', 'data-list', 'data-row', 'data-checked',
]);

const URL_ATTRS = new Set(['href', 'src']);

/** Hosts allowed as <iframe src> (Quill video embeds). */
const IFRAME_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com']);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeUrl(raw: string, attr: string, tag: string): boolean {
  // Browsers ignore control chars / whitespace inside the scheme.
  // eslint-disable-next-line no-control-regex
  const v = raw.replace(/[\u0000- \u007F]+/g, '').toLowerCase();
  if (!v) return false;
  if (tag === 'iframe') {
    try {
      const u = new URL(raw, 'https://invalid.local');
      return u.protocol === 'https:' && IFRAME_HOSTS.has(u.hostname);
    } catch {
      return false;
    }
  }
  if (v.startsWith('#') || v.startsWith('/') || v.startsWith('./') || v.startsWith('../')) return true;
  if (attr === 'src' && /^data:image\/(png|jpe?g|gif|webp);/.test(v)) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(v);
  if (!scheme) return true; // relative path like "image.jpg"
  return ['http', 'https', 'mailto', 'tel'].includes(scheme[1]);
}

function isSafeStyle(v: string): boolean {
  const s = v.toLowerCase();
  return !/(expression\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding)/.test(s);
}

function cleanNode(node: Node, doc: Document): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === 8 /* COMMENT */) {
      child.parentNode?.removeChild(child);
      continue;
    }
    if (child.nodeType !== 1 /* ELEMENT */) continue;

    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (DROP_WITH_CONTENT.has(tag)) {
      el.parentNode?.removeChild(el);
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: keep (cleaned) children, drop the element itself.
      cleanNode(el, doc);
      const frag = doc.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      el.parentNode?.replaceChild(frag, el);
      continue;
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on') || !ALLOWED_ATTRS.has(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRS.has(name) && !isSafeUrl(value, name, tag)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style' && !isSafeStyle(value)) {
        el.removeAttribute(attr.name);
      }
    }

    if (tag === 'iframe' && !el.getAttribute('src')) {
      el.parentNode?.removeChild(el);
      continue;
    }
    if (tag === 'a' && el.getAttribute('target') === '_blank') {
      el.setAttribute('rel', 'noopener noreferrer');
    }

    cleanNode(el, doc);
  }
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return escapeHtml(html);
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  cleanNode(doc.body, doc);
  return doc.body.innerHTML;
}
