import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QdrantClientProvider } from './qdrant.client.provider';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [ConfigModule],
  providers: [QdrantClientProvider, RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
