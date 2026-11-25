import { Chess } from 'chess.js';
import type { PlayerConfig } from '../../types/chess';
import { EngineSearchResult, EngineSearchInfo, ChessEngine } from './base';

// Minimal surface of the Sunfish worker used by this adapter.
interface SunfishEngineInterface {
  postMessage: (cmd: string) => void;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  terminate: () => void;
}

// Lazy singleton module reference, mirroring the other adapters.
let sunfishWorkerModule: typeof import('./sunfish-worker.ts?worker') | null = null;

/**
 * Sunfish engine adapter.
 *
 * Runs the lightweight pure-JS Sunfish port (GPLv3, ~30 KB) in a dedicated
 * Web Worker. Unlike Stockfish/Lozza, Sunfish has **no FEN parser**: it only
 * accepts `position startpos moves <uci move list>`. The adapter therefore
 * receives the move history as UCI strings from the orchestrator (5th search
 * argument) and rebuilds the position that way.
 *
 * Protocol (UCI-lite):
 *   main -> worker : "uci", "isready",
 *                    "position startpos moves e2e4 e7e5",
 *                    "go depth n" | "go wtime ms btime ms", "stop", "quit"
 *   worker -> main : "uciok", "readyok", "bestmove e7e5"
 *
 * Sunfish emits no score/info lines, so eval is reported as 0 and the depth
 * shown is the requested search depth.
 */
export class SunfishEngine implements ChessEngine {
  private worker: Worker | null = null;
  private engine: SunfishEngineInterface | null = null;
  private isReadyValue = false;
  private isLoading = false;
  private loadingPromise: Promise<SunfishEngineInterface> | null = null;

  async init(): Promise<void> {
    // The worker is created lazily on the first search (see ensureEngine).
  }

  async search(
    fen: string,
    config: PlayerConfig,
    signal?: AbortSignal,
    onInfo?: (info: EngineSearchInfo) => void,
    historyUci?: string[]
  ): Promise<EngineSearchResult> {
    const engine = await this.ensureEngine();

    const abortHandler = () => {
      engine.postMessage('stop');
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    const startedAt = Date.now();

    // ---- Position --------------------------------------------------------
    // Sunfish cannot parse FEN; rebuild the position from the UCI move list.
    const history = (historyUci ?? []).filter(Boolean);
    engine.postMessage(
      history.length > 0
        ? `position startpos moves ${history.join(' ')}`
        : 'position startpos',
    );

    // ---- Search ---------------------------------------------------------
    // Depth cap 12: this pure-JS port becomes slow beyond shallow depths.
    const depth = Math.min(Math.max(1, config.depth ?? 4), 12);
    const goCommand = config.movetimeMs
      ? `go wtime ${config.movetimeMs} btime ${config.movetimeMs}`
      : `go depth ${depth}`;

    return new Promise<EngineSearchResult>((resolve, reject) => {
      const safetyTimeout = Math.max(
        (config.movetimeMs ?? depth * 1500) + 8_000,
        15_000,
      );
      const timer = window.setTimeout(() => {
        engine.postMessage('stop');
        reject(new Error('Sunfish search timed out.'));
      }, safetyTimeout);

      engine.onmessage = (event: MessageEvent<string>) => {
        const msg = (event.data || '').toString().trim();
        if (!msg.startsWith('bestmove')) return;

        window.clearTimeout(timer);
        engine.onmessage = null;
        signal?.removeEventListener('abort', abortHandler);

        const uciMove = msg.split(' ')[1]; // e.g. "e7e5" | "e7e8q"
        if (!uciMove || uciMove === '(none)') {
          reject(new Error('Sunfish returned a bestmove with no move.'));
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
            reject(new Error(`Sunfish returned an unparseable move: ${uciMove}`));
            return;
          }

          onInfo?.({ depth, pv: [uciMove] });

          resolve({
            move: sanMove,
            eval: 0,
            depth,
            pv: [uciMove],
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

  private async ensureEngine(): Promise<SunfishEngineInterface> {
    if (this.engine && this.isReadyValue) return this.engine;

    if (this.loadingPromise) return this.loadingPromise;

    this.isLoading = true;
    this.loadingPromise = new Promise<SunfishEngineInterface>((resolve, reject) => {
      if (!sunfishWorkerModule) {
        import('./sunfish-worker.ts?worker')
          .then((module) => {
            sunfishWorkerModule = module;
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
    resolve: (engine: SunfishEngineInterface) => void,
    reject: (error: Error) => void,
  ) {
    try {
      const worker = new sunfishWorkerModule!.default();
      this.worker = worker;

      const engine: SunfishEngineInterface = {
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
          reject(new Error('Sunfish initialization timed out.'));
        }
      }, 15_000);
    } catch (error) {
      this.isLoading = false;
      this.loadingPromise = null;
      reject(error instanceof Error ? error : new Error('Unknown error'));
    }
  }
}
