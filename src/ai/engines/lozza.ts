import { Chess } from 'chess.js';
import type { PlayerConfig } from '../../types/chess';
import { EngineSearchResult, EngineSearchInfo, ChessEngine } from './base';

interface LozzaEngineInterface {
  postMessage: (cmd: string) => void;
  onmessage: ((msg: MessageEvent<string>) => void) | null;
  terminate: () => void;
}

let lozzaWorkerModule: typeof import('./lozza-worker.ts?worker') | null = null;

export class LozzaEngine implements ChessEngine {
  private worker: Worker | null = null;
  private engine: LozzaEngineInterface | null = null;
  private isReadyValue = false;
  private isLoading = false;
  private loadingPromise: Promise<LozzaEngineInterface> | null = null;

  async init(): Promise<void> {
    // Lozza specific initialization if needed
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

    // Set engine options
    engine.postMessage(`setoption name Threads value ${config.threads ?? 1}`);
    engine.postMessage(`setoption name Hash value ${config.hash ?? 256}`);

    // Set position
    engine.postMessage(`position fen ${fen}`);

    // Start search - cap depth at 4 for reasonable speed (Lozza is slow at higher depths)
    const depth = Math.min(config.depth ?? 4, 4);
    const goCommand = config.movetimeMs
      ? `go movetime ${config.movetimeMs}`
      : `go depth ${depth}`;

    return new Promise<EngineSearchResult>((resolve, reject) => {
      // Safety timeout
      const safetyTimeout = Math.max(config.movetimeMs || depth * 500, 15_000) + 5_000;
      const timer = window.setTimeout(() => {
        engine.postMessage('stop');
        reject(new Error('Lozza search timed out.'));
      }, safetyTimeout);

      engine.onmessage = (event: MessageEvent<string>) => {
        const msg = event.data;
        if (msg.startsWith('info')) {
          const parsed = this.parseInfoLine(msg);
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

          if (!uciMove) {
            reject(new Error('Lozza returned a bestmove with no move.'));
            return;
          }

          try {
            const chess = new Chess(fen);
            const sanMove = chess.move({ from: uciMove.slice(0, 2), to: uciMove.slice(2, 4), promotion: uciMove[4] })?.san;
            if (!sanMove) {
              reject(new Error(`Lozza returned an unparseable move: ${uciMove}`));
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
            reject(new Error(`Failed to parse move: ${error instanceof Error ? error.message : 'Unknown error'}`));
          }
        }
      };

      engine.postMessage(goCommand);
    });
  }

  terminate(): void {
    if (this.engine) {
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

  private async ensureEngine(): Promise<LozzaEngineInterface> {
    if (this.engine && this.isReadyValue) return this.engine;

    if (this.loadingPromise) return this.loadingPromise;

    this.isLoading = true;
    this.loadingPromise = new Promise<LozzaEngineInterface>((resolve, reject) => {
      if (!lozzaWorkerModule) {
        import('./lozza-worker.ts?worker').then((module) => {
          lozzaWorkerModule = module;
          this.createWorker(resolve, reject);
        }).catch(reject);
      } else {
        this.createWorker(resolve, reject);
      }
    });

    return this.loadingPromise;
  }

  private createWorker(resolve: (engine: LozzaEngineInterface) => void, reject: (error: Error) => void) {
    try {
      const worker = new lozzaWorkerModule!.default();
      this.worker = worker;

      const engine: LozzaEngineInterface = {
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

      let initPhase = 'uci';
      worker.onmessage = (event: MessageEvent<string>) => {
        if (engine.onmessage) {
          engine.onmessage(event);
        }
      };
      engine.onmessage = (event: MessageEvent<string>) => {
        const msg = (event.data || '').trim();
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

      // Phase 1: send `uci`
      engine.postMessage('uci');

      // Safety timeout
      window.setTimeout(() => {
        if (this.isLoading) {
          this.isLoading = false;
          this.loadingPromise = null;
          reject(new Error('Lozza initialization timed out.'));
        }
      }, 15_000);
    } catch (error) {
      this.isLoading = false;
      this.loadingPromise = null;
      reject(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

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