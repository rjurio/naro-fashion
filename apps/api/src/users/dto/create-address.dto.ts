import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class CreateAddressDto {
  @IsString()
  @MaxLength(200)
  street: string;

  @IsString()
  @MaxLength(100)
  city: string;

  @IsString()
  @MaxLength(100)
  state: string;

  @IsString()
  @MaxLength(20)
  zipCode: string;

  @IsString()
  @MaxLength(100)
  country: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
