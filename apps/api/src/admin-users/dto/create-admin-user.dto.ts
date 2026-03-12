import { IsEmail, IsString, IsOptional, MinLength } from 'class-validator';

export class CreateAdminUserDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @IsString()
  role?: string; // SUPER_ADMIN | MANAGER | STAFF
}
