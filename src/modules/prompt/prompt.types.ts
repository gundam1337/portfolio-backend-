export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export interface SourceMeta {
  index: number;
  sourceFile: string;
  headingPath?: string[];
  pageNumber?: number;
}

export interface BuiltPrompt {
  messages: ChatMessage[];
  totalTokens: number;
  systemTokens: number;
  historyTokens: number;
  contextTokens: number;
  userTokens: number;
  lowConfidenceMode: boolean;
  sourcesIncluded: SourceMeta[];
}
