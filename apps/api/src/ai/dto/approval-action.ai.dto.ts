import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RejectApprovalAiDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class RevokeApprovalAiDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ExecuteApprovalAiDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  approvalToken!: string;
}
