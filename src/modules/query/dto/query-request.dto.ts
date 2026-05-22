import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class QueryRequestDto {
  @ApiProperty({
    description: 'The question to send to the RAG system',
    minLength: 3,
    maxLength: 2000,
    example: 'What technologies does Omar use in his portfolio?',
  })
  // Trim happens during the class-transformer pass, which the global ValidationPipe
  // (transform: true) runs BEFORE class-validator.  This means MinLength(3) sees the
  // trimmed string — so "   " (three spaces) correctly fails with a min-length error
  // instead of passing as a 3-char string.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
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
