import { describe, expect, it } from "vitest";
import {
  CHUNK_TARGET_CHARS,
  chunkText,
  MAX_CHUNKS_PER_DOCUMENT,
  searchQuerySchema,
} from "@/features/knowledge/schemas/knowledge";

describe("chunkText", () => {
  it("merges short paragraphs and keeps order", () => {
    const { chunks, truncated } = chunkText("First paragraph.\n\nSecond paragraph.\n\nThird.");
    expect(chunks).toEqual(["First paragraph.\n\nSecond paragraph.\n\nThird."]);
    expect(truncated).toBe(false);
  });

  it("never exceeds the target size, splitting on sentences then hard cuts", () => {
    const sentence = "This is a sentence of moderate length that repeats. ";
    const long = sentence.repeat(60);
    const unbroken = "x".repeat(CHUNK_TARGET_CHARS * 2 + 10);
    for (const text of [long, unbroken, `${long}\n\n${unbroken}`]) {
      const { chunks } = chunkText(text);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((chunk) => chunk.length <= CHUNK_TARGET_CHARS)).toBe(true);
      expect(chunks.join("").replace(/\s+/g, "").length).toBe(text.replace(/\s+/g, "").length);
    }
  });

  it("handles empty input, CRLF, and caps the number of passages", () => {
    expect(chunkText("  \n\n \r\n ").chunks).toEqual([]);
    expect(chunkText("a\r\n\r\nb").chunks).toEqual(["a\n\nb"]);
    const many = Array.from(
      { length: MAX_CHUNKS_PER_DOCUMENT + 20 },
      (_, i) => `${"p".repeat(CHUNK_TARGET_CHARS - 5)}${i}`,
    ).join("\n\n");
    const result = chunkText(many);
    expect(result.chunks).toHaveLength(MAX_CHUNKS_PER_DOCUMENT);
    expect(result.truncated).toBe(true);
  });

  it("splits Japanese text on sentence punctuation", () => {
    const text = "これは文です。".repeat(200);
    const { chunks } = chunkText(text);
    expect(chunks.every((chunk) => chunk.length <= CHUNK_TARGET_CHARS)).toBe(true);
  });
});

describe("searchQuerySchema", () => {
  it("trims and bounds queries", () => {
    expect(searchQuerySchema.parse("  budget  ")).toBe("budget");
    expect(searchQuerySchema.safeParse("a").success).toBe(false);
    expect(searchQuerySchema.safeParse("x".repeat(201)).success).toBe(false);
  });
});
