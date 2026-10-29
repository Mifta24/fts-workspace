import { z } from "zod";

export const CHUNK_TARGET_CHARS = 800;
export const MAX_CHUNKS_PER_DOCUMENT = 500;
export const SEARCH_LIMIT = 8;
export const SNIPPET_CHARS = 300;

export const INGEST_JOB = "knowledge.ingest";

export const searchQuerySchema = z.string().trim().min(2).max(200);
export const documentIdSchema = z.uuid();

/**
 * Splits text into passages of roughly CHUNK_TARGET_CHARS, preferring paragraph and then
 * sentence boundaries, with a hard cut as the last resort. Returns at most
 * MAX_CHUNKS_PER_DOCUMENT passages and whether the text had to be truncated.
 */
export function chunkText(text: string): { chunks: string[]; truncated: boolean } {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= CHUNK_TARGET_CHARS) {
      pieces.push(paragraph);
      continue;
    }
    // Long paragraph: sentences first, then a hard cut.
    let current = "";
    for (const sentence of paragraph.split(/(?<=[.!?。！？])\s+/)) {
      if (current && current.length + sentence.length + 1 > CHUNK_TARGET_CHARS) {
        pieces.push(current);
        current = "";
      }
      let rest = sentence;
      while (rest.length > CHUNK_TARGET_CHARS) {
        pieces.push(rest.slice(0, CHUNK_TARGET_CHARS));
        rest = rest.slice(CHUNK_TARGET_CHARS);
      }
      current = current ? `${current} ${rest}` : rest;
    }
    if (current) pieces.push(current);
  }

  // Merge short neighbours so passages carry enough context to match on.
  const chunks: string[] = [];
  for (const piece of pieces) {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + piece.length + 2 <= CHUNK_TARGET_CHARS) {
      chunks[chunks.length - 1] = `${last}\n\n${piece}`;
    } else {
      chunks.push(piece);
    }
  }
  return {
    chunks: chunks.slice(0, MAX_CHUNKS_PER_DOCUMENT),
    truncated: chunks.length > MAX_CHUNKS_PER_DOCUMENT,
  };
}
