import { create } from 'zustand';
import { Chess } from 'chess.js';
import type { Move, Square } from 'chess.js';
import type {
  AIThread,
  AiErrorInfo,
  AiMeta,
  Color,
  Controller,
  GameStatus,
  LoadedGameData,
  MoveRecord,
  Player,
  PlayerConfigPatch,
  Result,
  Scoreboard,
  ThreadTurn,
  Toast,
  ToastKind,
} from '../types/chess';
import {
  START_FEN,
  colorFromTurn,
  countRepetitions,
  deriveStatus,
  findKingSquare,
  moveToRecord,
  opposite,
} from '../engine/chessUtils';
import {
  createEmptyThread,
  createInitialPlayers,
  createInitialThreads,
  mergeConfig,
  sanitizeConfig,
} from './defaults';
import { setApiKey } from '../persistence/apiKeys';
import {
  createEmptyScoreboard,
  loadScoreboard,
  saveScoreboard,
} from '../persistence/scoreboard';

export type SidebarTab = 'moves' | 'thinking' | 'game';

interface MoveResult {
  ok: boolean;
  record?: MoveRecord;
  error?: string;
}

interface RestoreResult {
  ok: boolean;
  error?: string;
}

interface ChessStore {
  initialFen: string;
  fen: string;
  snapshots: string[];
  turn: Color;
  moves: MoveRecord[];
  lastMove: MoveRecord | null;
  status: GameStatus;
  /** Times the current position has occurred (FIDE repetition rules). */
  repetitionCount: number;
  inCheck: boolean;
  checkSquare: Square | null;
  gameVersion: number;

  players: Record<Color, Player>;
  threads: Record<Color, AIThread>;
  thinking: Record<Color, boolean>;
  thinkingStartedAt: Record<Color, number | null>;
  streamRaw: Record<Color, string>;
  streamReasoning: Record<Color, string>;
  aiErrors: Record<Color, AiErrorInfo | null>;

  orientation: Color;
  showThinking: boolean;
  showCoordinates: boolean;
  sidebarTab: SidebarTab;
  viewPly: number | null;
  aiPaused: boolean;
  aiHold: Record<Color, boolean>;
  aiDelayMs: number;
  drawOffer: { by: Color } | null;
  toasts: Toast[];

  scoreboard: Scoreboard;
  scoredCurrentGame: boolean;

  notify: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;

  newGame: () => void;
  resetAll: () => void;
  resetScoreboard: () => void;
  restoreGame: (data: LoadedGameData) => RestoreResult;
  makeMove: (input: {
    from: Square;
    to: Square;
    promotion?: 'q' | 'r' | 'b' | 'n';
  }) => MoveResult;
  commitAiMove: (
    color: Color,
    san: string,
    meta: AiMeta,
    expectedVersion?: number,
    expectedFen?: string,
  ) => MoveResult;
  undo: () => void;
  resign: (color: Color) => void;
  agreeDraw: () => void;
  claimRepetitionDraw: () => void;
  offerDraw: (by: Color) => void;
  clearDrawOffer: () => void;

  setPlayerName: (color: Color, name: string) => void;
  setPlayerController: (
    color: Color,
    controller: Controller,
    options?: { clearMemory?: boolean },
  ) => void;
  updatePlayerConfig: (color: Color, patch: PlayerConfigPatch) => void;
  appendThreadTurn: (color: Color, turn: ThreadTurn) => void;
  setThread: (color: Color, thread: AIThread) => void;
  clearMemory: (color: Color) => void;

  beginThinking: (color: Color) => void;
  setStream: (color: Color, raw: string, reasoning: string) => void;
  endThinking: (color: Color) => void;
  setAiError: (color: Color, error: AiErrorInfo | null) => void;

