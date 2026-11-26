import { Chess } from 'chess.js';
import type { PlayerConfig } from '../../types/chess';
import { EngineSearchResult, EngineSearchInfo, ChessEngine } from './base';

// Minimal surface of the UCI engine worker used by this adapter.
interface StockfishEngineInterface {
  postMessage: (cmd: string) => void;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  terminate: () => void;
}

// Lazy singleton module reference, mirroring the Lozza adapter.
let stockfishWorkerModule: typeof import('./stockfish-worker.ts?worker') | null = null;

/**
 * Stockfish engine adapter.
 *
 * Runs the vendored Stockfish engine (asm.js build, GPLv3) in a dedicated Web
 * Worker. The worker speaks raw UCI text over postMessage strings, exactly
 * like the Lozza adapter:
 *
 *   main thread -> worker : "uci", "setoption name ...", "position fen ...",
 *                           "go depth 12" / "go movetime 3000", "stop", "quit"
 *   worker -> main thread : "uciok", "readyok", "info depth ... score ... pv ...",
 *                           "bestmove e2e4"
 *
 * The adapter translates the UCI bestmove into SAN via chess.js so the rest
 * of the app does not need to know about UCI notation.
 */
export class StockfishEngine implements ChessEngine {
  private worker: Worker | null = null;
  private engine: StockfishEngineInterface | null = null;
  private isReadyValue = false;
  private isLoading = false;
  private loadingPromise: Promise<StockfishEngineInterface> | null = null;

  async init(): Promise<void> {
    // The worker is created lazily on the first search (see ensureEngine).
  }

