import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Body of POST /cms/instagram/connect — a User token pasted from Graph API Explorer. */
export class ConnectInstagramDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  userAccessToken!: string;
}
