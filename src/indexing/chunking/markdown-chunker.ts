// Markdown document chunker for the RAG indexing pipeline.
//
// Responsibilities:
//   1. Parse heading structure into a stack-based path (e.g. ["2024","March","Tokyo"]).
//   2. Accumulate each section's body text under its heading path.
//   3. Split bodies that exceed MAX_TOKENS using paragraph boundaries first,
//      falling back to splitByTokens for oversized single paragraphs.
//   4. Respect fenced code block boundaries — never split mid-block.
//   5. Build embeddingInput with a [Source: ...] prefix for each chunk.
//
// Pure functions only — no I/O, no NestJS, no OpenAI.

import { type Chunk } from '../types';
import { countTokens, splitByTokens } from './token-counter';

const MAX_TOKENS = 600;
const OVERLAP_TOKENS = 80;
const MIN_TOKENS = 50; // sections below this are skipped as noise

// Matches ATX headings: "## Some Title" → groups [hashes, title]
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

// ─── Internal types ──────────────────────────────────────────────────────────

interface Section {
  headingPath: string[];
  body: string; // raw body text (may be multi-paragraph)
}

// ─── Heading path stack ──────────────────────────────────────────────────────

/**
 * Mutates `stack` to reflect a new heading at `level`.
 * Pops all entries at depth >= level, then pushes the new title.
 * stack[i].level is the heading level (1–6); stack[i].title is the text.
 */
function pushHeading(
  stack: Array<{ level: number; title: string }>,
  level: number,
  title: string,
): void {
  // Remove entries at the same or deeper level — they are superseded.
  while (stack.length > 0 && stack[stack.length - 1].level >= level) {
    stack.pop();
  }
  stack.push({ level, title });
}

/** Returns the current heading path as a plain string array. */
function currentPath(stack: Array<{ level: number; title: string }>): string[] {
  return stack.map((e) => e.title);
}

// ─── Section parser ──────────────────────────────────────────────────────────

/**
 * Walks the Markdown line by line and groups lines into sections.
 * A section is the body text that follows a heading (or the preamble before
 * the first heading). Heading lines themselves are NOT included in any body.
 */
function parseSections(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  const bodyLines: string[] = [];

  const flushSection = (): void => {
    const body = bodyLines.join('\n').trim();
    if (body) {
      sections.push({ headingPath: currentPath(stack), body });
    }
    bodyLines.length = 0;
  };

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      // Flush accumulated body as a section for the PREVIOUS heading.
      flushSection();
      pushHeading(stack, m[1].length, m[2].trim());
    } else {
      bodyLines.push(line);
    }
  }

  // Flush trailing body after last heading (or entire doc if no headings).
  flushSection();

  return sections;
}

// ─── Code-block-safe paragraph splitter ─────────────────────────────────────

/**
 * Splits body text on blank lines (\n\n) while refusing to break inside a
 * fenced code block (``` ... ```).
 *
 * Returns an array of "paragraphs" where each element is a string that may
 * span multiple raw lines if it contains a fenced block.
 */
