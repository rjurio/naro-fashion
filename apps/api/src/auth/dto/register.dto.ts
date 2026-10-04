import { IsEmail, IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { IsStrongPassword } from './password-policy';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsStrongPassword()
  password: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}
