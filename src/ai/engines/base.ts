import type { PlayerConfig } from '../../types/chess';

export interface EngineSearchResult {
  move: string;          // SAN move
  eval: number;          // Centipawns (positive = white advantage)
  depth: number;
  pv: string[];          // Principal variation moves in SAN
  time: number;          // Milliseconds
  elapsedMs: number;     // Milliseconds
}

export interface ChessEngine {
  init(options: Record<string, unknown>): Promise<void>;
  search(
    fen: string,
    config: PlayerConfig,
    signal?: AbortSignal
  ): Promise<EngineSearchResult>;
  terminate(): void;
  isReady(): boolean;
}

/**
 * Engine manager - handles lazy loading and caching of engine instances
 */
export class EngineManager {
  private static instance: EngineManager;
  private engines: Map<string, ChessEngine> = new Map();

  private constructor() {}

  static getInstance(): EngineManager {
    if (!EngineManager.instance) {
      EngineManager.instance = new EngineManager();
    }
    return EngineManager.instance;
  }

  async getEngine(type: string): Promise<ChessEngine> {
    if (this.engines.has(type)) {
      return this.engines.get(type)!;
    }

    let engine: ChessEngine;
    switch (type) {
      case 'lozza':
        const { LozzaEngine } = await import('./lozza');
        engine = new LozzaEngine();
        break;
      case 'tonnetto':
        const { TonnettoEngine } = await import('./tonnetto');
        engine = new TonnettoEngine();
        break;
      case 'fallback':
        const { FallbackEngine } = await import('./fallback');
        engine = new FallbackEngine();
        break;
      default:
        throw new Error(`Unknown engine type: ${type}`);
    }

    await engine.init({});
    this.engines.set(type, engine);
    return engine;
  }

  async terminateAll() {
    for (const engine of Array.from(this.engines.values())) {
      engine.terminate();
    }
    this.engines.clear();
  }
}