export const MAX_SELECTED_TEXT_CHARS = 20_000;
export const MAX_SYNTHESIS_CHUNK_CHARS = 4_000;

export type CaptionGroup = {
  text: string;
  lines: string[];
  startIndex: number;
};

const SENTENCE_PATTERN = /[^.!?\n]+[.!?\n]*/g;

export function splitLongTextChunk(
  text: string,
  maxLength = MAX_SYNTHESIS_CHUNK_CHARS,
) {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];

  const chunks: string[] = [];
  let current = "";

  for (const word of normalized.split(/\s+/)) {
    if (word.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxLength) {
        chunks.push(word.slice(index, index + maxLength));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLength) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function splitTextForSynthesis(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const sentenceChunks =
    trimmed.match(SENTENCE_PATTERN)?.map((chunk) => chunk.trim()) ?? [trimmed];

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentenceChunks) {
    if (!sentence) continue;

    if (sentence.length > MAX_SYNTHESIS_CHUNK_CHARS) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitLongTextChunk(sentence));
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > MAX_SYNTHESIS_CHUNK_CHARS) {
      if (current) chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function buildCaptionGroups(
  chunks: string[],
  splitIntoCaptionLines: (text: string) => string[],
) {
  let lineOffset = 0;

  return chunks.map((chunk) => {
    const lines = splitIntoCaptionLines(chunk);
    const group = { text: chunk, lines, startIndex: lineOffset };
    lineOffset += lines.length;
    return group;
  });
}
