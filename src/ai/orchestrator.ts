import { Chess } from 'chess.js';
import type { Color, PlayerConfig } from '../types/chess';
import { useChessStore } from '../store/chessStore';
import {
  buildCompressionMessages,
  buildSystemPrompt,
  buildTurnMessage,
} from './prompts';
import {
  buildCorrectionMessage,
  compactSummaryText,
  estimateMessageTokens,
  estimateTokens,
  parseAssistantMove,
} from './contextManager';
import {
  AiRequestError,
  isAbortError,
  requestChatCompletion,
} from './client';
import { chooseFallbackMove } from '../engine/fallback';
import { normalizeMoveInput } from '../engine/chessUtils';

const activeRequests = new Map<Color, AbortController>();
const MAX_ATTEMPTS = 3;

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortableError(error: unknown): boolean {
  return isAbortError(error);
}

export function abortAiTurn(color: Color, options?: { hold?: boolean }): void {
  const controller = activeRequests.get(color);
  if (controller) {
    controller.abort();
    activeRequests.delete(color);
  }
  const store = useChessStore.getState();
  store.endThinking(color);
  store.setStream(color, '', '');
  if (options?.hold) store.setAiHold(color, true);
}

export function abortAllAiTurns(): void {
  for (const color of ['white', 'black'] as const) {
    abortAiTurn(color);
  }
}

function isStillActive(
  color: Color,
  version: number,
  fen: string,
  requestSignal: AbortSignal,
): boolean {
  if (requestSignal.aborted) return false;
  const state = useChessStore.getState();
  return (
    state.gameVersion === version &&
    state.fen === fen &&
    state.turn === color &&
    state.players[color].controller === 'ai' &&
    state.status.result === 'ongoing'
  );
}

async function summarizeOldMoves(options: {
  config: PlayerConfig;
  oldMoves: string[];
  fen: string;
  existingSummary: string;
  signal: AbortSignal;
}): Promise<string> {
  const { config, oldMoves, fen, existingSummary, signal } = options;
  try {
    const result = await requestChatCompletion({
      config: {
        ...config,
        stream: false,
        maxTokens: Math.max(180, Math.min(480, config.maxTokens)),
        timeoutMs: Math.min(config.timeoutMs, 15_000),
      },
      messages: buildCompressionMessages({ oldMoves, fen, existingSummary }),
      signal,
    });
    if (result.content.trim()) {
      return compactSummaryText(result.content);
    }
    throw new Error('The summarizer returned an empty response.');
  } catch (error) {
    if (signal.aborted || abortableError(error)) throw error;
    const fallback = [
      existingSummary,
      `Earlier game moves (compressed during a provider interruption): ${oldMoves.join(' ')}`,
    ]
      .filter(Boolean)
      .join('\n')
      .trim();
    return compactSummaryText(fallback);
  }
}

function threadMessages(
  thread: { summary: string; turns: Array<{ user: string; assistant: string }> },
  systemPrompt: string,
  currentUser: string,
) {
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...thread.turns.flatMap((turn) => [
      { role: 'user' as const, content: turn.user },
      { role: 'assistant' as const, content: turn.assistant },
    ]),
    { role: 'user' as const, content: currentUser },
  ];
  return messages;
}

