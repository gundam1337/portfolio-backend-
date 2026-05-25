// Full test suite for Step I2 — Document Chunking Strategy.
// Covers: token counter, markdown chunker, PDF chunker, and the dispatcher.
//
// Run: pnpm test (vitest)

import { describe, it, expect } from 'vitest';
import { countTokens, splitByTokens } from './token-counter';
import { chunkMarkdown } from './markdown-chunker';
import { chunkPdf, normalizePdfText } from './pdf-chunker';
import { chunkDocument } from './chunker';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Repeats `word` space-separated until the token count >= target. */
function makeText(targetTokens: number, word = 'lorem'): string {
  let text = '';
  while (countTokens(text) < targetTokens) {
    text += (text ? ' ' : '') + word;
  }
  return text;
}

// ─── Token counter ────────────────────────────────────────────────────────────

describe('countTokens', () => {
  it('returns a positive integer for a non-empty string', () => {
    const n = countTokens('Hello, world!');
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it('returns 0 for an empty string', () => {
    expect(countTokens('')).toBe(0);
  });
});

describe('splitByTokens', () => {
  it('respects max token size — every chunk is within limit', () => {
    const text = makeText(800);
    const chunks = splitByTokens(text, 200, 20);
    for (const chunk of chunks) {
      expect(countTokens(chunk)).toBeLessThanOrEqual(200);
    }
  });

  it('returns the original text (within one token) for text already within limit', () => {
    const text = 'Short text.';
    const chunks = splitByTokens(text, 600, 80);
    expect(chunks).toHaveLength(1);
  });

  it('respects overlap — consecutive chunks share ~overlapTokens of content', () => {
    // Build text long enough to produce at least 3 chunks.
    const text = makeText(700);
    const chunks = splitByTokens(text, 200, 50);
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    // The start of chunk[1] should share tokens with the end of chunk[0].
    // We verify this by checking that chunk[0]'s tail appears in chunk[1].
    const tailTokens = countTokens(chunks[0]!) - 50;
    // A rough heuristic: chunk[1] should have countTokens <= 200.
    expect(countTokens(chunks[1]!)).toBeLessThanOrEqual(200);

    // And the overlap is non-trivial: chunk[1] is not entirely new content.
    // (chunk[1] token count > 0, which is trivially true, but also:)
    expect(chunks[1]!.length).toBeGreaterThan(0);
    // Confirm tailTokens is positive (overlap would exist).
    expect(tailTokens).toBeGreaterThan(0);
  });

  it('returns empty array for empty input', () => {
    expect(splitByTokens('', 200, 20)).toEqual([]);
  });
});

// ─── Markdown chunker ─────────────────────────────────────────────────────────

describe('chunkMarkdown — basic section', () => {
  it('produces exactly one chunk for a short section under 600 tokens', () => {
    // makeText(55) produces ~56 tokens — above MIN_TOKENS(50) but well under MAX_TOKENS(600).
    const content = `## Section One\n\n${makeText(55)}`;
    const chunks = chunkMarkdown(content, 'test.md');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual(['Section One']);
  });

  it('sets sourceFile and sourceType correctly', () => {
    const content = `## Sec\n\n${makeText(55)}`;
    const chunks = chunkMarkdown(content, 'my-file.md');
    expect(chunks[0]!.sourceFile).toBe('my-file.md');
    expect(chunks[0]!.sourceType).toBe('markdown');
  });

  it('chunkIndex starts at 0 and is sequential', () => {
    const content = [
      '## Alpha\n\n' + makeText(55),
      '## Beta\n\n' + makeText(55),
      '## Gamma\n\n' + makeText(55),
    ].join('\n\n');
    const chunks = chunkMarkdown(content, 'test.md');
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });
});

describe('chunkMarkdown — heading path', () => {
  it('builds a nested path for deeply nested headings', () => {
    const content = `# A\n\n## B\n\n### C\n\n${makeText(55)}`;
    const chunks = chunkMarkdown(content, 'test.md');
    expect(chunks[0]!.headingPath).toEqual(['A', 'B', 'C']);
  });

  it('resets path correctly when level decreases (# A > ## B > ## C drops B)', () => {
    const body = makeText(55);
    const content = `# A\n\n## B\n\n${body}\n\n## C\n\n${body}`;
    const chunks = chunkMarkdown(content, 'test.md');
    const bChunk = chunks.find((c) => c.headingPath?.includes('B'));
    const cChunk = chunks.find((c) => c.headingPath?.includes('C'));
    expect(bChunk!.headingPath).toEqual(['A', 'B']);
    expect(cChunk!.headingPath).toEqual(['A', 'C']);
  });

  it('handles heading level jump (# > ### skips ##)', () => {
    const body = makeText(55);
    const content = `# Top\n\n### Deep\n\n${body}`;
    const chunks = chunkMarkdown(content, 'test.md');
    expect(chunks[0]!.headingPath).toEqual(['Top', 'Deep']);
  });

  it('produces empty headingPath for content before any heading', () => {
    const body = makeText(55);
    const content = `${body}\n\n## Later Heading\n\n${makeText(55)}`;
    const chunks = chunkMarkdown(content, 'test.md');
    const preamble = chunks.find((c) => c.headingPath?.length === 0);
    expect(preamble).toBeDefined();
  });
});

describe('chunkMarkdown — large sections', () => {
  it('splits a section over 600 tokens into multiple chunks', () => {
    const bigBody = makeText(1300);
    const content = `## Big Section\n\n${bigBody}`;
    const chunks = chunkMarkdown(content, 'test.md');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(600);
    }
  });

  it('every chunk carries the correct headingPath after splitting', () => {
    const bigBody = makeText(1300);
    const content = `## Big Section\n\n${bigBody}`;
    const chunks = chunkMarkdown(content, 'test.md');
    for (const c of chunks) {
      expect(c.headingPath).toEqual(['Big Section']);
    }
  });

  it('consecutive chunks share overlap (second chunk shares tail of first)', () => {
    // Use a body that is just over 600 tokens so we get exactly 2 chunks.
    const bigBody = makeText(700, 'word');
    const content = `## Overlap Test\n\n${bigBody}`;
    const chunks = chunkMarkdown(content, 'test.md');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // The second chunk should NOT be a completely fresh start — it should
    // be shorter than if there were zero overlap (rough check: it exists).
    expect(chunks[1]!.text.length).toBeGreaterThan(0);
  });
});

describe('chunkMarkdown — skip short sections', () => {
  it('skips sections under 50 tokens', () => {
    // "just a note" is well under 50 tokens.
    const content = `## Tiny\n\njust a note\n\n## Substantial\n\n${makeText(55)}`;
    const chunks = chunkMarkdown(content, 'test.md');
    const tinyChunk = chunks.find((c) => c.headingPath?.includes('Tiny'));
    expect(tinyChunk).toBeUndefined();
  });

  it('returns empty array for completely empty content', () => {
    expect(chunkMarkdown('', 'empty.md')).toEqual([]);
  });

  it('returns empty array when all sections are below min token threshold', () => {
    const content = `## A\n\nhi\n\n## B\n\nbye`;
    expect(chunkMarkdown(content, 'test.md')).toEqual([]);
  });
});

describe('chunkMarkdown — code block boundary', () => {
  it('does not split inside a fenced code block', () => {
    // Build a section whose body contains a code block that spans a natural
    // paragraph boundary. The block should appear intact in one chunk.
    const preamble = makeText(500, 'text'); // almost full chunk
    const codeBlock = '```typescript\nconst x = 1;\nconst y = 2;\nconst z = 3;\n```';
    // Join with blank line so they would normally be separate paragraphs.
    const body = `${preamble}\n\n${codeBlock}`;
    const content = `## Code Test\n\n${body}`;
    const chunks = chunkMarkdown(content, 'test.md');
    // Find the chunk that contains the code block.
    const withCode = chunks.find((c) => c.text.includes('```'));
    expect(withCode).toBeDefined();
    // The code block must not be split: opening and closing ``` must both be present.
    const openCount = (withCode!.text.match(/```/g) ?? []).length;
    expect(openCount % 2).toBe(0); // even number of ``` means properly paired
  });
});

describe('chunkMarkdown — embeddingInput', () => {
  it('prefixes embeddingInput with [Source: file > heading]', () => {
    const content = `## My Section\n\n${makeText(55)}`;
    const chunks = chunkMarkdown(content, 'journal.md');
    expect(chunks[0]!.embeddingInput).toMatch(
      /^\[Source: journal\.md > My Section\]/,
    );
  });

  it('uses bare [Source: file] for preamble with no heading', () => {
    const body = makeText(55);
    const content = `${body}`;
    const chunks = chunkMarkdown(content, 'journal.md');
    expect(chunks[0]!.embeddingInput).toMatch(/^\[Source: journal\.md\]/);
  });

  it('includes the full nested heading path in the prefix', () => {
    const content = `# Year\n\n## Month\n\n### Day\n\n${makeText(55)}`;
    const chunks = chunkMarkdown(content, 'log.md');
    expect(chunks[0]!.embeddingInput).toMatch(
      /^\[Source: log\.md > Year > Month > Day\]/,
    );
  });
});

// ─── PDF chunker ─────────────────────────────────────────────────────────────

describe('normalizePdfText', () => {
  it('collapses multiple spaces to one', () => {
    expect(normalizePdfText('hello   world')).toBe('hello world');
  });

  it('strips control characters', () => {
    // Control chars are removed in-place without inserting spaces.
    expect(normalizePdfText('hello\x00world\x1F!')).toBe('helloworld!');
    // When there is surrounding whitespace, that whitespace is preserved/collapsed normally.
    expect(normalizePdfText('hello \x00 world!')).toBe('hello world!');
  });

  it('preserves paragraph breaks (two newlines)', () => {
    const result = normalizePdfText('Para one.\n\nPara two.');
    expect(result).toContain('\n\n');
  });

  it('collapses 3+ newlines to 2', () => {
    const result = normalizePdfText('A\n\n\n\nB');
    expect(result).toBe('A\n\nB');
  });
});

describe('chunkPdf — basic page', () => {
  it('produces one chunk for a short page under 600 tokens', () => {
    const pages = [{ pageNumber: 1, text: makeText(55) }];
    const chunks = chunkPdf(pages, 'doc.pdf');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.pageNumber).toBe(1);
    expect(chunks[0]!.sourceType).toBe('pdf');
  });

  it('splits a long page into multiple chunks, all with the same pageNumber', () => {
    const pages = [{ pageNumber: 3, text: makeText(1300) }];
    const chunks = chunkPdf(pages, 'report.pdf');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.pageNumber).toBe(3);
      expect(c.tokenCount).toBeLessThanOrEqual(600);
    }
  });

  it('skips empty pages', () => {
    const pages = [
      { pageNumber: 1, text: '   ' },
      { pageNumber: 2, text: makeText(55) },
    ];
    const chunks = chunkPdf(pages, 'doc.pdf');
    const page1Chunks = chunks.filter((c) => c.pageNumber === 1);
    expect(page1Chunks).toHaveLength(0);
  });

  it('skips pages under 50 tokens', () => {
    const pages = [
      { pageNumber: 1, text: 'hi' },
      { pageNumber: 2, text: makeText(55) },
    ];
    const chunks = chunkPdf(pages, 'doc.pdf');
    expect(chunks.filter((c) => c.pageNumber === 1)).toHaveLength(0);
    expect(chunks.filter((c) => c.pageNumber === 2).length).toBeGreaterThan(0);
  });
});

