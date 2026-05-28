import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { QueryRewriterService } from '../query-rewriter/query-rewriter.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { SessionService } from '../../shared/session/session.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RerankerService } from '../reranking/reranker.service';
import { PromptBuilderService } from '../prompt/prompt-builder.service';
import { LlmService } from '../llm/llm.service';
import type { RerankedChunk } from '../reranking/reranker.types';
import type { QueryRequestDto } from './dto/query-request.dto';
import type {
  ConfidenceMeta,
  QueryResponse,
  SourceItem,
} from './interfaces/query.interface';

const PREVIEW_MAX_CHARS = 200;

@Injectable()
export class QueryService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly sessionService: SessionService,
    private readonly queryRewriter: QueryRewriterService,
    private readonly embeddingService: EmbeddingService,
    private readonly retrievalService: RetrievalService,
    private readonly rerankerService: RerankerService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly llmService: LlmService,
  ) {
  }

  async process(dto: QueryRequestDto, requestId: string): Promise<QueryResponse> {
    const session = await this.sessionService.loadOrCreate(dto.conversationId);
    const historyBeforeAppend = await this.sessionService.getRecentHistory(session.id);
    await this.sessionService.appendUserMessage(session.id, dto.question);

    const rewriteResult = await this.queryRewriter.rewrite({
      originalQuestion: dto.question,
      history: historyBeforeAppend,
      requestId,
    });

    const embedResult = await this.embeddingService.embed({
      text: rewriteResult.rewrittenQuestion,
      requestId,
    });

    const retrieval = await this.retrievalService.search({
      queryVector: embedResult.vector,
      requestId,
    });
    
    const rerank = await this.rerankerService.rerank({
      query: rewriteResult.rewrittenQuestion,
      chunks: retrieval.chunks,
      lowConfidence: retrieval.lowConfidence,
      requestId,
    });


    // const lowConfidenceMode = retrieval.lowConfidence || rerank.chunks.length === 0;

    // Step 11: Prompt construction
    // const prompt = this.promptBuilder.build({
    //   originalQuestion: dto.question,
    //   rerankedChunks: rerank.chunks,
    //   conversationHistory: historyBeforeAppend,
    //   lowConfidenceMode,
    //   requestId,
    // });

    // Step 12: LLM answer
    // const llmResult = await this.llmService.complete(prompt.messages, requestId);

    // Step 13: Follow-up suggestions
    // const suggestions = await this.llmService.suggestFollowUps(dto.question, llmResult.text, requestId);

    // Step 14: Persist assistant message
    // await this.sessionService.appendAssistantMessage(session.id, llmResult.text);


    // const topRerankerScore = rerank.chunks[0]?.rerankerScore ?? null;

    return {
      requestId,
      // conversationId: session.id,
      // answer: {
      //   text: llmResult.text,
      //   format: 'markdown',
      // },
      // confidence: this.deriveConfidence(topRerankerScore, lowConfidenceMode, rerank.chunks[0]),
      // sources: this.buildSources(rerank.chunks),
      // suggestions,
      // status: lowConfidenceMode ? 'low_confidence' : 'answered',
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private deriveConfidence(
    topRerankerScore: number | null,
    lowConfidenceMode: boolean,
    topChunk: RerankedChunk | undefined,
  ): ConfidenceMeta {
    if (lowConfidenceMode || topRerankerScore === null) {
      return { level: 'low', reason: "No sufficiently relevant content found in Omar's portfolio." };
    }
    if (topRerankerScore > 0.7) {
      return { level: 'high', reason: "The answer was generated from highly relevant content in Omar's portfolio." };
    }
    if (topRerankerScore > 0.4) {
      const section = topChunk?.headingPath?.at(-1);
      const sourceFile = topChunk ? path.basename(topChunk.sourceFile) : 'the portfolio';
      const reason = section
        ? `The answer was generated from Omar's CV, mainly the ${section} section.`
        : `The answer was generated from ${sourceFile}.`;
      return { level: 'medium', reason };
    }
    return { level: 'low', reason: 'Content found but relevance is limited.' };
  }

  private buildSources(chunks: RerankedChunk[]): SourceItem[] {
    return chunks.map((chunk, i) => ({
      id: `source_${i + 1}`,
      title: path.basename(chunk.sourceFile),
      type: chunk.sourceType,
      section: chunk.headingPath?.at(-1) ?? null,
      pageNumber: chunk.pageNumber ?? null,
      preview: chunk.text.slice(0, PREVIEW_MAX_CHARS),
    }));
  }
}
