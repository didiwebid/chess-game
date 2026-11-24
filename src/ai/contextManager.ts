import type {
  AIThread,
  ChatMessage,
  ParsedAiMove,
} from '../types/chess';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => {
    return total + estimateTokens(message.content) + 4;
  }, 0);
}

export function estimateThreadMemoryTokens(thread: AIThread): number {
  let total = estimateTokens(thread.summary);
  for (const turn of thread.turns) {
    total += estimateTokens(turn.user) + estimateTokens(turn.assistant);
  }
  return total;
}

export interface ThreadCompressionResult {
  thread: AIThread;
  compressed: boolean;
  newSummary?: string;
  removedTurns: number;
  cutoffPly: number;
}

export function extractJsonObject(raw: string): string | null {
  const withoutFence = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = withoutFence.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < withoutFence.length; index += 1) {
    const char = withoutFence[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return withoutFence.slice(start, index + 1);
    }
  }
  return null;
}

function decodeJsonishString(raw: string): string {
  return raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

export function extractPartialReasoning(
  content: string,
  providerReasoning = '',
): string {
  if (providerReasoning.trim()) return providerReasoning.trim();
  if (!content) return '';
  const match = /"reasoning"\s*:\s*"/.exec(content);
  if (!match) return '';
  let index = (match.index ?? 0) + match[0].length;
  let result = '';
  let escaped = false;
  while (index < content.length) {
    const char = content[index];
    if (escaped) {
      result += `\\${char}`;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      break;
    } else {
      result += char;
    }
    index += 1;
  }
  return decodeJsonishString(result).trim();
}

export function parseAssistantMove(
  content: string,
): { ok: true; value: ParsedAiMove } | { ok: false; error: string } {
  if (!content.trim()) {
    return { ok: false, error: 'The AI returned an empty response.' };
  }

  const candidate = extractJsonObject(content);
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as {
        move?: unknown;
        reasoning?: unknown;
        confidence?: unknown;
      };
      if (typeof parsed.move === 'string' && parsed.move.trim()) {
        const confidence =
          parsed.confidence === 'high' ||
          parsed.confidence === 'medium' ||
          parsed.confidence === 'low'
            ? parsed.confidence
            : 'medium';
        return {
          ok: true,
          value: {
            move: parsed.move.trim(),
            reasoning:
              typeof parsed.reasoning === 'string'
                ? parsed.reasoning.trim()
                : 'No explanation was provided.',
            confidence,
          },
        };
      }
    } catch {
      // Try a salvaging regex below.
    }
  }

  const moveMatch = /"move"\s*:\s*"([^"]+)"/.exec(content);
  if (moveMatch?.[1]) {
    const reasoning = extractPartialReasoning(content);
    return {
      ok: true,
      value: {
        move: moveMatch[1].trim(),
        reasoning: reasoning || 'No explanation was provided.',
        confidence: 'medium',
      },
    };
  }

  return {
    ok: false,
    error: 'The response did not contain the required JSON move object.',
  };
}

export function buildCorrectionMessage(
  invalidMove: string | null,
  legalMoves: string[],
  reason: string,
): string {
  const shownMove = invalidMove ? `"${invalidMove}"` : 'your response';
  return `Your move ${shownMove} was invalid. ${reason} Legal SAN moves: ${JSON.stringify(
    legalMoves,
  )}. Reply again with ONLY the strict JSON object and a legal move from that list.`;
}

export function compactSummaryText(text: string, maxChars = 2_600): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}…`;
}
