import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * AI-agent input for appending a note to an order. Notes are reversible
 * (admin can edit Order.notes manually), so this is approval-free.
 */
export class AddOrderNoteAiDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note: string;
}
