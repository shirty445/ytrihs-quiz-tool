export interface ChunkingOptions {
  targetChunkChars: number;
  overlapChars: number;
  minChunkChars: number;
}

export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  targetChunkChars: 1200,
  overlapChars: 220,
  minChunkChars: 320
};

function splitIntoSentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length === 0) {
    return [text];
  }

  return sentences;
}

function withOverlap(previousChunk: string, overlapChars: number): string {
  if (overlapChars <= 0 || previousChunk.length <= overlapChars) {
    return previousChunk;
  }
  return previousChunk.slice(previousChunk.length - overlapChars);
}

export function chunkText(
  text: string,
  options: ChunkingOptions = DEFAULT_CHUNKING_OPTIONS
): string[] {
  if (text.trim().length === 0) {
    return [];
  }

  const sentences = splitIntoSentences(text);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current.length === 0 ? sentence : `${current} ${sentence}`;

    if (candidate.length <= options.targetChunkChars) {
      current = candidate;
      continue;
    }

    if (current.length >= options.minChunkChars) {
      chunks.push(current.trim());
      current = `${withOverlap(current, options.overlapChars)} ${sentence}`.trim();
      continue;
    }

    // If the sentence itself is very long, hard split it.
    if (sentence.length > options.targetChunkChars) {
      let cursor = 0;
      while (cursor < sentence.length) {
        const slice = sentence.slice(cursor, cursor + options.targetChunkChars).trim();
        if (slice.length > 0) {
          chunks.push(slice);
        }
        cursor += Math.max(options.targetChunkChars - options.overlapChars, 1);
      }
      current = "";
      continue;
    }

    current = candidate;
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}
