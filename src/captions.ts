import { CAPTION_LINE_WIDTH } from "./appConstants";

export const splitIntoCaptionLines = (text: string) => {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return [text];

  context.font =
    '520 13px "Instrument Sans Variable", "Instrument Sans", "Segoe UI Variable", sans-serif';
  const fits = (value: string) =>
    context.measureText(value).width <= CAPTION_LINE_WIDTH;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  const pushLongWord = (word: string) => {
    let segment = "";
    for (const character of word) {
      if (segment && !fits(segment + character)) {
        lines.push(segment);
        segment = character;
      } else {
        segment += character;
      }
    }
    currentLine = segment;
  };

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (fits(candidate)) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = "";
    }

    if (fits(word)) currentLine = word;
    else pushLongWord(word);
  }

  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [text];
};