  async search(
    fen: string,
    config: PlayerConfig,
    signal?: AbortSignal,
    onInfo?: (info: EngineSearchInfo) => void
  ): Promise<EngineSearchResult> {
    const engine = await this.ensureEngine();

    const abortHandler = () => {
      engine.postMessage('stop');
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    const startedAt = Date.now();
    let bestDepth = 0;
    let bestScore = 0;
    let bestMate: number | undefined;
    let bestPv: string[] = [];

    // ---- UCI options ----------------------------------------------------
    // Skill Level 0..20 maps directly to Stockfish's "Skill Level" option.
    engine.postMessage(
      `setoption name Skill Level value ${config.skillLevel ?? 20}`,
    );
    // This browser build pins Threads to 1 and Hash to 16 MB (its `uci`
    // output advertises "Threads min 1 max 1" and "Hash min 16 max 16"), so
    // those two UI fields are intentionally not sent here. Advanced users can
    // still inject arbitrary UCI lines through `uciOptions` below.
    // Generic passthrough, e.g. { "UCI_Elo": 1500, "MultiPV": 1 }.
    for (const [name, value] of Object.entries(config.uciOptions ?? {})) {
      engine.postMessage(`setoption name ${name} value ${value}`);
    }

    // ---- Position + search ---------------------------------------------
    engine.postMessage(`position fen ${fen}`);

    const depth = Math.min(Math.max(1, config.depth ?? 20), 50);
    const goCommand = config.movetimeMs
      ? `go movetime ${config.movetimeMs}`
      : `go depth ${depth}`;

    return new Promise<EngineSearchResult>((resolve, reject) => {
      const safetyTimeout = Math.max(
        config.movetimeMs ?? depth * 1000,
        20_000,
      ) + 10_000;
      const timer = window.setTimeout(() => {
        engine.postMessage('stop');
        reject(new Error('Stockfish search timed out.'));
      }, safetyTimeout);

      engine.onmessage = (event: MessageEvent<string>) => {
        const msg = (event.data || '').toString();
        if (msg.startsWith('info')) {
          const parsed = this.parseInfoLine(msg);
          // Only the top line (multipv 1 or absent) represents the engine's
          // best move; ignore lower-ranked MultiPV lines for the result.
          if (parsed.multipv === undefined || parsed.multipv === 1) {
            if (parsed.depth !== undefined) bestDepth = parsed.depth;
            if (parsed.score !== undefined) bestScore = parsed.score;
            if (parsed.mate !== undefined) bestMate = parsed.mate;
            if (parsed.pv !== undefined) bestPv = parsed.pv;
          }
          if (onInfo) {
            onInfo({
              depth: parsed.depth,
              eval: parsed.score,
              mate: parsed.mate,
              pv: parsed.pv,
              nps: parsed.nps,
              nodes: parsed.nodes,
            });
          }
        } else if (msg.startsWith('bestmove')) {
          window.clearTimeout(timer);
          engine.onmessage = null;
          signal?.removeEventListener('abort', abortHandler);

          const parts = msg.split(' ');
          const uciMove = parts[1]; // e.g. "e2e4" or "e7e8q"

          if (!uciMove || uciMove === '(none)') {
            reject(new Error('Stockfish returned a bestmove with no move.'));
            return;
          }

          try {
            const chess = new Chess(fen);
            const sanMove = chess.move({
              from: uciMove.slice(0, 2),
              to: uciMove.slice(2, 4),
              promotion: uciMove[4],
            })?.san;
            if (!sanMove) {
              reject(new Error(`Stockfish returned an unparseable move: ${uciMove}`));
              return;
            }

            resolve({
              move: sanMove,
              eval: bestMate !== undefined ? (bestMate > 0 ? 20_000 - bestMate : -20_000 - bestMate) : bestScore,
              depth: bestDepth || depth,
              pv: bestPv,
              mate: bestMate,
              time: Date.now() - startedAt,
              elapsedMs: Date.now() - startedAt,
            });
          } catch (error) {
            reject(
              new Error(
                `Failed to parse move: ${error instanceof Error ? error.message : 'Unknown error'}`,
              ),
            );
          }
        }
      };

      engine.postMessage(goCommand);
    });
  }

  terminate(): void {
    if (this.engine) {
      this.engine.postMessage('quit');
      this.engine.terminate();
      this.engine = null;
      this.isReadyValue = false;
      this.isLoading = false;
      this.loadingPromise = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  isReady(): boolean {
    return this.isReadyValue;
  }

  // ---- Worker lifecycle -------------------------------------------------

  private async ensureEngine(): Promise<StockfishEngineInterface> {
    if (this.engine && this.isReadyValue) return this.engine;

    if (this.loadingPromise) return this.loadingPromise;

    this.isLoading = true;
    this.loadingPromise = new Promise<StockfishEngineInterface>((resolve, reject) => {
      if (!stockfishWorkerModule) {
        import('./stockfish-worker.ts?worker')
          .then((module) => {
            stockfishWorkerModule = module;
            this.createWorker(resolve, reject);
          })
          .catch(reject);
      } else {
        this.createWorker(resolve, reject);
      }
    });

    return this.loadingPromise;
  }

  private createWorker(
    resolve: (engine: StockfishEngineInterface) => void,
    reject: (error: Error) => void,
  ) {
    try {
      const worker = new stockfishWorkerModule!.default();
      this.worker = worker;

      const engine: StockfishEngineInterface = {
        postMessage: (cmd: string) => worker.postMessage(cmd),
        onmessage: null,
        terminate: () => worker.terminate(),
      };
      this.engine = engine;

      worker.onerror = (error) => {
        this.isLoading = false;
        this.loadingPromise = null;
        reject(new Error(`Worker error: ${error.message}`));
      };

      worker.onmessage = (event: MessageEvent<string>) => {
        if (engine.onmessage) {
          engine.onmessage(event);
        }
      };

      // UCI handshake: uci -> uciok -> isready -> readyok
      let initPhase: 'uci' | 'isready' = 'uci';
      engine.onmessage = (event: MessageEvent<string>) => {
        const msg = (event.data || '').toString().trim();
        if (initPhase === 'uci' && msg === 'uciok') {
          initPhase = 'isready';
          engine.postMessage('isready');
        } else if (initPhase === 'isready' && msg === 'readyok') {
          this.isReadyValue = true;
          this.isLoading = false;
          this.loadingPromise = null;
          resolve(engine);
        }
      };

      engine.postMessage('uci');

      window.setTimeout(() => {
        if (this.isLoading) {
          this.isLoading = false;
          this.loadingPromise = null;
          reject(new Error('Stockfish initialization timed out.'));
        }
      }, 20_000);
    } catch (error) {
      this.isLoading = false;
      this.loadingPromise = null;
      reject(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  // ---- UCI info-line parsing --------------------------------------------

  private parseInfoLine(line: string): {
    depth?: number;
    score?: number;
    mate?: number;
    pv?: string[];
    nps?: number;
    nodes?: number;
    multipv?: number;
  } {
    const result: {
      depth?: number;
      score?: number;
      mate?: number;
      pv?: string[];
      nps?: number;
      nodes?: number;
      multipv?: number;
    } = {};

    const depthMatch = line.match(/depth\s+(\d+)/);
    if (depthMatch) result.depth = parseInt(depthMatch[1], 10);

    const mateMatch = line.match(/score\s+mate\s+(-?\d+)/);
    if (mateMatch) {
      result.mate = parseInt(mateMatch[1], 10);
      result.score = result.mate > 0 ? 20_000 - result.mate : -20_000 - result.mate;
    } else {
      const scoreMatch = line.match(/score\s+cp\s+(-?\d+)/);
      if (scoreMatch) result.score = parseInt(scoreMatch[1], 10);
    }

    const pvMatch = line.match(/pv\s+(.+)/);
    if (pvMatch) result.pv = pvMatch[1].split(' ');

    const npsMatch = line.match(/nps\s+(\d+)/);
    if (npsMatch) result.nps = parseInt(npsMatch[1], 10);

    const nodesMatch = line.match(/nodes\s+(\d+)/);
    if (nodesMatch) result.nodes = parseInt(nodesMatch[1], 10);

    const multipvMatch = line.match(/multipv\s+(\d+)/);
    if (multipvMatch) result.multipv = parseInt(multipvMatch[1], 10);

    return result;
  }
}
