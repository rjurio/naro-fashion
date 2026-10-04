import { IsEmail, IsString, IsOptional, IsIn, MaxLength } from 'class-validator';
import { IsStrongPassword } from '../../auth/dto/password-policy';
import { ADMIN_ROLE_STRINGS } from './create-admin-user.dto';

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  /** Setting a new password revokes the target admin's existing sessions. */
  @IsOptional()
  @IsStrongPassword()
  password?: string;

  /** Only a SUPER_ADMIN / platform admin may set (or remove) SUPER_ADMIN. */
  @IsOptional()
  @IsIn(ADMIN_ROLE_STRINGS as unknown as string[])
  role?: string;
}
