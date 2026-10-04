/**
 * Client-side mirror of the API password policy: 8–128 characters with at
 * least one letter and one digit. The API is the source of truth; this just
 * gives instant feedback.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function isValidPassword(p: string): boolean {
  return (
    typeof p === 'string' &&
    p.length >= PASSWORD_MIN &&
    p.length <= PASSWORD_MAX &&
    /[A-Za-z]/.test(p) &&
    /\d/.test(p)
  );
}
