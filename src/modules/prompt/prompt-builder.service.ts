import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { countTokens } from '../../indexing/chunking/token-counter';
import type { RerankedChunk } from '../reranking/reranker.types';
import type { Message } from '../../shared/session/session.types';
import { SYSTEM_MESSAGE, LOW_CONFIDENCE_SYSTEM_MESSAGE } from './system-messages';
import type { BuiltPrompt, ChatMessage, SourceMeta } from './prompt.types';

interface BuildInput {
  originalQuestion: string;
  rerankedChunks: RerankedChunk[];
  conversationHistory: Message[];
  lowConfidenceMode: boolean;
  requestId: string;
}

@Injectable()
export class PromptBuilderService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(PromptBuilderService.name);
  }

  build(input: BuildInput): BuiltPrompt {
    const { originalQuestion, rerankedChunks, conversationHistory, requestId } = input;

    // Defensive guard: empty chunks with lowConfidenceMode=false is a logic error upstream.
    // Force low confidence so the prompt stays honest.
    let lowConfidenceMode = input.lowConfidenceMode;
    if (!lowConfidenceMode && rerankedChunks.length === 0) {
      this.logger.warn(
        { requestId, reason: 'empty_chunks_with_high_confidence_mode' },
        'prompt_low_confidence_forced',
      );
      lowConfidenceMode = true;
    }

    const messages: ChatMessage[] = [];

    // 1. System message
    const systemContent = lowConfidenceMode ? LOW_CONFIDENCE_SYSTEM_MESSAGE : SYSTEM_MESSAGE;
    messages.push({ role: 'system', content: systemContent });
    const systemTokens = countTokens(systemContent);

    // 2. Conversation history (oldest first, exclude current user message)
    let historyTokens = 0;
    for (const msg of conversationHistory) {
      const chatMsg: ChatMessage = { role: msg.role, content: msg.content };
      messages.push(chatMsg);
      historyTokens += countTokens(msg.content);
    }

    // 3. Build the composite user message (context block + question)
    let contextBlock = '';
    const sourcesIncluded: SourceMeta[] = [];

    if (!lowConfidenceMode) {
      const contextLines: string[] = ['CONTEXT:', ''];
      for (let i = 0; i < rerankedChunks.length; i++) {
        const chunk = rerankedChunks[i];
        const sourceIndex = i + 1; // 1-based

        // Build source label: [Source N: filename{ > heading > path}{, page N}]
        let label = `[Source ${sourceIndex}: ${chunk.sourceFile}`;
        if (chunk.headingPath && chunk.headingPath.length > 0) {
          label += ` > ${chunk.headingPath.join(' > ')}`;
        }
        if (typeof chunk.pageNumber === 'number') {
          label += `, page ${chunk.pageNumber}`;
        }
        label += ']';

        contextLines.push(label);
        contextLines.push(chunk.text);
        contextLines.push('');

        sourcesIncluded.push({
          index: sourceIndex,
          sourceFile: chunk.sourceFile,
          headingPath: chunk.headingPath,
          pageNumber: chunk.pageNumber,
        });
      }
      contextBlock = contextLines.join('\n');
    }

    const questionLine = `QUESTION: ${originalQuestion}`;
    const userContent = lowConfidenceMode
      ? questionLine
      : `${contextBlock}\n${questionLine}`;

    messages.push({ role: 'user', content: userContent });

    const contextTokens = lowConfidenceMode ? 0 : countTokens(contextBlock);
    const userTokens = countTokens(userContent);
    const totalTokens = systemTokens + historyTokens + userTokens;

    this.logger.debug(
      {
        requestId,
        lowConfidenceMode,
        totalTokens,
        systemTokens,
        historyTokens,
        contextTokens,
        userTokens,
        sourceCount: sourcesIncluded.length,
        historyLength: conversationHistory.length,
      },
      'prompt_built',
    );

    return {
      messages,
      totalTokens,
      systemTokens,
      historyTokens,
      contextTokens,
      userTokens,
      lowConfidenceMode,
      sourcesIncluded,
    };
  }
}
