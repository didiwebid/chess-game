import { Chess } from 'chess.js';
import { moveToRecord, START_FEN, deriveStatus } from '../engine/chessUtils';
import { useChessStore } from '../store/chessStore';
import { createDefaultConfig, createEmptyThread, sanitizeConfig } from '../store/defaults';
import { getApiKeys, maskApiKey } from './apiKeys';
import { abortAllAiTurns } from '../ai/orchestrator';
import type {
  AIThread,
  AIPlayerConfigPayload,
  Color,
  Controller,
  GameStatus,
  LoadedGameData,
  MoveRecord,
  PersonaPreset,
  Player,
  PlayerConfig,
  Result,
  SaveFile,
  SaveSlot,
  ThreadTurn,
} from '../types/chess';
import { validProviderType } from '../store/defaults';

const LAST_GAME_KEY = 'gambit.lastGame.v1';
const SAVES_KEY = 'gambit.saves.v1';
const SAVE_FORMAT = 'browser-chess-save';
const SAVE_VERSION = 1;
const MAX_MOVES = 1_000;
const MAX_THREAD_TURNS = 200;

interface OperationResult {
  ok: boolean;
  error?: string;
}

interface BootResult {
  restored: boolean;
  error?: string;
  missingKeys?: string[];
}

function safeString(value: unknown, fallback = '', maxLength = 20_000): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function validColor(value: unknown): value is Color {
  return value === 'white' || value === 'black';
}

function validController(value: unknown): value is Controller {
  return value === 'human' || value === 'ai';
}

function validPersona(value: unknown): value is PersonaPreset {
  return (
    value === 'aggressive' ||
    value === 'positional' ||
    value === 'solid' ||
    value === 'tactical' ||
    value === 'beginner' ||
    value === 'custom'
  );
}

