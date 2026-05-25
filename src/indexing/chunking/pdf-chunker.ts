// PDF document chunker for the RAG indexing pipeline.
//
// Accepts already-extracted page text (Step I3 handles the actual pdf-parse
// call) so this module stays pure and easily testable.
//
// Algorithm per page:
//   1. Normalize whitespace (collapses runs, strips control chars).
//   2. Skip pages under MIN_TOKENS after normalization.
//   3. Split page into paragraph chunks (≤ MAX_TOKENS), with OVERLAP_TOKENS
//      overlap between consecutive chunks on the same page.
//   4. Chunks never span page boundaries — pageNumber attribution stays clean.
//   5. chunkIndex is global across all pages in the document, starting at 0.
//
// Pure functions only — no I/O, no NestJS, no OpenAI.

// NOTE: pdf-chunker is kept for future use but is not wired into the indexer.
// The Chunk type here uses a local extension to allow sourceType 'pdf'.
import { type Chunk as MarkdownChunk } from '../types';

type Chunk = Omit<MarkdownChunk, 'sourceType'> & { sourceType: 'markdown' | 'pdf'; pageNumber?: number };
import { countTokens, splitByTokens } from './token-counter';

const MAX_TOKENS = 600;
const OVERLAP_TOKENS = 80;
const MIN_TOKENS = 50;

// ─── Whitespace normalizer ───────────────────────────────────────────────────

/**
 * Normalises text extracted from a PDF page:
 *   - Strips ASCII control characters (0x00–0x1F except \n, 0x7F).
 *   - Collapses runs of spaces/tabs within a line to a single space.
 *   - Collapses 3+ consecutive newlines down to 2 (preserves paragraph breaks).
 */
export function normalizePdfText(text: string): string {
  return text
    // Strip control chars (keep \n and \t for structure).
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Collapse runs of spaces/tabs on a single line.
    .replace(/[ \t]+/g, ' ')
    // Strip leading/trailing space per line.
    .replace(/^ +| +$/gm, '')
    // Collapse 3+ blank lines to 2 (a single blank line = paragraph break).
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Paragraph packer (shared logic with markdown, no code-block awareness) ──

/**
 * Packs paragraphs (split on blank lines) into chunks of at most MAX_TOKENS.
 * Oversized single paragraphs are split with splitByTokens.
 * 80-token overlap is carried between consecutive chunks.
 */
function packParagraphsIntoChunks(paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let currentPieces: string[] = [];
  let currentTokens = 0;
  let overlapCarry = '';

  const emit = (): void => {
    if (currentPieces.length === 0) return;
    const text = currentPieces.join('\n\n');
    chunks.push(text);
    const tail = splitByTokens(text, OVERLAP_TOKENS, 0);
    overlapCarry = tail.length > 0 ? (tail[tail.length - 1] ?? '') : '';
    currentPieces = [];
    currentTokens = 0;
  };

  for (const para of paragraphs) {
    const paraTokens = countTokens(para);

    if (paraTokens > MAX_TOKENS) {
      emit();
      const subChunks = splitByTokens(para, MAX_TOKENS, OVERLAP_TOKENS);
      for (let i = 0; i < subChunks.length; i++) {
        const piece = subChunks[i] ?? '';
        const withCarry = i === 0 && overlapCarry ? overlapCarry + '\n\n' + piece : piece;
        chunks.push(withCarry);
        const tail = splitByTokens(withCarry, OVERLAP_TOKENS, 0);
        overlapCarry = tail.length > 0 ? (tail[tail.length - 1] ?? '') : '';
      }
    } else if (currentTokens + paraTokens > MAX_TOKENS) {
      emit();
      const startText = overlapCarry ? overlapCarry + '\n\n' + para : para;
      currentPieces.push(startText);
      currentTokens = countTokens(startText);
    } else {
      currentPieces.push(para);
      currentTokens += paraTokens;
    }
  }

  emit();
  return chunks;
}

// ─── embeddingInput builder ──────────────────────────────────────────────────

function buildEmbeddingInput(
  sourceFile: string,
  pageNumber: number,
  text: string,
): string {
  return `[Source: ${sourceFile}, page ${pageNumber}] ${text}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface PdfPage {
  pageNumber: number;
  text: string;
}

/**
 * Chunks an array of already-extracted PDF pages into Chunk objects.
 * Chunks never span page boundaries.
 *
 * @param pages      Array of { pageNumber, text } from Step I3 (pdf-parse).
 * @param sourceFile Filename shown in the [Source: ...] prefix.
 */
export function chunkPdf(pages: PdfPage[], sourceFile: string): Chunk[] {
  const result: Chunk[] = [];
  let chunkIndex = 0;

  for (const page of pages) {
    const normalized = normalizePdfText(page.text);

    if (countTokens(normalized) < MIN_TOKENS) {
      continue;
    }

    let texts: string[];

    if (countTokens(normalized) <= MAX_TOKENS) {
      texts = [normalized];
    } else {
      const paragraphs = normalized
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      texts = packParagraphsIntoChunks(paragraphs);
    }

    for (const text of texts) {
      result.push({
        text,
        embeddingInput: buildEmbeddingInput(sourceFile, page.pageNumber, text),
        sourceFile,
        sourceType: 'pdf',
        chunkIndex,
        pageNumber: page.pageNumber,
        tokenCount: countTokens(text),
      });
      chunkIndex++;
    }
  }

  return result;
}
