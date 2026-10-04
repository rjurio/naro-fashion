/**
 * Client-side mirror of the API's admin password policy:
 * 8–128 characters, at least one letter and at least one digit.
 * The API is authoritative; this just gives instant feedback.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters, including a letter and a number.`;

/** Returns an error message, or null when the password satisfies the policy. */
export function validatePassword(pw: string): string | null {
  if (!pw || pw.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (pw.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(pw)) return 'Password must contain at least one letter.';
  if (!/\d/.test(pw)) return 'Password must contain at least one number.';
  return null;
}
