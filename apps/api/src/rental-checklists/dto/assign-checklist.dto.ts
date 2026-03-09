import { IsString } from 'class-validator';

export class AssignChecklistDto {
  @IsString()
  rentalOrderId: string;

  @IsString()
  templateId: string;
}
