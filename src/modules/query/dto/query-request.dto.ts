import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import {
  QUERY_QUESTION_MAX_LENGTH,
  QUERY_QUESTION_MIN_LENGTH,
} from '../query-validation.constants';

export class QueryRequestDto {
  @ApiProperty({
    description: 'The question to send to the RAG system',
    minLength: QUERY_QUESTION_MIN_LENGTH,
    maxLength: QUERY_QUESTION_MAX_LENGTH,
    example: 'What technologies does Omar use in his portfolio?',
  })
  // Trim happens during the class-transformer pass, which the global ValidationPipe
  // (transform: true) runs BEFORE class-validator.  This means MinLength(...) sees the
  // trimmed string — so "   " (three spaces) correctly fails with a min-length error
  // instead of passing as a 3-char string.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(QUERY_QUESTION_MIN_LENGTH)
  @MaxLength(QUERY_QUESTION_MAX_LENGTH)
  question!: string;

  @ApiPropertyOptional({
    description:
      'Resume an existing conversation. Omit (or leave blank) to start a new one. ' +
      'Copy the conversationId from a previous response to continue that thread.',
    example: null,
    nullable: true,
    format: 'uuid',
  })
  // Optional — omitting it starts a new conversation.
  // When provided it must be a valid UUID v4; anything else fails validation
  // before it ever reaches the session store.
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;
}
// Note: extra fields are already rejected globally by forbidNonWhitelisted: true on
// the APP_PIPE ValidationPipe in app.module.ts — no per-DTO opt-in needed.