function validResult(value: unknown): value is Result {
  return value === 'ongoing' || value === 'white' || value === 'black' || value === 'draw';
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function currentTimestampFile(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function buildPgn(): string {
  const state = useChessStore.getState();
  const chess = new Chess(state.initialFen || START_FEN);
  try {
    for (const move of state.moves) {
      chess.move(move.san);
    }
  } catch {
    // The store only contains validated moves, but never let PGN export break the UI.
  }

  const result =
    state.status.result === 'white'
      ? '1-0'
      : state.status.result === 'black'
        ? '0-1'
        : state.status.result === 'draw'
          ? '1/2-1/2'
          : '*';
  const now = new Date();
  const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const clean = (value: string) => value.replace(/["\r\n]/g, '').slice(0, 60);

  chess.setHeader('Event', 'Gambit Local Match');
  chess.setHeader('Site', 'Local table');
  chess.setHeader('Date', date);
  chess.setHeader('Round', '1');
  chess.setHeader('White', clean(state.players.white.name || 'White'));
  chess.setHeader('Black', clean(state.players.black.name || 'Black'));
  chess.setHeader('Result', result);
  if (state.initialFen !== START_FEN) {
    chess.setHeader('SetUp', '1');
    chess.setHeader('FEN', state.initialFen);
  }
  return chess.pgn();
}

function serializedConfig(config: PlayerConfig): AIPlayerConfigPayload {
  const { apiKey, ...rest } = config;
  return {
    ...rest,
    apiKeySaved: Boolean(apiKey),
    apiKeyHint: maskApiKey(apiKey),
  };
}

function serializeGame(): SaveFile {
  const state = useChessStore.getState();
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    orientation: state.orientation,
    initialFen: state.initialFen,
    fen: state.fen,
    pgn: buildPgn(),
    moves: state.moves,
    players: {
      white: {
        name: state.players.white.name,
        controller: state.players.white.controller,
        config: serializedConfig(state.players.white.config),
      },
      black: {
        name: state.players.black.name,
        controller: state.players.black.controller,
        config: serializedConfig(state.players.black.config),
      },
    },
    threads: state.threads,
    status: state.status,
    clocks: { enabled: false, whiteMs: 0, blackMs: 0 },
  };
}

function downloadFile(
  contents: string,
  filename: string,
  type: string,
): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCurrentGame(): void {
  downloadFile(
    JSON.stringify(serializeGame(), null, 2),
    `gambit-game-${currentTimestampFile()}.json`,
    'application/json',
  );
}

export function downloadCurrentPgn(): void {
  downloadFile(
    buildPgn(),
    `gambit-game-${currentTimestampFile()}.pgn`,
    'application/x-chess-pgn',
  );
}

export function saveLastGame(): void {
  try {
    window.localStorage.setItem(LAST_GAME_KEY, JSON.stringify(serializeGame()));
  } catch {
    // Autosave is best-effort; quota failures should not interrupt play.
  }
}

export function clearLastGame(): void {
  try {
    window.localStorage.removeItem(LAST_GAME_KEY);
  } catch {
    // No-op.
  }
}

function readSlotsRaw(): unknown[] {
  try {
    const raw = window.localStorage.getItem(SAVES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSlots(slots: SaveSlot[]): OperationResult {
  try {
    window.localStorage.setItem(SAVES_KEY, JSON.stringify(slots));
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        'The browser could not save this slot. Local storage may be full or disabled.',
    };
  }
}

export function listSaveSlots(): SaveSlot[] {
  return readSlotsRaw()
    .filter((slot): slot is SaveSlot => {
      if (!slot || typeof slot !== 'object') return false;
      const candidate = slot as Partial<SaveSlot>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.savedAt === 'string' &&
        !!candidate.snapshot &&
        candidate.snapshot.format === SAVE_FORMAT
      );
    })
    .map((slot) => ({
      ...slot,
      name: slot.name.slice(0, 60),
      snapshot: slot.snapshot,
    }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveNamedSlot(name: string): { ok: boolean; error?: string; slot?: SaveSlot } {
  const cleaned = name.trim().slice(0, 60) || 'Untitled game';
  const snapshot = serializeGame();
  const slots = listSaveSlots();
  const slot: SaveSlot = {
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: cleaned,
    savedAt: new Date().toISOString(),
    snapshot,
  };
  const result = writeSlots([slot, ...slots]);
  if (!result.ok) return result;
  return { ok: true, slot };
}

export function renameSaveSlot(id: string, name: string): OperationResult {
  const cleaned = name.trim().slice(0, 60);
  if (!cleaned) return { ok: false, error: 'Give the saved game a name.' };
  const slots = listSaveSlots().map((slot) =>
    slot.id === id ? { ...slot, name: cleaned } : slot,
  );
  return writeSlots(slots);
}

export function deleteSaveSlot(id: string): OperationResult {
  return writeSlots(listSaveSlots().filter((slot) => slot.id !== id));
}

function parseConfig(
  raw: unknown,
  color: Color,
  apiKey: string,
): PlayerConfig {
  const defaults = createDefaultConfig(color);
  if (!raw || typeof raw !== 'object') {
    return { ...defaults, apiKey };
  }
  const source = raw as Record<string, unknown>;
  const rawContext =
    source.context && typeof source.context === 'object'
      ? (source.context as Record<string, unknown>)
      : {};

  return sanitizeConfig({
    ...defaults,
    apiKey,
    providerType: validProviderType(source.providerType)
      ? source.providerType
      : defaults.providerType,
    baseUrl: safeString(source.baseUrl, defaults.baseUrl, 2_000),
    model: safeString(source.model, defaults.model, 200),
    temperature: numberOr(source.temperature, defaults.temperature),
    maxTokens: numberOr(source.maxTokens, defaults.maxTokens),
    stream: boolOr(source.stream, defaults.stream),
    personaPreset: validPersona(source.personaPreset)
      ? source.personaPreset
      : defaults.personaPreset,
    systemPromptOverride: safeString(
      source.systemPromptOverride,
      '',
      12_000,
    ),
    context: {
      maxTokens: numberOr(rawContext.maxTokens, defaults.context.maxTokens),
      thresholdRatio: numberOr(
        rawContext.thresholdRatio,
        defaults.context.thresholdRatio,
      ),
      keepLastNPlies: numberOr(
        rawContext.keepLastNPlies,
        defaults.context.keepLastNPlies,
      ),
    },
    timeoutMs: numberOr(source.timeoutMs, defaults.timeoutMs),
  });
}

function parseStatus(raw: unknown): GameStatus {
  if (!raw || typeof raw !== 'object') return { result: 'ongoing', reason: '' };
  const source = raw as Record<string, unknown>;
  if (!validResult(source.result)) return { result: 'ongoing', reason: '' };
  return {
    result: source.result,
    reason: safeString(source.reason, '', 160),
  };
}

function parseThread(raw: unknown): AIThread {
  if (!raw || typeof raw !== 'object') return createEmptyThread();
  const source = raw as Record<string, unknown>;
  const turns: ThreadTurn[] = Array.isArray(source.turns)
    ? source.turns
        .filter((turn): turn is Record<string, unknown> => !!turn && typeof turn === 'object')
        .map((turn) => ({
          ply: Math.max(0, Math.round(numberOr(turn.ply, 0))),
          user: safeString(turn.user, '', 60_000),
          assistant: safeString(turn.assistant, '', 60_000),
        }))
        .slice(-MAX_THREAD_TURNS)
    : [];
  return {
    summary: safeString(source.summary, '', 30_000),
    summaryThroughPly: Math.max(
      0,
      Math.round(numberOr(source.summaryThroughPly, 0)),
    ),
    turns,
  };
}

function parseMove(raw: unknown, index: number): MoveRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const san = safeString(source.san, '', 40).trim();
  if (!san) return null;
  const color = validColor(source.color)
    ? source.color
    : index % 2 === 0
      ? 'white'
      : 'black';
  const controller = validController(source.controller)
    ? source.controller
    : 'human';
  return {
    ply: index + 1,
    san,
    color,
    controller,
    timestamp: safeString(source.timestamp, new Date().toISOString(), 60),
    provider: safeString(source.provider, '', 2_000) || undefined,
    model: safeString(source.model, '', 200) || undefined,
    reasoning: safeString(source.reasoning, '', 20_000) || undefined,
    confidence:
      source.confidence === 'high' ||
      source.confidence === 'medium' ||
      source.confidence === 'low'
        ? source.confidence
        : undefined,
    fallback: source.fallback === true,
    pv:
      Array.isArray(source.pv) && source.pv.every((item) => typeof item === 'string')
        ? (source.pv as string[]).slice(0, 32)
        : undefined,
    elapsedMs:
      typeof source.elapsedMs === 'number' && Number.isFinite(source.elapsedMs)
        ? source.elapsedMs
        : undefined,
  };
}

function isSaveFileShape(raw: unknown): raw is SaveFile {
  if (!raw || typeof raw !== 'object') return false;
  const candidate = raw as Record<string, unknown>;
  return (
    candidate.format === SAVE_FORMAT &&
    typeof candidate.version === 'number' &&
    typeof candidate.fen === 'string' &&
    Array.isArray(candidate.moves) &&
    !!candidate.players &&
    typeof candidate.players === 'object'
  );
}

function snapshotToLoadedData(save: SaveFile): {
  data?: LoadedGameData;
  error?: string;
  missingKeys: string[];
} {
  if (!isSaveFileShape(save)) {
    return { error: 'This file is not a Gambit save.', missingKeys: [] };
  }
  if (save.version !== SAVE_VERSION) {
    return {
      error: `This save uses version ${String(save.version)}. This build supports version ${SAVE_VERSION}.`,
      missingKeys: [],
    };
  }
  if (save.moves.length > MAX_MOVES) {
    return { error: 'This save contains too many moves.', missingKeys: [] };
  }

  const initialFen =
    typeof save.initialFen === 'string' && save.initialFen.trim()
      ? save.initialFen
      : START_FEN;
  try {
    new Chess(initialFen);
    new Chess(save.fen);
  } catch {
    return { error: 'The save contains an invalid chess position.', missingKeys: [] };
  }

  const playersRaw = save.players as unknown as Record<string, unknown>;
  const localKeys = getApiKeys();
  const missingKeys: string[] = [];
  const buildPlayer = (color: Color): Player => {
    const raw =
      playersRaw?.[color] && typeof playersRaw[color] === 'object'
        ? (playersRaw[color] as Record<string, unknown>)
        : {};
    const rawConfig = raw.config;
    const key = localKeys[color];
    if (
      rawConfig &&
      typeof rawConfig === 'object' &&
      (rawConfig as Record<string, unknown>).apiKeySaved === true &&
      !key
    ) {
      missingKeys.push(color === 'white' ? 'White' : 'Black');
    }
    return {
      name: safeString(raw.name, color === 'white' ? 'White' : 'Black', 40),
      controller: validController(raw.controller) ? raw.controller : 'human',
      config: parseConfig(rawConfig, color, key),
    };
  };

  const moves: MoveRecord[] = [];
  for (let index = 0; index < save.moves.length; index += 1) {
    const move = parseMove(save.moves[index], index);
    if (!move) {
      return {
        error: `Move ${index + 1} in the save is malformed.`,
        missingKeys: [],
      };
    }
    moves.push(move);
  }

  const threadsRaw =
    save.threads && typeof save.threads === 'object'
      ? (save.threads as Record<string, unknown>)
      : {};
  const orientation: Color = validColor(save.orientation) ? save.orientation : 'white';

  return {
    data: {
      players: {
        white: buildPlayer('white'),
        black: buildPlayer('black'),
      },
      threads: {
        white: parseThread(threadsRaw.white),
        black: parseThread(threadsRaw.black),
      },
      orientation,
      status: parseStatus(save.status),
      initialFen,
      fen: save.fen,
      moves,
    },
    missingKeys,
  };
}

function restoreSnapshot(
  save: SaveFile,
  options: { announce?: boolean } = {},
): { ok: boolean; error?: string; missingKeys?: string[] } {
  const parsed = snapshotToLoadedData(save);
  if (!parsed.data) return { ok: false, error: parsed.error };

  abortAllAiTurns();
  const result = useChessStore.getState().restoreGame(parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  if (parsed.missingKeys.length > 0) {
    useChessStore.getState().notify(
      `AI key unavailable in this browser for ${parsed.missingKeys.join(' and ')}. Open AI settings to add one.`,
      'warning',
    );
  }
  if (options.announce !== false) {
    useChessStore.getState().notify('Game restored from save.', 'success');
  }
  return { ok: true, missingKeys: parsed.missingKeys };
}

export function loadSlot(id: string): { ok: boolean; error?: string } {
  const slot = listSaveSlots().find((item) => item.id === id);
  if (!slot) return { ok: false, error: 'That saved game no longer exists.' };
  const result = restoreSnapshot(slot.snapshot);
  return { ok: result.ok, error: result.error };
}

export function bootFromStorage(): BootResult {
  let raw = '';
  try {
    raw = window.localStorage.getItem(LAST_GAME_KEY) ?? '';
  } catch {
    return { restored: false };
  }
  if (!raw) return { restored: false };

  try {
    const parsed = JSON.parse(raw) as SaveFile;
    const result = restoreSnapshot(parsed, { announce: false });
    if (!result.ok) {
      return {
        restored: false,
        error: result.error ?? 'The previous autosaved game could not be loaded.',
      };
    }
    if (result.missingKeys?.length) {
      useChessStore.getState().notify(
        `Previous game restored. No API key is stored for ${result.missingKeys.join(' and ')} in this browser.`,
        'warning',
      );
    }
    return { restored: true, missingKeys: result.missingKeys };
  } catch {
    return { restored: false, error: 'The autosaved game is corrupt.' };
  }
}

function parsePgnStatus(chess: Chess, headers: Record<string, string>): GameStatus {
  const derived = deriveStatus(chess);
  if (derived.result !== 'ongoing') return derived;
  const result = headers.Result;
  if (result === '1-0') return { result: 'white', reason: 'Imported result' };
  if (result === '0-1') return { result: 'black', reason: 'Imported result' };
  if (result === '1/2-1/2') return { result: 'draw', reason: 'Imported result' };
  return { result: 'ongoing', reason: '' };
}

function importPgnText(text: string): { ok: boolean; error?: string } {
  if (!text.trim()) return { ok: false, error: 'The PGN file is empty.' };
  const chess = new Chess();
  try {
    chess.loadPgn(text, { strict: false });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `That PGN could not be read: ${error.message}`
          : 'That PGN could not be read.',
    };
  }

  const headers = chess.getHeaders();
  const state = useChessStore.getState();
  const startFen = headers.FEN?.trim() ? headers.FEN : START_FEN;
  const history = chess.history({ verbose: true });
  const moves: MoveRecord[] = history.map((move, index) => {
    const record = moveToRecord(move, 'human');
    record.ply = index + 1;
    record.timestamp = new Date().toISOString();
    return record;
  });

  const players: Record<Color, Player> = {
    white: {
      ...state.players.white,
      name: safeString(headers.White, 'White', 40).trim() || 'White',
      controller: 'human',
    },
    black: {
      ...state.players.black,
      name: safeString(headers.Black, 'Black', 40).trim() || 'Black',
      controller: 'human',
    },
  };

  const loaded: LoadedGameData = {
    players,
    threads: { white: createEmptyThread(), black: createEmptyThread() },
    orientation: state.orientation,
    status: parsePgnStatus(chess, headers),
    initialFen: startFen,
    fen: chess.fen(),
    moves,
  };

  abortAllAiTurns();
  const result = useChessStore.getState().restoreGame(loaded);
  if (!result.ok) return { ok: false, error: result.error };
  useChessStore.getState().notify('PGN imported. All players set to human.', 'success');
  return { ok: true };
}

export async function importGameFile(file: File): Promise<{ ok: boolean; error?: string }> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: 'The selected file could not be read.' };
  }

  const trimmed = text.trimStart();
  const isPgn =
    file.name.toLowerCase().endsWith('.pgn') ||
    (!isSaveFileShapeSafe(trimmed) && !file.name.toLowerCase().endsWith('.json'));

  if (isPgn) {
    return importPgnText(text);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: 'This file is neither valid JSON nor a readable PGN.',
    };
  }
  if (!isSaveFileShape(parsed)) {
    return { ok: false, error: 'This JSON file is not a Gambit game save.' };
  }
  const result = restoreSnapshot(parsed);
  return { ok: result.ok, error: result.error };
}

function isSaveFileShapeSafe(trimmed: string): boolean {
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isSaveFileShape(parsed);
  } catch {
    return false;
  }
}

