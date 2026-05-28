export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type QueryStatus = 'answered' | 'low_confidence';

export interface AnswerMeta {
  text: string;
  format: 'markdown';
}

export interface ConfidenceMeta {
  level: ConfidenceLevel;
  reason: string;
}

export interface SourceItem {
  id: string;
  title: string;
  type: 'markdown' | 'pdf';
  section: string | null;
  pageNumber: number | null;
  preview: string;
}

export interface QueryResponse {
  requestId: string;
  conversationId?: string;
  answer?: AnswerMeta;
  confidence?: ConfidenceMeta;
  sources?: SourceItem[];
  suggestions?: string[];
  status?: QueryStatus;
}
