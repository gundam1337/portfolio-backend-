import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnswerMetaDto {
  @ApiProperty({
    description: 'The answer text, formatted as Markdown.',
    example: 'Omar has **5 years** of experience with TypeScript and Node.js...',
  })
  text: string;

  @ApiProperty({
    description: 'Always `markdown` — tells the client how to render `text`.',
    enum: ['markdown'],
    example: 'markdown',
  })
  format: 'markdown';
}

export class ConfidenceMetaDto {
  @ApiProperty({
    description: 'Confidence band of the generated answer.',
    enum: ['high', 'medium', 'low'],
    example: 'high',
  })
  level: 'high' | 'medium' | 'low';

  @ApiProperty({
    description: 'Human-readable explanation for the confidence level.',
    example: 'Strong match found across 3 source documents.',
  })
  reason: string;
}

export class SourceItemDto {
  @ApiProperty({
    description: 'Unique identifier of the source chunk.',
    example: 'abc123',
  })
  id: string;

  @ApiProperty({
    description: 'Display title of the source document.',
    example: 'experience.md',
  })
  title: string;

  @ApiProperty({
    description: 'File type of the source document.',
    enum: ['markdown', 'pdf'],
    example: 'markdown',
  })
  type: 'markdown' | 'pdf';

  @ApiPropertyOptional({
    description: 'Section heading within the document, if available.',
    nullable: true,
    example: '## Work Experience',
  })
  section: string | null;

  @ApiPropertyOptional({
    description: 'Page number for PDF sources. `null` for markdown sources.',
    nullable: true,
    example: null,
  })
  pageNumber: number | null;

  @ApiProperty({
    description: 'Short text excerpt from the matching chunk.',
    example: 'Worked on distributed systems at Acme Corp...',
  })
  preview: string;
}

export class QueryResponseDto {
  @ApiProperty({
    description: 'UUID trace ID for this request, mirrors `X-Request-ID` header.',
    format: 'uuid',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  requestId: string;

  @ApiPropertyOptional({
    description:
      'UUID of the conversation thread. Pass this back in subsequent requests ' +
      'as `conversationId` to continue the thread.',
    format: 'uuid',
    nullable: true,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  conversationId?: string;

  @ApiPropertyOptional({
    description: 'The generated answer. Present when `status` is `answered`.',
    type: AnswerMetaDto,
    nullable: true,
  })
  answer?: AnswerMetaDto;

  @ApiPropertyOptional({
    description: 'Confidence assessment of the answer.',
    type: ConfidenceMetaDto,
    nullable: true,
  })
  confidence?: ConfidenceMetaDto;

  @ApiPropertyOptional({
    description: 'Source documents the answer was grounded in.',
    type: [SourceItemDto],
    nullable: true,
  })
  sources?: SourceItemDto[];

  @ApiPropertyOptional({
    description: 'Follow-up question suggestions.',
    type: [String],
    nullable: true,
    example: ['What projects has Omar shipped?', 'What is his tech stack?'],
  })
  suggestions?: string[];

  @ApiPropertyOptional({
    description:
      '`answered` — full answer returned. ' +
      '`low_confidence` — the system could not ground an answer with sufficient confidence.',
    enum: ['answered', 'low_confidence'],
    nullable: true,
    example: 'answered',
  })
  status?: 'answered' | 'low_confidence';
}
