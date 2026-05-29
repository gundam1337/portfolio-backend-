import { Module } from '@nestjs/common';
import { AnthropicModule } from '../../shared/anthropic/anthropic.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [AnthropicModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