export async function requestAiTurn(color: Color): Promise<void> {
  if (activeRequests.has(color)) return;

  const initial = useChessStore.getState();
  if (
    initial.status.result !== 'ongoing' ||
    initial.turn !== color ||
    initial.players[color].controller !== 'ai' ||
    initial.thinking[color]
  ) {
    return;
  }

  const requestController = new AbortController();
  activeRequests.set(color, requestController);
  const signal = requestController.signal;
  const requestVersion = initial.gameVersion;
  const requestFen = initial.fen;
  const startedAt = Date.now();
  const player = initial.players[color];
  const opponent = initial.players[color === 'white' ? 'black' : 'white'];
  const config = player.config;

  initial.beginThinking(color);

  let thinkingFinished = false;
  const finishThinking = () => {
    if (thinkingFinished) return;
    thinkingFinished = true;
    useChessStore.getState().endThinking(color);
  };

  try {
    let chess: Chess;
    try {
      chess = new Chess(requestFen);
    } catch {
      throw new Error('The current position is invalid.');
    }

    if (!config.baseUrl.trim() || !config.model.trim()) {
      throw new AiRequestError(
        'Finish this AI player’s endpoint settings before it can move.',
      );
    }

    const legalMoves = chess.moves();
    if (legalMoves.length === 0) {
      finishThinking();
      return;
    }

    const fullMoveNumber = Math.floor(initial.moves.length / 2) + 1;
    const lastSan = initial.moves.at(-1)?.san ?? null;
    const recentMoves = initial.moves
      .slice(-Math.max(12, Math.min(30, config.context.keepLastNPlies)))
      .map((move) => move.san);
    const systemPrompt = buildSystemPrompt(player, opponent, color, config);

    const buildCurrentUser = (summary: string) =>
      buildTurnMessage({
        fen: requestFen,
        color,
        moveNumber: fullMoveNumber,
        lastMoveSan: lastSan,
        legalMoves,
        recentMoves,
        summary,
      });

    let thread = useChessStore.getState().threads[color];
    let currentUser = buildCurrentUser(thread.summary);
    let messages = threadMessages(thread, systemPrompt, currentUser);
    let estimatedTokens = estimateMessageTokens(messages);
    const contextBudget = config.context.maxTokens;
    const threshold =
      contextBudget * Math.min(0.98, Math.max(0.5, config.context.thresholdRatio));

    if (estimatedTokens >= threshold) {
      const keep = config.context.keepLastNPlies;
      const cutoffPly = Math.max(0, initial.moves.length - keep);
      if (
        cutoffPly > thread.summaryThroughPly &&
        initial.moves.length > 0
      ) {
        const oldMoves = initial.moves
          .slice(thread.summaryThroughPly, cutoffPly)
          .map((move) => move.san);
        if (oldMoves.length > 0) {
          const summary = await summarizeOldMoves({
            config,
            oldMoves,
            fen: requestFen,
            existingSummary: thread.summary,
            signal,
          });
          if (!isStillActive(color, requestVersion, requestFen, signal)) return;

          thread = {
            summary,
            summaryThroughPly: cutoffPly,
            turns: thread.turns.filter((turn) => turn.ply > cutoffPly),
          };
          useChessStore.getState().setThread(color, thread);
          currentUser = buildCurrentUser(thread.summary);
          messages = threadMessages(thread, systemPrompt, currentUser);
          estimatedTokens = estimateMessageTokens(messages);
        }
      }

      // Emergency compression: if the recent prompts themselves still exceed
      // the budget, discard the oldest verbatim turns before touching the
      // summary. The latest exchanges are the most useful for continuity.
      if (estimatedTokens >= threshold && thread.turns.length > 0) {
        let turns = [...thread.turns];
        while (turns.length > 0 && estimatedTokens >= threshold * 0.92) {
          turns = turns.slice(1);
          const testThread = { ...thread, turns };
          estimatedTokens = estimateMessageTokens(
            threadMessages(testThread, systemPrompt, currentUser),
          );
        }
        if (turns.length !== thread.turns.length) {
          thread = { ...thread, turns };
          currentUser = buildCurrentUser(thread.summary);
          useChessStore.getState().setThread(color, thread);
          messages = threadMessages(thread, systemPrompt, currentUser);
        }
      }

      // Last resort: cap the stored narrative itself.
      if (estimatedTokens >= contextBudget) {
        const overhead =
          estimateTokens(systemPrompt) + estimateTokens(currentUser) + 32;
        const availableChars = Math.max(200, (contextBudget - overhead) * 4);
        if (thread.summary.length > availableChars) {
          thread = {
            ...thread,
            summary: `${thread.summary.slice(0, availableChars)}…`,
          };
          currentUser = buildCurrentUser(thread.summary);
          useChessStore.getState().setThread(color, thread);
          messages = threadMessages(thread, systemPrompt, currentUser);
        }
      }
    }

    let lastFailure = 'The AI did not return a usable move.';
    let rawAssistantContent = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (!isStillActive(color, requestVersion, requestFen, signal)) return;

      useChessStore.getState().setStream(color, '', '');
      let result;
      try {
        result = await requestChatCompletion({
          config,
          messages,
          signal,
          onDelta: ({ content, reasoning }) => {
            useChessStore.getState().setStream(color, content, reasoning);
          },
        });
      } catch (error) {
        if (signal.aborted || abortableError(error)) return;
        const message =
          error instanceof Error ? error.message : 'The AI request failed.';
        lastFailure = message;
        const retryable =
          error instanceof AiRequestError ? error.retryable : true;
        if (!retryable || attempt === MAX_ATTEMPTS) break;
        try {
          await abortableSleep(320 * 2 ** (attempt - 1), signal);
        } catch (sleepError) {
          if (abortableError(sleepError)) return;
          throw sleepError;
        }
        continue;
      }

      if (!isStillActive(color, requestVersion, requestFen, signal)) return;

      rawAssistantContent = result.content.trim();
      const parsed = parseAssistantMove(result.content);
      if (!parsed.ok) {
        lastFailure = parsed.error;
        if (attempt === MAX_ATTEMPTS) break;
        messages = [
          ...messages,
          { role: 'assistant', content: result.content || '(empty response)' },
          {
            role: 'user',
            content: buildCorrectionMessage(null, legalMoves, parsed.error),
          },
        ];
        continue;
      }

      const normalized = normalizeMoveInput(parsed.value.move, requestFen);
      if (!normalized) {
        lastFailure = `The AI proposed ${parsed.value.move}, which is not a legal move in this position.`;
        if (attempt === MAX_ATTEMPTS) break;
        messages = [
          ...messages,
          { role: 'assistant', content: result.content },
          {
            role: 'user',
            content: buildCorrectionMessage(
              parsed.value.move,
              legalMoves,
              'It is not in the legal move list.',
            ),
          },
        ];
        continue;
      }

      const elapsedMs = Date.now() - startedAt;
      const commit = useChessStore.getState().commitAiMove(
        color,
        normalized,
        {
          provider: config.baseUrl,
          model: config.model,
          reasoning: parsed.value.reasoning,
          confidence: parsed.value.confidence,
          fallback: false,
          elapsedMs,
        },
        requestVersion,
        requestFen,
      );

      if (!commit.ok || !commit.record) {
        if (!isStillActive(color, requestVersion, requestFen, signal)) return;
        lastFailure = commit.error ?? 'The move could not be applied.';
        break;
      }

      useChessStore.getState().appendThreadTurn(color, {
        ply: commit.record.ply,
        user: currentUser,
        assistant:
          rawAssistantContent ||
          JSON.stringify({
            move: parsed.value.move,
            reasoning: parsed.value.reasoning,
            confidence: parsed.value.confidence,
          }),
      });
      return;
    }

    if (!isStillActive(color, requestVersion, requestFen, signal)) return;

    // The game must never stall because an endpoint failed or returned junk.
    const fallbackSan = chooseFallbackMove(requestFen);
    if (!fallbackSan) {
      useChessStore.getState().setAiHold(color, true);
      finishThinking();
      return;
    }

    const fallbackReasoning =
      'The AI endpoint could not provide a validated move, so the local chess engine chose a deterministic legal fallback.';
    const fallbackMessage = lastFailure.slice(0, 320);
    const commit = useChessStore.getState().commitAiMove(
      color,
      fallbackSan,
      {
        provider: config.baseUrl,
        model: config.model,
        reasoning: fallbackReasoning,
        confidence: 'low',
        fallback: true,
        elapsedMs: Date.now() - startedAt,
      },
      requestVersion,
      requestFen,
    );

    if (commit.ok && commit.record) {
      useChessStore.getState().appendThreadTurn(color, {
        ply: commit.record.ply,
        user: currentUser,
        assistant: JSON.stringify({
          move: fallbackSan,
          reasoning: fallbackReasoning,
          confidence: 'low',
        }),
      });
      useChessStore.getState().setAiError(color, {
        message: 'AI request failed — a legal fallback move was played.',
        detail: fallbackMessage,
        at: Date.now(),
      });
      useChessStore.getState().notify(
        `${player.name}: AI request failed. Played a fallback move (${fallbackSan}). Check the AI settings.`,
        'warning',
      );
    } else {
      useChessStore.getState().setAiError(color, {
        message: 'AI request failed.',
        detail: fallbackMessage,
        at: Date.now(),
      });
      if (isStillActive(color, requestVersion, requestFen, signal)) {
        useChessStore.getState().setAiHold(color, true);
      }
    }
  } catch (error) {
    if (signal.aborted || abortableError(error)) return;
    const message =
      error instanceof Error ? error.message : 'An unexpected AI error occurred.';
    useChessStore.getState().setAiError(color, {
      message: 'The AI turn could not be completed.',
      detail: message.slice(0, 500),
      at: Date.now(),
    });
    useChessStore.getState().setAiHold(color, true);
    useChessStore
      .getState()
      .notify(`${player.name}: ${message}`, 'error');
  } finally {
    finishThinking();
    if (activeRequests.get(color) === requestController) {
      activeRequests.delete(color);
    }
  }
}
