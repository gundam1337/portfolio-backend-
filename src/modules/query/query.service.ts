import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { QueryRewriterService } from '../query-rewriter/query-rewriter.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { SessionService } from '../../shared/session/session.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RerankerService } from '../reranking/reranker.service';
import { PromptBuilderService } from '../prompt/prompt-builder.service';
import type { Env } from '../../config/env.validation';
import type { QueryRequestDto } from './dto/query-request.dto';
import type { QueryResponse } from './interfaces/query.interface';

const PREVIEW_MAX_CHARS = 200;

@Injectable()
export class QueryService {
  private readonly rerankTopN: number;

  constructor(
    private readonly logger: PinoLogger,
    private readonly sessionService: SessionService,
    private readonly queryRewriter: QueryRewriterService,
    private readonly embeddingService: EmbeddingService,
    private readonly retrievalService: RetrievalService,
    private readonly rerankerService: RerankerService,
    private readonly promptBuilder: PromptBuilderService,
    config: ConfigService<Env, true>,
  ) {
    this.logger.setContext(QueryService.name);
    this.rerankTopN = config.get('RERANK_TOP_N', { infer: true });
  }

  async process(dto: QueryRequestDto, requestId: string): Promise<QueryResponse> {
    const session = await this.sessionService.loadOrCreate(dto.conversationId);
    const historyBeforeAppend = await this.sessionService.getRecentHistory(session.id);
    await this.sessionService.appendUserMessage(session.id, dto.question);

    // Step 4: Query rewriting
    const rewriteResult = await this.queryRewriter.rewrite({
      originalQuestion: dto.question,
      history: historyBeforeAppend,
      requestId,
    });

    // Step 5: Embedding
    const embedResult = await this.embeddingService.embed({
      text: rewriteResult.rewrittenQuestion,
      requestId,
    });

    // Step 7: Vector search
    const retrieval = await this.retrievalService.search({
      queryVector: embedResult.vector,
      requestId,
    });

    // Step 9: Reranking
    const rerank = await this.rerankerService.rerank({
      query: rewriteResult.rewrittenQuestion,
      chunks: retrieval.chunks,
      lowConfidence: retrieval.lowConfidence,
      requestId,
    });

    // Final low-confidence mode: either retrieval signaled it, or reranker returned nothing
    const lowConfidenceMode = retrieval.lowConfidence || rerank.chunks.length === 0;

    // Step 11: Prompt construction
    // Pass historyBeforeAppend excluding nothing — session.messages already has the new user
    // message appended so we slice to exclude it and only keep prior history.
    const prompt = this.promptBuilder.build({
      originalQuestion: dto.question,
      rerankedChunks: rerank.chunks,
      conversationHistory: historyBeforeAppend,
      lowConfidenceMode,
      requestId,
    });

    // TODO Step 12: send prompt.messages to OpenAI chat completions and stream the answer

    const history = await this.sessionService.getRecentHistory(session.id);

    this.logger.info({ requestId, sessionId: session.id }, 'query_processed');

    return {
      requestId,
      conversationId: session.id,
      originalQuestion: dto.question,
      rewrittenQuestion: rewriteResult.rewrittenQuestion,
      rewriteUsed: rewriteResult.rewriteUsed,
      fallbackReason: rewriteResult.fallbackReason,
      embedding: {
        model: embedResult.model,
        dimensions: embedResult.dimensions,
        cached: embedResult.cached,
        durationMs: embedResult.durationMs,
      },
      retrieval: {
        count: retrieval.chunks.length,
        topScore: retrieval.topScore,
        lowestScore: retrieval.lowestScore,
        lowConfidence: retrieval.lowConfidence,
        durationMs: retrieval.durationMs,
      },
      reranking: {
        used: rerank.used,
        model: rerank.model,
        topN: this.rerankTopN,
        durationMs: rerank.durationMs,
        fallbackReason: rerank.fallbackReason,
        topResults: rerank.chunks.map((c) => ({
          rerankerScore: c.rerankerScore,
          vectorScore: c.vectorScore,
          sourceFile: c.sourceFile,
          headingPath: c.headingPath ?? null,
          pageNumber: c.pageNumber ?? null,
          preview: c.text.slice(0, PREVIEW_MAX_CHARS),
        })),
      },
      prompt: {
        totalTokens: prompt.totalTokens,
        systemTokens: prompt.systemTokens,
        historyTokens: prompt.historyTokens,
        contextTokens: prompt.contextTokens,
        userTokens: prompt.userTokens,
        lowConfidenceMode: prompt.lowConfidenceMode,
        sourcesIncluded: prompt.sourcesIncluded,
      },
      history,
    };
  }
}