function splitParagraphsRespectingCodeBlocks(body: string): string[] {
  // Split naively first, then re-merge any paragraphs that fall inside a block.
  const rawParagraphs = body.split(/\n\n+/);
  const result: string[] = [];
  let insideBlock = false;
  let accumulated: string[] = [];

  for (const para of rawParagraphs) {
    // Count ``` occurrences — odd count means we're toggling fence state.
    const fenceCount = (para.match(/^```/gm) ?? []).length;

    if (!insideBlock) {
      if (fenceCount % 2 === 1) {
        // Opens a block without closing it — start accumulating.
        insideBlock = true;
        accumulated.push(para);
      } else {
        // Normal paragraph (may contain a self-closing block — that's fine).
        result.push(para);
      }
    } else {
      // We're inside an open fence; keep accumulating.
      accumulated.push(para);
      if (fenceCount % 2 === 1) {
        // This paragraph closes the fence.
        insideBlock = false;
        result.push(accumulated.join('\n\n'));
        accumulated = [];
      }
    }
  }

  // If the document ends with an unclosed fence, emit whatever we have.
  if (accumulated.length > 0) {
    result.push(accumulated.join('\n\n'));
  }

  return result.filter((p) => p.trim().length > 0);
}

// ─── Paragraph-level greedy packer ──────────────────────────────────────────

/**
 * Greedily packs paragraphs into chunks of at most MAX_TOKENS tokens.
 * When a single paragraph is itself over MAX_TOKENS, it is split via
 * splitByTokens (token-level fallback).
 *
 * Overlap is implemented by prepending the last OVERLAP_TOKENS tokens worth
 * of text from the previous chunk to the next chunk's first piece.
 */
function packParagraphsIntoChunks(paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let currentPieces: string[] = [];
  let currentTokens = 0;

  // Overlap carry: the tail of the previous emitted chunk (raw text).
  let overlapCarry = '';

  const emit = (): void => {
    if (currentPieces.length === 0) return;
    const text = currentPieces.join('\n\n');
    chunks.push(text);

    // Compute the overlap carry for the next chunk using the token splitter.
    // splitByTokens with a window of OVERLAP_TOKENS and 0 overlap gives us
    // the last OVERLAP_TOKENS tokens as the final element.
    const tail = splitByTokens(text, OVERLAP_TOKENS, 0);
    overlapCarry = tail.length > 0 ? (tail[tail.length - 1] ?? '') : '';

    currentPieces = [];
    currentTokens = 0;
  };

  for (const para of paragraphs) {
    const paraTokens = countTokens(para);

    if (paraTokens > MAX_TOKENS) {
      // Oversized paragraph: flush current accumulation, then token-split.
      emit();
      const subChunks = splitByTokens(para, MAX_TOKENS, OVERLAP_TOKENS);
      for (let i = 0; i < subChunks.length; i++) {
        const piece = subChunks[i] ?? '';
        // Prepend overlap carry to the first sub-chunk (continuation of prev).
        const withCarry = i === 0 && overlapCarry ? overlapCarry + '\n\n' + piece : piece;
        chunks.push(withCarry);
        const tail = splitByTokens(withCarry, OVERLAP_TOKENS, 0);
        overlapCarry = tail.length > 0 ? (tail[tail.length - 1] ?? '') : '';
      }
    } else if (currentTokens + paraTokens > MAX_TOKENS) {
      // Adding this paragraph would overflow: emit, start fresh with carry.
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
  headingPath: string[],
  text: string,
): string {
  const path =
    headingPath.length > 0
      ? `${sourceFile} > ${headingPath.join(' > ')}`
      : sourceFile;
  return `[Source: ${path}] ${text}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Chunks a Markdown document into Chunk objects ready for embedding.
 *
 * @param content   Full Markdown source text.
 * @param sourceFile  Filename shown in the [Source: ...] prefix.
 */
export function chunkMarkdown(content: string, sourceFile: string): Chunk[] {
  const sections = parseSections(content);
  const result: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const bodyTokens = countTokens(section.body);

    if (bodyTokens < MIN_TOKENS) {
      // Too small to contribute useful signal — skip.
      // In production this would be: logger.debug('chunk_skipped_too_small', ...)
      continue;
    }

    let texts: string[];

    if (bodyTokens <= MAX_TOKENS) {
      texts = [section.body];
    } else {
      const paragraphs = splitParagraphsRespectingCodeBlocks(section.body);
      texts = packParagraphsIntoChunks(paragraphs);
    }

    for (const text of texts) {
      result.push({
        text,
        embeddingInput: buildEmbeddingInput(sourceFile, section.headingPath, text),
        sourceFile,
        sourceType: 'markdown',
        chunkIndex,
        headingPath: section.headingPath,
        tokenCount: countTokens(text),
      });
      chunkIndex++;
    }
  }

  return result;
}
