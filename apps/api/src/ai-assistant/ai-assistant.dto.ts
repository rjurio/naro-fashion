import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const AI_CHAT_MAX_MESSAGES = 30;
export const AI_CHAT_MAX_CONTENT_CHARS = 8000;
export const AI_CHAT_MAX_TOTAL_CHARS = 60_000;

/**
 * One chat turn from the admin UI. `role` is restricted to user|assistant —
 * the client can NEVER inject a `system` turn (the system prompt is set
 * server-side only), and `content` must be a plain string, so the client
 * also can't smuggle forged `tool_use` / `tool_result` blocks into history.
 */
export class ChatMessageDto {
  @IsString()
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(AI_CHAT_MAX_CONTENT_CHARS)
  content!: string;
}

export class ChatRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AI_CHAT_MAX_MESSAGES)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}

/** Returns an error message when the combined history is too large, else null. */
export function validateChatTotalSize(messages: Array<{ content: string }>): string | null {
  const total = messages.reduce((sum, m) => sum + (m?.content?.length ?? 0), 0);
  if (total > AI_CHAT_MAX_TOTAL_CHARS) {
    return `Conversation too long (${total} chars, max ${AI_CHAT_MAX_TOTAL_CHARS}). Start a new chat.`;
  }
  return null;
}
