import type { PlayerConfig } from '../../types/chess';

export interface EngineSearchResult {
  move: string;          // SAN move
  eval: number;          // Centipawns (positive = white advantage)
  depth: number;
  pv: string[];          // Principal variation moves in UCI (or SAN for lightweight engines)
  mate?: number;         // Mate in N if the engine sees one (positive = side to move mates)
  time: number;          // Milliseconds
  elapsedMs: number;     // Milliseconds
}

/**
 * A live progress snapshot emitted by an engine while it searches. Used to
 * drive the "live reasoning" stream in the thinking panel.
 */
export interface EngineSearchInfo {
  depth?: number;
  /** Centipawns, positive = White advantage (UCI convention). */
  eval?: number;
  /** Mate in N (positive = side to move mates, negative = side to move is mated). */
  mate?: number;
  /** Principal variation in UCI (or SAN for lightweight engines). */
  pv?: string[];
  nps?: number;
  nodes?: number;
}

export interface ChessEngine {
  init(options: Record<string, unknown>): Promise<void>;
  search(
    fen: string,
    config: PlayerConfig,
    signal?: AbortSignal,
    onInfo?: (info: EngineSearchInfo) => void,
    /**
     * Played moves in UCI notation ("e2e4", "e7e8q") from the initial
     * position. Engines without a FEN parser (e.g. Sunfish) rebuild the
     * position from this list; FEN-based engines ignore it.
     */
    historyUci?: string[]
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
      case 'stockfish':
        const { StockfishEngine } = await import('./stockfish');
        engine = new StockfishEngine();
        break;
      case 'sunfish':
        const { SunfishEngine } = await import('./sunfish');
        engine = new SunfishEngine();
        break;
      case 'fallback':
        const { FallbackEngine } = await import('./fallback');
        engine = new FallbackEngine();
        break;
      case 'jos':
        const { JosEngine } = await import('./jos-engine');
        engine = new JosEngine();
        break;
      case 'betafish':
        const { BetafishEngine } = await import('./betafish-engine');
        engine = new BetafishEngine();
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