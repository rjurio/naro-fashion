/**
 * Magic-byte (file signature) sniffing. Client-supplied `mimetype` and
 * `originalname` are attacker-controlled; these helpers decide a file's type
 * from its actual bytes so the stored extension can be forced from the
 * VALIDATED type rather than the claimed one.
 */

export type IdDocType = 'jpg' | 'png' | 'webp' | 'pdf';
export type ModelType = 'glb' | 'gltf';

export const ID_DOC_CONTENT_TYPES: Record<IdDocType, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function asciiAt(buf: Buffer, offset: number, text: string): boolean {
  return startsWith(buf, Array.from(Buffer.from(text, 'ascii')), offset);
}

/** JPEG / PNG / WebP / PDF by signature, else null. */
export function detectIdDocType(buf: Buffer | undefined | null): IdDocType | null {
  if (!buf || buf.length < 12) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (asciiAt(buf, 0, 'RIFF') && asciiAt(buf, 8, 'WEBP')) return 'webp';
  if (asciiAt(buf, 0, '%PDF-')) return 'pdf';
  return null;
}

/** True when the buffer really is a PDF. */
export function isPdf(buf: Buffer | undefined | null): boolean {
  return !!buf && asciiAt(buf, 0, '%PDF-');
}

/**
 * GLB = binary glTF: 12-byte header starting with ASCII magic "glTF".
 * .gltf = JSON document whose top level has an `asset` object (required by
 * the glTF 2.0 spec). Anything else → null.
 */
export function detectModelType(buf: Buffer | undefined | null): ModelType | null {
  if (!buf || buf.length < 12) return null;
  if (asciiAt(buf, 0, 'glTF')) return 'glb';
  try {
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('{')) return null;
    const json = JSON.parse(trimmed);
    if (json && typeof json === 'object' && !Array.isArray(json) &&
        json.asset && typeof json.asset === 'object') {
      return 'gltf';
    }
  } catch {
    // not JSON
  }
  return null;
}

/** Lower-cased extension of a client filename, without the dot ('' if none). */
export function clientExtension(originalname: string | undefined): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(originalname || '');
  return m ? m[1].toLowerCase() : '';
}
