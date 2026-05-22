import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class QueryRequestDto {
  @ApiProperty({
    description: 'The question to send to the RAG system',
    maxLength: 2000,
    example: 'What technologies does Omar use in his portfolio?',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  question!: string;
}
