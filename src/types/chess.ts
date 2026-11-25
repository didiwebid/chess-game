import type { PieceSymbol, Square } from 'chess.js';

export type Color = 'white' | 'black';
export type Controller = 'human' | 'ai';
export type Result = 'ongoing' | 'white' | 'black' | 'draw';

export interface ScoreEntry {
  wins: number;
  draws: number;
  losses: number;
}

export interface Scoreboard {
  white: ScoreEntry;
  black: ScoreEntry;
}
export type PersonaPreset =
  | 'aggressive'
  | 'positional'
  | 'solid'
  | 'tactical'
  | 'beginner'
  | 'custom';

export type ProviderType = 'openai' | 'lozza' | 'tonnetto' | 'stockfish' | 'fallback';

export interface GameStatus {
  result: Result;
  reason: string;
}

export interface ContextConfig {
  maxTokens: number;
  thresholdRatio: number;
  keepLastNPlies: number;
}

export interface PlayerConfig {
  // API providers
  baseUrl: string;
  apiKey: string;
  model: string;
  
  // Chess engines
  providerType: ProviderType;
  depth?: number;         // 1-50
  movetimeMs?: number;    // 100-30000
  skillLevel?: number;    // 0-20 (Stockfish)
  luckLevel?: number;     // 0-20 (Stockfish)
  threads?: number;       // 1-16
  hash?: number;          // MB (Stockfish/Lc0)
  nnCache?: number;       // MB (Lc0)
  uciOptions?: Record<string, string | number>; // Engine-specific options
  
  // Shared
  temperature: number;
  maxTokens: number;
  stream: boolean;
  personaPreset: PersonaPreset;
  systemPromptOverride: string;
  context: ContextConfig;
  timeoutMs: number;
}

export type PlayerConfigPatch = Omit<Partial<PlayerConfig>, 'context'> & {
  context?: Partial<ContextConfig>;
};

export interface Player {
  name: string;
  controller: Controller;
  config: PlayerConfig;
}

export interface MoveRecord {
  ply: number;
  san: string;
  color: Color;
  controller: Controller;
  from?: Square;
  to?: Square;
  piece?: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  provider?: string;
  model?: string;
  reasoning?: string;
  confidence?: 'high' | 'medium' | 'low';
  fallback?: boolean;
  /** Principal variation (SAN) recorded for AI moves, if the engine provided one. */
  pv?: string[];
  timestamp: string;
  elapsedMs?: number;
}

export interface ThreadTurn {
  /** The game ply (1-based) for which this AI response was made. */
  ply: number;
  user: string;
  assistant: string;
}

export interface AIThread {
  summary: string;
  summaryThroughPly: number;
  turns: ThreadTurn[];
}

export interface AIPlayerConfigPayload
  extends Omit<PlayerConfig, 'apiKey'> {
  apiKeySaved: boolean;
  apiKeyHint: string;
}

export interface SaveFile {
  format: 'browser-chess-save';
  version: 1;
  savedAt: string;
  orientation: Color;
  initialFen?: string;
  fen: string;
  pgn: string;
  moves: MoveRecord[];
  players: Record<Color, Omit<Player, 'config'> & { config: AIPlayerConfigPayload }>;
  threads: Record<Color, AIThread>;
  status: GameStatus;
  clocks: { enabled: false; whiteMs: 0; blackMs: 0 };
}

export interface SaveSlot {
  id: string;
  name: string;
  savedAt: string;
  snapshot: SaveFile;
}

export interface LoadedGameData {
  players: Record<Color, Player>;
  threads: Record<Color, AIThread>;
  orientation: Color;
  status: GameStatus;
  initialFen: string;
  fen: string;
  moves: MoveRecord[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ParsedAiMove {
  move: string;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface AiErrorInfo {
  message: string;
  detail?: string;
  at: number;
}

export interface AiMeta {
  provider?: string;
  model?: string;
  reasoning?: string;
  confidence?: 'high' | 'medium' | 'low';
  fallback?: boolean;
  /** Principal variation (SAN) recorded for AI moves, if the engine provided one. */
  pv?: string[];
  elapsedMs?: number;
}

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}
