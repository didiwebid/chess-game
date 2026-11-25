import type {
  AIThread,
  Color,
  Player,
  PlayerConfig,
  PlayerConfigPatch,
  ProviderType,
} from '../types/chess';
import { getApiKeys } from '../persistence/apiKeys';

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function validProviderType(value: unknown): value is ProviderType {
  return (
    value === 'openai' ||
    value === 'lozza' ||
    value === 'tonnetto' ||
    value === 'stockfish' ||
    value === 'fallback'
  );
}

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MODEL = 'gpt-4o-mini';

export function createDefaultConfig(color: Color): PlayerConfig {
  return {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: getApiKeys()[color],
    model: DEFAULT_MODEL,
    temperature: 0.7,
    maxTokens: 700,
    stream: true,
    personaPreset: color === 'white' ? 'positional' : 'tactical',
    systemPromptOverride: '',
    context: {
      maxTokens: 12_000,
      thresholdRatio: 0.8,
      keepLastNPlies: 20,
    },
    timeoutMs: 30_000,
    // Engine defaults (not used for API providers)
    providerType: 'openai',
    depth: 20,
    movetimeMs: 3000,
    skillLevel: 20,
    luckLevel: 0,
    threads: 1,
    hash: 256,
    nnCache: 200,
    uciOptions: {},
  };
}

function createDefaultPlayer(color: Color): Player {
  return {
    name: color === 'white' ? 'White' : 'Black',
    controller: 'human',
    config: createDefaultConfig(color),
  };
}

export function createEmptyThread(): AIThread {
  return {
    summary: '',
    summaryThroughPly: 0,
    turns: [],
  };
}

export function createInitialPlayers(): Record<Color, Player> {
  return {
    white: createDefaultPlayer('white'),
    black: createDefaultPlayer('black'),
  };
}

export function createInitialThreads(): Record<Color, AIThread> {
  return {
    white: createEmptyThread(),
    black: createEmptyThread(),
  };
}

export function mergeConfig(
  current: PlayerConfig,
  patch: PlayerConfigPatch,
): PlayerConfig {
  return {
    ...current,
    ...patch,
    context: {
      ...current.context,
      ...(patch.context ?? {}),
    },
  };
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeConfig(config: PlayerConfig): PlayerConfig {
  return {
    ...config,
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    providerType: validProviderType(config.providerType) ? config.providerType : 'openai',
    depth: numberOr(config.depth, 20),
    movetimeMs: numberOr(config.movetimeMs, 3000),
    skillLevel: numberOr(config.skillLevel, 20),
    luckLevel: numberOr(config.luckLevel, 0),
    threads: numberOr(config.threads, 1),
    hash: numberOr(config.hash, 256),
    nnCache: numberOr(config.nnCache, 200),
    uciOptions: typeof config.uciOptions === 'object' && config.uciOptions !== null
      ? (config.uciOptions as Record<string, string | number>)
      : {},
    temperature: clampNumber(config.temperature, 0, 2, 0.7),
    maxTokens: Math.round(clampNumber(config.maxTokens, 64, 32_000, 700)),
    timeoutMs: Math.round(clampNumber(config.timeoutMs, 5_000, 180_000, 30_000)),
    context: {
      maxTokens: Math.round(
        clampNumber(config.context.maxTokens, 1_000, 400_000, 12_000),
      ),
      thresholdRatio: clampNumber(config.context.thresholdRatio, 0.3, 0.98, 0.8),
      keepLastNPlies: Math.round(
        clampNumber(config.context.keepLastNPlies, 0, 200, 20),
      ),
    },
  };
}
