import { IsEmail, IsString, IsOptional, IsIn, IsArray, ArrayMaxSize, MaxLength } from 'class-validator';
import { IsStrongPassword } from '../../auth/dto/password-policy';

export const ADMIN_ROLE_STRINGS = ['SUPER_ADMIN', 'MANAGER', 'STAFF'] as const;

export class CreateAdminUserDto {
  @IsString()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MaxLength(100)
  lastName: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  /** Optional initial password; when omitted a temporary one is generated and returned once. */
  @IsOptional()
  @IsStrongPassword()
  password?: string;

  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  roleIds?: string[];

  @IsOptional()
  @IsIn(ADMIN_ROLE_STRINGS as unknown as string[])
  role?: string; // SUPER_ADMIN | MANAGER | STAFF
}
