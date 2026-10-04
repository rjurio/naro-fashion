import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsStrongPassword } from './password-policy';

/**
 * Request DTOs for auth endpoints that previously used inline body types
 * (which the global ValidationPipe silently skips — an inline type has no
 * class metadata, so no validation ran and objects like `{ "not": "" }`
 * could reach Prisma).
 */

export class PlatformLoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;
}

export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;

  @IsStrongPassword()
  newPassword: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword: string;

  @IsStrongPassword()
  newPassword: string;
}

export class Toggle2FADto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword: string;
}

/** `POST /auth/2fa/setup` — re-authenticate before generating a new secret. */
export class TwoFASetupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword: string;
}

/** `POST /auth/2fa/enable` — confirm the pending secret with a code from the app. */
export class TwoFAEnableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  code: string;
}

/** `POST /auth/2fa/disable` — needs BOTH the password and a current code. */
export class TwoFADisableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  code: string;
}

/** `POST /auth/2fa/recovery-codes/regenerate` — same proof as disable. */
export class TwoFARegenerateRecoveryDto extends TwoFADisableDto {}

/** `POST /auth/2fa/verify` — second login step (public). `code` = 6-digit TOTP or a recovery code. */
export class TwoFAVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  challengeToken: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  code: string;
}

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

/** Body for `DELETE /users/me` (PDPA erasure). */
export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword: string;
}
