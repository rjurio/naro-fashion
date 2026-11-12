import { IsDateString, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Staff extend an unconfirmed booking's deadline (rentals:update-status). */
export class ExtendRentalHoldDto {
  /** New deadline (ISO). Must be in the future, within 7 days, and not after the end of the pickup day. */
  @IsDateString()
  until!: string;

  /** Why (audited). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note!: string;
}
