import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { UploadService } from './upload.service';
import { detectIdDocType, detectModelType } from './file-signature.util';
import {
  parseIdDocKey,
  resolvePrivateRoot,
  idDocAbsolutePath,
} from './private-storage.util';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const GLB = Buffer.concat([Buffer.from('glTF', 'ascii'), Buffer.from([2, 0, 0, 0, 20, 0, 0, 0]), Buffer.alloc(8)]);
const GLTF = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scenes: [] }));
const HTML = Buffer.from('<html><script>alert(document.cookie)</script></html>');
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj<<>>endobj\n');

describe('file signature sniffing', () => {
  it('detects 3D models by bytes, not by claimed type', () => {
    expect(detectModelType(GLB)).toBe('glb');
    expect(detectModelType(GLTF)).toBe('gltf');
    expect(detectModelType(HTML)).toBeNull();
    expect(detectModelType(Buffer.from(JSON.stringify({ notAsset: 1 })))).toBeNull();
  });

  it('detects ID document types by magic bytes', () => {
    expect(detectIdDocType(PNG_1x1)).toBe('png');
    expect(detectIdDocType(PDF)).toBe('pdf');
    expect(detectIdDocType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('jpg');
    expect(detectIdDocType(HTML)).toBeNull();
  });
});

describe('3D model upload', () => {
  const svc = new UploadService();

  it('rejects an HTML file renamed .glb', async () => {
    await expect(
      svc.uploadModel({ originalname: 'x.glb', buffer: HTML, mimetype: 'application/octet-stream' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a real GLB with a non-model extension (no attacker-chosen stored ext)', async () => {
    await expect(
      svc.uploadModel({ originalname: 'x.html', buffer: GLB, mimetype: 'application/octet-stream' }),
    ).rejects.toThrow(/glb and \.gltf/i);
  });

  it('rejects a GLTF JSON claimed as .glb (type/extension mismatch)', async () => {
    await expect(
      svc.uploadModel({ originalname: 'x.glb', buffer: GLTF, mimetype: 'model/gltf-binary' }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('private ID-document storage', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naro-private-'));
  const prev = process.env.PRIVATE_UPLOAD_DIR;
  beforeAll(() => {
    process.env.PRIVATE_UPLOAD_DIR = tmp;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.PRIVATE_UPLOAD_DIR;
    else process.env.PRIVATE_UPLOAD_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('stores the real file privately and returns an opaque private:// ref (no client filename)', async () => {
    const svc = new UploadService();
    const out = await svc.uploadIdDocument(
      { originalname: 'John_Doe_NIDA_19900101.png', buffer: PNG_1x1, mimetype: 'image/png' },
      'front',
      'tenantA',
    );
    expect(out.url).toMatch(/^private:\/\/id-documents\/tenantA\/[a-f0-9]{32}\.png$/);
    expect(out.url).not.toContain('John_Doe');
    const parsed = parseIdDocKey(out.url)!;
    const onDisk = path.join(tmp, 'id-documents', 'tenantA', parsed.fileName);
    expect(fs.readFileSync(onDisk).equals(PNG_1x1)).toBe(true);

    // Same tenant can resolve it; another tenant gets null (→ 404).
    expect(await svc.resolveIdDocument(out.url, 'tenantA', false)).not.toBeNull();
    expect(await svc.resolveIdDocument(out.url, 'tenantB', false)).toBeNull();
    // Platform admin may read any tenant.
    expect(await svc.resolveIdDocument(out.url, null, true)).not.toBeNull();
  });

  it('rejects non-image/PDF payloads even when the claimed mimetype is image/png', async () => {
    const svc = new UploadService();
    await expect(
      svc.uploadIdDocument({ originalname: 'a.png', buffer: HTML, mimetype: 'image/png' }, 'front', 'tenantA'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects files over 8MB', async () => {
    const svc = new UploadService();
    const big = Buffer.concat([PDF, Buffer.alloc(8 * 1024 * 1024)]);
    await expect(
      svc.uploadIdDocument({ buffer: big, mimetype: 'application/pdf' }, 'front', 'tenantA'),
    ).rejects.toThrow(/8MB/);
  });

  it('key parsing blocks path traversal and malformed keys', () => {
    expect(parseIdDocKey('../../etc/passwd')).toBeNull();
    expect(parseIdDocKey('tenantA/../../secret.png')).toBeNull();
    expect(parseIdDocKey('tenantA/abc.png')).toBeNull(); // not 32-hex
    expect(parseIdDocKey('tenantA/' + 'a'.repeat(32) + '.exe')).toBeNull();
    expect(parseIdDocKey('ten ant/' + 'a'.repeat(32) + '.png')).toBeNull();
    expect(parseIdDocKey('tenantA/' + 'a'.repeat(32) + '.png')).toEqual({
      tenantId: 'tenantA',
      fileName: 'a'.repeat(32) + '.png',
    });
    expect(idDocAbsolutePath(tmp, '..', 'a'.repeat(32) + '.png')).toBeNull();
  });

  it('never resolves the private root inside the publicly served uploads dir', () => {
    const cwd = path.join(os.tmpdir(), 'naro-cwd');
    expect(resolvePrivateRoot({ PRIVATE_UPLOAD_DIR: 'uploads/private' } as any, cwd)).toBe(
      path.resolve(cwd, 'private-uploads'),
    );
    expect(resolvePrivateRoot({} as any, cwd)).toBe(path.resolve(cwd, 'private-uploads'));
  });
});

describe('upload controller wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, 'upload.controller.ts'), 'utf8');

  it('every FileInterceptor sets a multer fileSize limit', () => {
    const interceptors = src.match(/FileInterceptor\('file'[^)]*\)?/g) || [];
    expect(interceptors.length).toBeGreaterThan(0);
    const bare = src.match(/FileInterceptor\('file'\)/g) || [];
    expect(bare).toHaveLength(0);
  });

  it('the ID-document streaming route is admin-guarded', () => {
    expect(src).toMatch(/@Get\('id-document\/:tenantScopedKey'\)\s*\n\s*@UseGuards\(AdminGuard\)/);
  });
});
