import type { PieceSymbol, Square } from 'chess.js';

export type Color = 'white' | 'black';
export type Controller = 'human' | 'ai';
export type Result = 'ongoing' | 'white' | 'black' | 'draw';
export type PersonaPreset =
  | 'aggressive'
  | 'positional'
  | 'solid'
  | 'tactical'
  | 'beginner'
  | 'custom';

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
  baseUrl: string;
  apiKey: string;
  model: string;
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
  elapsedMs?: number;
}

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}
