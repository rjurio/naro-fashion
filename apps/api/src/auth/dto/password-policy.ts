import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Single source of truth for the password policy applied to every
 * password-setting endpoint (register, reset-password, change-password,
 * admin-user create/update). Minimum 8 chars, at least one letter and one
 * digit, capped at 128 so bcrypt (72-byte limit) inputs stay sane.
 *
 * Keep this in sync with any client-side hint text.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and contain at least one letter and one digit';

export function IsStrongPassword() {
  return applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_POLICY_MESSAGE }),
    MaxLength(PASSWORD_MAX_LENGTH),
    Matches(/[A-Za-z]/, { message: PASSWORD_POLICY_MESSAGE }),
    Matches(/\d/, { message: PASSWORD_POLICY_MESSAGE }),
  );
}
