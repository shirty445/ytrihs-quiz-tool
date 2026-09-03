const STOP_WORDS = new Set([
  "the",
  "and",
  "or",
  "to",
  "a",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "is",
  "are",
  "was",
  "were",
  "be",
  "this",
  "that",
  "an",
  "it",
  "as",
  "by",
  "from",
  "can",
  "will",
  "if",
  "not",
  "but",
  "into",
  "about"
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function splitSentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/g)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length === 0) {
    return [text.trim()];
  }
  return sentences;
}

function sentenceScore(sentence: string): number {
  const tokens = tokenize(sentence);
  if (tokens.length === 0) {
    return 0;
  }

  const contentTokens = tokens.filter((token) => !STOP_WORDS.has(token));
  const longTerms = contentTokens.filter((token) => token.length >= 7).length;
  const numericTerms = contentTokens.filter((token) => /\d/.test(token)).length;
  const uppercaseSignals = (sentence.match(/[A-Z]{2,}/g) ?? []).length;

  return contentTokens.length + longTerms * 1.6 + numericTerms * 1.3 + uppercaseSignals * 1.8;
}

export function compressChunkText(text: string, maxChars = 420): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const sentences = splitSentences(normalized).map((sentence, index) => ({
    sentence,
    index,
    score: sentenceScore(sentence)
  }));

  const ranked = [...sentences].sort((a, b) => b.score - a.score);
  const selected = ranked.slice(0, Math.min(4, ranked.length)).sort((a, b) => a.index - b.index);

  let output = "";
  for (const entry of selected) {
    const candidate = output.length === 0 ? entry.sentence : `${output} ${entry.sentence}`;
    if (candidate.length > maxChars) {
      continue;
    }
    output = candidate;
  }

  if (output.length >= Math.min(140, maxChars)) {
    return output.trim();
  }

  return `${normalized.slice(0, maxChars - 3).trim()}...`;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function computeInformationScore(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return 0;
  }

  const unique = new Set(tokens);
  const lexicalDiversity = unique.size / tokens.length;
  const longTerms = tokens.filter((token) => token.length >= 7).length;
  const numericTerms = tokens.filter((token) => /\d/.test(token)).length;
  const headings = (text.match(/\b[A-Z][A-Za-z0-9]+:/g) ?? []).length;

  return tokens.length * 0.6 + lexicalDiversity * 40 + longTerms * 1.1 + numericTerms * 1.4 + headings * 2;
}

export function fingerprintText(text: string): string {
  const tokens = tokenize(text).filter((token) => !STOP_WORDS.has(token));
  if (tokens.length === 0) {
    return "";
  }

  const head = tokens.slice(0, 18).join("|");
  const middleStart = Math.max(0, Math.floor(tokens.length / 2) - 6);
  const middle = tokens.slice(middleStart, middleStart + 12).join("|");
  const tail = tokens.slice(-12).join("|");

  return `${tokens.length}:${head}::${middle}::${tail}`;
}
