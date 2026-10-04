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
