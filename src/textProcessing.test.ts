import { describe, expect, it } from "vitest";
import {
  buildCaptionGroups,
  MAX_SYNTHESIS_CHUNK_CHARS,
  splitLongTextChunk,
  splitTextForSynthesis,
} from "./textProcessing";

describe("text processing", () => {
  it("returns no chunks for empty text", () => {
    expect(splitTextForSynthesis("   ")).toEqual([]);
  });

  it("packs adjacent sentences into continuous synthesis chunks", () => {
    expect(splitTextForSynthesis("Hello there. How are you?")).toEqual([
      "Hello there. How are you?",
    ]);
  });

  it("keeps synthesis chunks within the bounded size", () => {
    const sentence = "This is a sentence. ";
    const chunks = splitTextForSynthesis(sentence.repeat(300));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= MAX_SYNTHESIS_CHUNK_CHARS)).toBe(
      true,
    );
  });

  it("splits long text at bounded chunk sizes", () => {
    const chunks = splitLongTextChunk(
      "alpha ".repeat(1_000),
      MAX_SYNTHESIS_CHUNK_CHARS,
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= MAX_SYNTHESIS_CHUNK_CHARS)).toBe(
      true,
    );
  });

  it("tracks caption line offsets across chunks", () => {
    const groups = buildCaptionGroups(["first", "second"], (text) => [
      text,
      `${text} tail`,
    ]);

    expect(groups).toEqual([
      { text: "first", lines: ["first", "first tail"], startIndex: 0 },
      { text: "second", lines: ["second", "second tail"], startIndex: 2 },
    ]);
  });
});