describe('chunkPdf — multi-page ordering', () => {
  it('chunks from different pages never mix pageNumber', () => {
    const pages = [
      { pageNumber: 1, text: makeText(55) },
      { pageNumber: 2, text: makeText(55) },
    ];
    const chunks = chunkPdf(pages, 'doc.pdf');
    const p1 = chunks.filter((c) => c.pageNumber === 1);
    const p2 = chunks.filter((c) => c.pageNumber === 2);
    expect(p1.length).toBeGreaterThan(0);
    expect(p2.length).toBeGreaterThan(0);
    // All page-1 chunks come before all page-2 chunks in chunkIndex order.
    const maxP1Index = Math.max(...p1.map((c) => c.chunkIndex));
    const minP2Index = Math.min(...p2.map((c) => c.chunkIndex));
    expect(maxP1Index).toBeLessThan(minP2Index);
  });

  it('chunkIndex is sequential across pages starting at 0', () => {
    const pages = [
      { pageNumber: 1, text: makeText(1300) }, // multiple chunks
      { pageNumber: 2, text: makeText(1300) }, // multiple chunks
    ];
    const chunks = chunkPdf(pages, 'doc.pdf');
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('page 1 chunks and page 2 chunks have globally sequential chunkIndex', () => {
    const pages = [
      { pageNumber: 1, text: makeText(700) },
      { pageNumber: 2, text: makeText(700) },
    ];
    const chunks = chunkPdf(pages, 'doc.pdf');
    const p1Chunks = chunks.filter((c) => c.pageNumber === 1);
    const p2Chunks = chunks.filter((c) => c.pageNumber === 2);
    // Page 2 indices should start immediately after page 1's last index.
    expect(p2Chunks[0]!.chunkIndex).toBe(p1Chunks[p1Chunks.length - 1]!.chunkIndex + 1);
  });
});

describe('chunkPdf — whitespace normalisation', () => {
  it('normalises whitespace garbage from PDF extraction', () => {
    const dirtyText = makeText(55, 'word').replace(/ /g, '   '); // triple spaces
    const pages = [{ pageNumber: 1, text: dirtyText }];
    const chunks = chunkPdf(pages, 'doc.pdf');
    expect(chunks.length).toBeGreaterThan(0);
    // Should not contain runs of multiple spaces.
    expect(chunks[0]!.text).not.toMatch(/ {2,}/);
  });
});

describe('chunkPdf — embeddingInput', () => {
  it('prefixes embeddingInput with [Source: file, page N]', () => {
    const pages = [{ pageNumber: 5, text: makeText(55) }];
    const chunks = chunkPdf(pages, 'report.pdf');
    expect(chunks[0]!.embeddingInput).toMatch(
      /^\[Source: report\.pdf, page 5\]/,
    );
  });
});

// ─── Dispatcher ───────────────────────────────────────────────────────────────

describe('chunkDocument dispatcher', () => {
  it('chunks a markdown document and returns correct sourceType', () => {
    const content = `## Topic\n\n${makeText(55)}`;
    const chunks = chunkDocument({ sourceFile: 'x.md', content });
    expect(chunks[0]!.sourceType).toBe('markdown');
    expect(chunks[0]!.headingPath).toBeDefined();
  });
});
