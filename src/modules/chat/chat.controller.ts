import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatService } from './chat.service';

@ApiTags('chat')
@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stream a conversational AI response',
    description: `
Sends a multi-turn message array to **Anthropic Claude** and streams the reply
back as raw \`text/plain\` chunks over HTTP.

**Streaming protocol:**
- Response headers are flushed immediately once the stream opens.
- Each chunk is a plain UTF-8 text fragment (no SSE envelope, no JSON wrapping).
- The stream ends when the HTTP response body closes.

**Client-side reading (browser fetch):**
\`\`\`js
const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello!' }] }),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  process.stdout.write(decoder.decode(value));
}
\`\`\`

**Rate limiting:** sliding-window per IP, backed by Redis.
    `.trim(),
  })
  @ApiHeader({
    name: 'X-Request-ID',
    description: 'Optional client-supplied trace ID. Echoed back in the response header.',
    required: false,
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @ApiProduces('text/plain')
  @ApiBody({
    type: ChatRequestDto,
    examples: {
      single_turn: {
        summary: 'Single user message',
        value: {
          messages: [{ role: 'user', content: 'Tell me about your experience with NestJS.' }],
          language: 'en',
        },
      },
      multi_turn: {
        summary: 'Multi-turn conversation',
        value: {
          messages: [
            { role: 'user', content: 'What is your tech stack?' },
            { role: 'assistant', content: 'I primarily use TypeScript, NestJS, and React.' },
            { role: 'user', content: 'What database do you prefer?' },
          ],
          language: 'en',
        },
      },
      french: {
        summary: 'French language request',
        value: {
          messages: [{ role: 'user', content: 'Parle-moi de tes projets.' }],
          language: 'fr',
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Streamed plain-text response. The body is a sequence of UTF-8 text chunks ' +
      'that together form the complete AI reply.',
    schema: {
      type: 'string',
      example: 'I have 5 years of experience building...',
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed (empty messages array, invalid role, content too long, etc.).',
    schema: {
      example: {
        statusCode: 400,
        message: ['messages must contain at least 1 elements'],
        error: 'Bad Request',
      },
    },
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded. Retry after the window resets.',
    schema: {
      example: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
    },
  })
  async chat(
    @Body() dto: ChatRequestDto,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    reply.raw.setHeader('Content-Type', 'text/plain; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    try {
      const stream = this.chatService.streamChat(dto, req.id as string);
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          reply.raw.write(event.delta.text);
        }
      }
    } finally {
      reply.raw.end();
    }
  }
}