  flipBoard: () => void;
  setOrientation: (orientation: Color) => void;
  setShowThinking: (show: boolean) => void;
  setShowCoordinates: (show: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setViewPly: (ply: number | null) => void;
  setAiPaused: (paused: boolean) => void;
  setAiHold: (color: Color, hold: boolean) => void;
  setAiDelayMs: (delay: number) => void;
}

let engine = new Chess();
let toastSequence = 0;

const initialStatus: GameStatus = { result: 'ongoing', reason: '' };

function createThinkingState(): Record<Color, boolean> {
  return { white: false, black: false };
}

function createTimestampState(): Record<Color, number | null> {
  return { white: null, black: null };
}

function createStringState(): Record<Color, string> {
  return { white: '', black: '' };
}

function createErrorState(): Record<Color, AiErrorInfo | null> {
  return { white: null, black: null };
}

/** Apply a finished game's result to the scoreboard. */
function applyResultToScoreboard(
  scoreboard: Scoreboard,
  result: Result,
): Scoreboard {
  const next: Scoreboard = {
    white: { ...scoreboard.white },
    black: { ...scoreboard.black },
  };
  if (result === 'draw') {
    next.white.draws += 1;
    next.black.draws += 1;
  } else if (result === 'white' || result === 'black') {
    next[result].wins += 1;
    next[opposite(result)].losses += 1;
  }
  return next;
}

/** Reverse a previously applied result (used when an ended game is undone). */
function revertResultFromScoreboard(
  scoreboard: Scoreboard,
  result: Result,
): Scoreboard {
  const next: Scoreboard = {
    white: { ...scoreboard.white },
    black: { ...scoreboard.black },
  };
  if (result === 'draw') {
    next.white.draws = Math.max(0, next.white.draws - 1);
    next.black.draws = Math.max(0, next.black.draws - 1);
  } else if (result === 'white' || result === 'black') {
    next[result].wins = Math.max(0, next[result].wins - 1);
    next[opposite(result)].losses = Math.max(
      0,
      next[opposite(result)].losses - 1,
    );
  }
  return next;
}

function normalizeThread(thread: AIThread | undefined, maxPly: number): AIThread {
  if (!thread) return createEmptyThread();
  const turns = Array.isArray(thread.turns)
    ? thread.turns
        .filter(
          (turn): turn is ThreadTurn =>
            !!turn &&
            typeof turn.user === 'string' &&
            typeof turn.assistant === 'string' &&
            typeof turn.ply === 'number',
        )
        .filter((turn) => turn.ply <= maxPly)
        .slice(-200)
    : [];
  return {
    summary: typeof thread.summary === 'string' ? thread.summary : '',
    summaryThroughPly:
      typeof thread.summaryThroughPly === 'number'
        ? Math.max(0, Math.min(thread.summaryThroughPly, maxPly))
        : 0,
    turns,
  };
}

export const useChessStore = create<ChessStore>((set, get) => ({
  initialFen: START_FEN,
  fen: START_FEN,
  snapshots: [START_FEN],
  turn: 'white',
  moves: [],
  lastMove: null,
  status: initialStatus,
  repetitionCount: 1,
  inCheck: false,
  checkSquare: null,
  gameVersion: 0,

  players: createInitialPlayers(),
  threads: createInitialThreads(),
  thinking: createThinkingState(),
  thinkingStartedAt: createTimestampState(),
  streamRaw: createStringState(),
  streamReasoning: createStringState(),
  aiErrors: createErrorState(),

  orientation: 'white',
  showThinking: true,
  showCoordinates: true,
  sidebarTab: 'moves',
  viewPly: null,
  aiPaused: false,
  aiHold: { white: false, black: false },
  aiDelayMs: 800,
  drawOffer: null,
  toasts: [],

  scoreboard: loadScoreboard(),
  scoredCurrentGame: false,

  notify: (message, kind = 'info') => {
    const id = (toastSequence += 1);
    set((state) => ({
      toasts: [...state.toasts, { id, message, kind }].slice(-5),
    }));
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  newGame: () => {
    engine = new Chess();
    const fen = engine.fen();
    set((state) => ({
      initialFen: fen,
      fen,
      snapshots: [fen],
      turn: colorFromTurn(engine.turn()),
      moves: [],
      lastMove: null,
      status: initialStatus,
      repetitionCount: 1,
      inCheck: false,
      checkSquare: null,
      gameVersion: state.gameVersion + 1,
      threads: createInitialThreads(),
      thinking: createThinkingState(),
      thinkingStartedAt: createTimestampState(),
      streamRaw: createStringState(),
      streamReasoning: createStringState(),
      aiErrors: createErrorState(),
      viewPly: null,
      drawOffer: null,
      aiPaused: false,
      aiHold: { white: false, black: false },
      sidebarTab: 'moves',
      scoredCurrentGame: false,
    }));
  },

  resetScoreboard: () => {
    const empty = createEmptyScoreboard();
    set({ scoreboard: empty, scoredCurrentGame: false });
    saveScoreboard(empty);
  },

  resetAll: () => {
    engine = new Chess();
    const fen = engine.fen();
    set((state) => ({
      initialFen: fen,
      fen,
      snapshots: [fen],
      turn: 'white',
      moves: [],
      lastMove: null,
      status: initialStatus,
      repetitionCount: 1,
      inCheck: false,
      checkSquare: null,
      gameVersion: state.gameVersion + 1,
      players: createInitialPlayers(),
      threads: createInitialThreads(),
      thinking: createThinkingState(),
      thinkingStartedAt: createTimestampState(),
      streamRaw: createStringState(),
      streamReasoning: createStringState(),
      aiErrors: createErrorState(),
      orientation: 'white',
      showThinking: true,
      sidebarTab: 'moves',
      viewPly: null,
      aiPaused: false,
      aiHold: { white: false, black: false },
      aiDelayMs: 800,
      drawOffer: null,
      scoredCurrentGame: false,
    }));
  },

  restoreGame: (data) => {
    let nextEngine: Chess;
    try {
      nextEngine = new Chess(data.initialFen || START_FEN);
    } catch {
      return { ok: false, error: 'The saved starting position is invalid.' };
    }

    const snapshots: string[] = [nextEngine.fen()];
    const records: MoveRecord[] = [];

    try {
      data.moves.forEach((saved, index) => {
        const move = nextEngine.move(saved.san);
        if (!move) {
          throw new Error(`Move ${index + 1} (${saved.san}) is not legal.`);
        }
        const record = moveToRecord(move, saved.controller ?? 'human', {
          provider: saved.provider,
          model: saved.model,
          reasoning: saved.reasoning,
          confidence: saved.confidence,
          fallback: saved.fallback,
          pv: saved.pv,
          elapsedMs: saved.elapsedMs,
        });
        record.ply = index + 1;
        record.timestamp = saved.timestamp || new Date().toISOString();
        records.push(record);
        snapshots.push(nextEngine.fen());
      });
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `This game's move history could not be replayed: ${error.message}`
            : 'This game could not be replayed.',
      };
    }

    const finalFen = nextEngine.fen();
    if (data.fen && data.fen !== finalFen) {
      return {
        ok: false,
        error: 'The saved FEN does not match the saved move history.',
      };
    }

    const nextRepetitionCount = countRepetitions(
      snapshots[0] ?? START_FEN,
      records.map((record) => record.san),
    );
    const derived = deriveStatus(nextEngine, nextRepetitionCount);
    const validSavedResult =
      data.status &&
      ['ongoing', 'white', 'black', 'draw'].includes(data.status.result) &&
      typeof data.status.reason === 'string';
    const nextStatus: GameStatus =
      derived.result !== 'ongoing'
        ? derived
        : validSavedResult && data.status.result !== 'ongoing'
          ? data.status
          : initialStatus;

    const maxPly = records.length;
    const nextPlayers: Record<Color, Player> = {
      white: {
        ...data.players.white,
        name: (data.players.white.name || 'White').slice(0, 40),
        config: sanitizeConfig(data.players.white.config),
      },
      black: {
        ...data.players.black,
        name: (data.players.black.name || 'Black').slice(0, 40),
        config: sanitizeConfig(data.players.black.config),
      },
    };

    engine = nextEngine;
    set((state) => ({
      initialFen: snapshots[0] ?? START_FEN,
      fen: finalFen,
      snapshots,
      turn: colorFromTurn(nextEngine.turn()),
      moves: records,
      lastMove: records.length > 0 ? records[records.length - 1] : null,
      status: nextStatus,
      repetitionCount: nextRepetitionCount,
      inCheck: nextEngine.isCheck(),
      checkSquare:
        nextStatus.result === 'ongoing' && nextEngine.isCheck()
          ? findKingSquare(finalFen, colorFromTurn(nextEngine.turn()))
          : null,
      gameVersion: state.gameVersion + 1,
      players: nextPlayers,
      threads: {
        white: normalizeThread(data.threads.white, maxPly),
        black: normalizeThread(data.threads.black, maxPly),
      },
      thinking: createThinkingState(),
      thinkingStartedAt: createTimestampState(),
      streamRaw: createStringState(),
      streamReasoning: createStringState(),
      aiErrors: createErrorState(),
      orientation: data.orientation === 'black' ? 'black' : 'white',
      viewPly: null,
      drawOffer: null,
      aiPaused: false,
      aiHold: { white: false, black: false },
      sidebarTab: 'moves',
      scoredCurrentGame: false,
    }));

    return { ok: true };
  },

  makeMove: (input) => {
    const state = get();
    if (state.status.result !== 'ongoing') {
      return { ok: false, error: 'The game is over.' };
    }
    if (state.players[state.turn].controller !== 'human') {
      return { ok: false, error: 'It is not a human turn.' };
    }
    if (state.viewPly !== null) {
      return { ok: false, error: 'Return to the live position to move.' };
    }

    let move: Move;
    try {
      move = engine.move(input);
    } catch {
      return { ok: false, error: 'That move is not legal.' };
    }

    const snapshot = engine.fen();
    const nextTurn = colorFromTurn(engine.turn());
    const record = moveToRecord(move, 'human');
    record.ply = state.moves.length + 1;
    const nextMoves = [...state.moves, record];
    const nextRepetitionCount = countRepetitions(
      state.initialFen,
      nextMoves.map((moveRecord) => moveRecord.san),
    );
    const nextStatus = deriveStatus(engine, nextRepetitionCount);

    const gameJustEnded = nextStatus.result !== 'ongoing';
    const nextScoreboard =
      gameJustEnded && !state.scoredCurrentGame
        ? applyResultToScoreboard(state.scoreboard, nextStatus.result)
        : state.scoreboard;

    set({
      fen: snapshot,
      snapshots: [...state.snapshots, snapshot],
      turn: nextTurn,
      moves: nextMoves,
      lastMove: record,
      status: nextStatus,
      repetitionCount: nextRepetitionCount,
      inCheck: engine.isCheck(),
      checkSquare:
        nextStatus.result === 'ongoing' && engine.isCheck()
          ? findKingSquare(snapshot, nextTurn)
          : null,
      gameVersion: state.gameVersion + 1,
      viewPly: null,
      drawOffer: null,
      scoreboard: nextScoreboard,
      scoredCurrentGame: gameJustEnded ? true : state.scoredCurrentGame,
      thinking: { ...state.thinking, [record.color]: false },
      thinkingStartedAt: { ...state.thinkingStartedAt, [record.color]: null },
      streamRaw: { ...state.streamRaw, [record.color]: '' },
      streamReasoning: { ...state.streamReasoning, [record.color]: '' },
    });

    if (nextScoreboard !== state.scoreboard) saveScoreboard(nextScoreboard);

    return { ok: true, record };
  },

  commitAiMove: (color, san, meta, expectedVersion, expectedFen) => {
    const state = get();
    if (state.status.result !== 'ongoing') {
      return { ok: false, error: 'The game is over.' };
    }
    if (state.turn !== color) {
      return { ok: false, error: 'The turn changed before the AI move arrived.' };
    }
    if (state.players[color].controller !== 'ai') {
      return { ok: false, error: 'This player is no longer controlled by an AI.' };
    }
    if (
      typeof expectedVersion === 'number' &&
      state.gameVersion !== expectedVersion
    ) {
      return { ok: false, error: 'The game changed while the AI was thinking.' };
    }
    if (expectedFen && state.fen !== expectedFen) {
      return { ok: false, error: 'The position changed while the AI was thinking.' };
    }

    let move: Move;
    try {
      move = engine.move(san);
    } catch {
      return { ok: false, error: 'The AI produced an illegal move.' };
    }

    const snapshot = engine.fen();
    const nextTurn = colorFromTurn(engine.turn());
    const record = moveToRecord(move, 'ai', meta);
    record.ply = state.moves.length + 1;
    const nextMoves = [...state.moves, record];
    const nextRepetitionCount = countRepetitions(
      state.initialFen,
      nextMoves.map((moveRecord) => moveRecord.san),
    );
    const nextStatus = deriveStatus(engine, nextRepetitionCount);

    const gameJustEnded = nextStatus.result !== 'ongoing';
    const nextScoreboard =
      gameJustEnded && !state.scoredCurrentGame
        ? applyResultToScoreboard(state.scoreboard, nextStatus.result)
        : state.scoreboard;

    set({
      fen: snapshot,
      snapshots: [...state.snapshots, snapshot],
      turn: nextTurn,
      moves: nextMoves,
      lastMove: record,
      status: nextStatus,
      repetitionCount: nextRepetitionCount,
      inCheck: engine.isCheck(),
      checkSquare:
        nextStatus.result === 'ongoing' && engine.isCheck()
          ? findKingSquare(snapshot, nextTurn)
          : null,
      gameVersion: state.gameVersion + 1,
      drawOffer: null,
      scoreboard: nextScoreboard,
      scoredCurrentGame: gameJustEnded ? true : state.scoredCurrentGame,
      thinking: { ...state.thinking, [color]: false },
      thinkingStartedAt: { ...state.thinkingStartedAt, [color]: null },
      streamRaw: { ...state.streamRaw, [color]: '' },
      streamReasoning: { ...state.streamReasoning, [color]: '' },
    });

    if (nextScoreboard !== state.scoreboard) saveScoreboard(nextScoreboard);

    return { ok: true, record };
  },

  undo: () => {
    const state = get();
    if (state.moves.length === 0) return;

    try {
      engine.undo();
    } catch {
      return;
    }

    const nextMoves = state.moves.slice(0, -1);
    const snapshots = state.snapshots.slice(0, -1);
    const remainingPly = nextMoves.length;
    const nextTurn = colorFromTurn(engine.turn());
    const nextPlayerIsAi = state.players[nextTurn].controller === 'ai';
    const threads = { ...state.threads };
    for (const color of ['white', 'black'] as const) {
      const thread = threads[color];
      threads[color] = {
        ...thread,
        summary: thread.summaryThroughPly > remainingPly ? '' : thread.summary,
        summaryThroughPly:
          thread.summaryThroughPly > remainingPly
            ? 0
            : thread.summaryThroughPly,
        turns: thread.turns.filter((turn) => turn.ply <= remainingPly),
      };
    }

    const nextRepetitionCount = countRepetitions(
      state.initialFen,
      nextMoves.map((moveRecord) => moveRecord.san),
    );
    const nextStatus = deriveStatus(engine, nextRepetitionCount);
    const gameJustEnded = nextStatus.result !== 'ongoing';

    const wasScored = state.scoredCurrentGame;
    const revertedScoreboard = wasScored
      ? revertResultFromScoreboard(state.scoreboard, state.status.result)
      : state.scoreboard;
    const nextScoreboard = gameJustEnded
      ? applyResultToScoreboard(revertedScoreboard, nextStatus.result)
      : revertedScoreboard;

    set({
      fen: engine.fen(),
      snapshots,
      turn: nextTurn,
      moves: nextMoves,
      lastMove: nextMoves[nextMoves.length - 1] ?? null,
      status: nextStatus,
      repetitionCount: nextRepetitionCount,
      inCheck: engine.isCheck(),
      checkSquare:
        engine.isCheck()
          ? findKingSquare(engine.fen(), nextTurn)
          : null,
      gameVersion: state.gameVersion + 1,
      threads,
      scoreboard: nextScoreboard,
      scoredCurrentGame: gameJustEnded,
      thinking: createThinkingState(),
      thinkingStartedAt: createTimestampState(),
      streamRaw: createStringState(),
      streamReasoning: createStringState(),
      aiErrors: createErrorState(),
      viewPly: null,
      drawOffer: null,
      aiPaused: false,
      aiHold: { white: nextPlayerIsAi && nextTurn === 'white', black: nextPlayerIsAi && nextTurn === 'black' },
    });

    if (nextScoreboard !== state.scoreboard) saveScoreboard(nextScoreboard);
  },

  resign: (color) => {
    const state = get();
    if (state.status.result !== 'ongoing') return;
    const result = opposite(color);
    const nextScoreboard = state.scoredCurrentGame
      ? state.scoreboard
      : applyResultToScoreboard(state.scoreboard, result);
    set({
      status: {
        result,
        reason: `${state.players[color].name} resigned`,
      },
      gameVersion: state.gameVersion + 1,
      scoreboard: nextScoreboard,
      scoredCurrentGame: true,
      thinking: createThinkingState(),
      thinkingStartedAt: createTimestampState(),
      streamRaw: createStringState(),
      streamReasoning: createStringState(),
      drawOffer: null,
    });
    if (nextScoreboard !== state.scoreboard) saveScoreboard(nextScoreboard);
  },

  agreeDraw: () => {
    const state = get();
    if (state.status.result !== 'ongoing') return;
    const nextScoreboard = state.scoredCurrentGame
      ? state.scoreboard
      : applyResultToScoreboard(state.scoreboard, 'draw');
    set({
      status: { result: 'draw', reason: 'Agreement' },
      gameVersion: state.gameVersion + 1,
      scoreboard: nextScoreboard,
      scoredCurrentGame: true,
      thinking: createThinkingState(),
      thinkingStartedAt: createTimestampState(),
      streamRaw: createStringState(),
      streamReasoning: createStringState(),
      drawOffer: null,
    });
    if (nextScoreboard !== state.scoreboard) saveScoreboard(nextScoreboard);
  },

  claimRepetitionDraw: () => {
    const state = get();
    if (state.status.result !== 'ongoing') return;
    if (state.repetitionCount < 3) return;
    const nextScoreboard = state.scoredCurrentGame
      ? state.scoreboard
      : applyResultToScoreboard(state.scoreboard, 'draw');
    set({
      status: { result: 'draw', reason: 'Threefold repetition' },
      gameVersion: state.gameVersion + 1,
      scoreboard: nextScoreboard,
      scoredCurrentGame: true,
      thinking: createThinkingState(),
      thinkingStartedAt: createTimestampState(),
      streamRaw: createStringState(),
      streamReasoning: createStringState(),
      drawOffer: null,
    });
    if (nextScoreboard !== state.scoreboard) saveScoreboard(nextScoreboard);
  },

  offerDraw: (by) => {
    if (get().status.result !== 'ongoing') return;
    set({ drawOffer: { by } });
  },

  clearDrawOffer: () => set({ drawOffer: null }),

  setPlayerName: (color, name) => {
    const trimmed = name.trim().slice(0, 40);
    set((state) => ({
      players: {
        ...state.players,
        [color]: {
          ...state.players[color],
          name: trimmed || (color === 'white' ? 'White' : 'Black'),
        },
      },
    }));
  },

  setPlayerController: (color, controller, options) => {
    set((state) => {
      const nextThread = options?.clearMemory
        ? createEmptyThread()
        : state.threads[color];
      return {
        players: {
          ...state.players,
          [color]: { ...state.players[color], controller },
        },
        threads: { ...state.threads, [color]: nextThread },
        thinking:
          controller === 'human'
            ? { ...state.thinking, [color]: false }
            : state.thinking,
        thinkingStartedAt:
          controller === 'human'
            ? { ...state.thinkingStartedAt, [color]: null }
            : state.thinkingStartedAt,
        streamRaw:
          controller === 'human'
            ? { ...state.streamRaw, [color]: '' }
            : state.streamRaw,
        streamReasoning:
          controller === 'human'
            ? { ...state.streamReasoning, [color]: '' }
            : state.streamReasoning,
        aiHold: { ...state.aiHold, [color]: false },
      };
    });
  },

  updatePlayerConfig: (color, patch) => {
    const current = get().players[color];
    const nextConfig = sanitizeConfig(mergeConfig(current.config, patch));
    if (patch.apiKey !== undefined) {
      setApiKey(color, nextConfig.apiKey);
    }
    set((state) => ({
      players: {
        ...state.players,
        [color]: {
          ...state.players[color],
          config: nextConfig,
        },
      },
    }));
  },

  appendThreadTurn: (color, turn) => {
    set((state) => {
      const thread = state.threads[color];
      return {
        threads: {
          ...state.threads,
          [color]: {
            ...thread,
            turns: [...thread.turns, turn].slice(-200),
          },
        },
      };
    });
  },

  setThread: (color, thread) => {
    set((state) => ({
      threads: {
        ...state.threads,
        [color]: normalizeThread(thread, get().moves.length),
      },
    }));
  },

  clearMemory: (color) => {
    set((state) => ({
      threads: { ...state.threads, [color]: createEmptyThread() },
    }));
  },

  beginThinking: (color) => {
    set((state) => ({
      thinking: { ...state.thinking, [color]: true },
      thinkingStartedAt: { ...state.thinkingStartedAt, [color]: Date.now() },
      streamRaw: { ...state.streamRaw, [color]: '' },
      streamReasoning: { ...state.streamReasoning, [color]: '' },
      aiErrors: { ...state.aiErrors, [color]: null },
    }));
  },

  setStream: (color, raw, reasoning) => {
    set((state) => ({
      streamRaw: { ...state.streamRaw, [color]: raw },
      streamReasoning: { ...state.streamReasoning, [color]: reasoning },
    }));
  },

  endThinking: (color) => {
    set((state) => ({
      thinking: { ...state.thinking, [color]: false },
      thinkingStartedAt: { ...state.thinkingStartedAt, [color]: null },
    }));
  },

  setAiError: (color, error) => {
    set((state) => ({ aiErrors: { ...state.aiErrors, [color]: error } }));
  },

  flipBoard: () => {
    set((state) => ({
      orientation: state.orientation === 'white' ? 'black' : 'white',
    }));
  },

  setOrientation: (orientation) => set({ orientation }),

  setShowThinking: (show) => set({ showThinking: show }),

  setShowCoordinates: (show) => set({ showCoordinates: show }),

  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  setViewPly: (ply) => {
    const total = get().moves.length;
    if (ply === null) {
      set({ viewPly: null });
      return;
    }
    const clamped = Math.max(0, Math.min(ply, total));
    set({ viewPly: clamped === total ? null : clamped });
  },

  setAiPaused: (paused) => set({ aiPaused: paused }),

  setAiHold: (color, hold) => {
    set((state) => ({
      aiHold: { ...state.aiHold, [color]: hold },
    }));
  },

  setAiDelayMs: (delay) => {
    if (!Number.isFinite(delay)) return;
    set({ aiDelayMs: Math.min(5_000, Math.max(200, Math.round(delay))) });
  },
}));

/** Read-only helpers for modules that need to inspect the validated engine. */
export function getPieceAt(fen: string, square: Square) {
  try {
    return new Chess(fen).get(square);
  } catch {
    return undefined;
  }
}

export function getLegalTargets(fen: string, square: Square): Square[] {
  try {
    return new Chess(fen)
      .moves({ square, verbose: true })
      .map((move) => move.to);
  } catch {
    return [];
  }
}

export function findPromotionCandidate(
  fen: string,
  from: Square,
  to: Square,
): boolean {
  try {
    const chess = new Chess(fen);
    const piece = chess.get(from);
    if (!piece || piece.type !== 'p') return false;
    return (
      (piece.color === 'w' && to[1] === '8') ||
      (piece.color === 'b' && to[1] === '1')
    );
  } catch {
    return false;
  }
}

