import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

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
}
// Note: extra fields are already rejected globally by forbidNonWhitelisted: true on
// the APP_PIPE ValidationPipe in app.module.ts — no per-DTO opt-in needed.
