import { IsDateString } from 'class-validator';

export class SyncChangesQueryDto {
  /** ISO timestamp of the device's last successful pull. Required. */
  @IsDateString()
  since!: string;
}
