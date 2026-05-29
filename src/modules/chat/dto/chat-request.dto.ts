import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChatMessageDto {
  @ApiProperty({
    description: 'The speaker of this turn.',
    enum: ['user', 'assistant'],
    example: 'user',
  })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({
    description: 'Text content of the message.',
    minLength: 1,
    maxLength: 4000,
    example: 'Tell me about your experience with NestJS.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;
}

export class ChatRequestDto {
  @ApiProperty({
    description:
      'Ordered conversation history. Must start with a `user` turn. ' +
      'Maximum 40 messages per request.',
    type: [ChatMessageDto],
    minItems: 1,
    maxItems: 40,
    example: [
      { role: 'user', content: 'Tell me about your experience with NestJS.' },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];

  @ApiPropertyOptional({
    description:
      'Preferred response language. Defaults to English when omitted.',
    enum: ['en', 'fr'],
    example: 'en',
  })
  @IsOptional()
  @IsIn(['en', 'fr'])
  language?: 'en' | 'fr';
}
