import { Chess } from 'chess.js';
import type { PlayerConfig } from '../../types/chess';
import { EngineSearchResult, EngineSearchInfo, ChessEngine } from './base';

// Tonnetto engine (TypeScript-based, runs in Web Worker to avoid UI blocking)
// Source: https://github.com/marcobuontempo/tonnetto
// NPM: tonnetto@1.0.2

// Create worker using Vite worker import
const worker = new Worker(new URL('./tonnetto-worker.ts?worker', import.meta.url), { type: 'module' });

type PendingRequest = { resolve: (move: string) => void; reject: (error: Error) => void };
let requestId = 0;
const pendingRequests = new Map<number, PendingRequest>();

worker.onmessage = (e: MessageEvent) => {
  const { id, move, error } = e.data;
  const request = pendingRequests.get(id);
  if (request) {
    if (error) request.reject(new Error(error));
    else request.resolve(move);
    pendingRequests.delete(id);
  }
};

export class TonnettoEngine implements ChessEngine {
  async init(): Promise<void> {
    // Worker is ready immediately
  }

  async search(
    fen: string,
    config: PlayerConfig,
    signal?: AbortSignal,
    onInfo?: (info: EngineSearchInfo) => void
  ): Promise<EngineSearchResult> {
    const startedAt = Date.now();
    const depth = Math.min(config.depth ?? 3, 3); // Cap at depth 3 for reasonable speed (Tonnetto is slow at depth > 3)
    const timeoutMs = Math.max(config.movetimeMs || depth * 2000, 10_000) + 5_000;

    return new Promise<string>((resolve, reject) => {
      const id = ++requestId;
      const timer = window.setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('Tonnetto search timed out.'));
      }, timeoutMs);

      const request = { resolve, reject };
      pendingRequests.set(id, request);

      worker.postMessage({
        id,
        fen,
        depth,
        movetimeMs: config.movetimeMs
      });

      // Abort handling
      signal?.addEventListener('abort', () => {
        window.clearTimeout(timer);
        pendingRequests.delete(id);
        worker.postMessage({ id, cancel: true });
        reject(new Error('Search aborted'));
      }, { once: true });
    }).then((uciMove: string) => {
      try {
        const chess = new Chess(fen);
        const sanMove = chess.move({ from: uciMove.slice(0, 2), to: uciMove.slice(2, 4), promotion: uciMove[4] })?.san;
        if (!sanMove) {
          throw new Error(`Tonnetto returned an unparseable move: ${uciMove}`);
        }

        // Tonnetto doesn't provide eval/score/depth directly, so we estimate
        const result: EngineSearchResult = {
          move: sanMove,
          eval: 0, // Tonnetto doesn't expose eval directly
          depth,
          pv: [uciMove], // Just the best move
          time: Date.now() - startedAt,
          elapsedMs: Date.now() - startedAt,
        };
        if (onInfo) {
          onInfo({ depth, pv: [uciMove] });
        }
        return result;
      } catch (error) {
        throw new Error(`Failed to parse move: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }).catch((error) => {
      throw new Error(`Tonnetto search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }) as Promise<EngineSearchResult>;
  }

  terminate(): void {
    worker.terminate();
    pendingRequests.clear();
  }

  isReady(): boolean {
    return true;
  }
}