import type { Message } from '../../shared/session/session.types';

export interface RewriteInput {
  originalQuestion: string;
  history: Message[];
  requestId: string;
}

export type FallbackReason = 'timeout' | 'api_error' | 'invalid_output';

export interface RewriteResult {
  rewrittenQuestion: string;
  rewriteUsed: boolean;
  fallbackReason: FallbackReason | null;
}
