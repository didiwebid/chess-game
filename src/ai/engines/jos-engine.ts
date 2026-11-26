import type { PlayerConfig } from '../../types/chess';
import { Chess } from 'chess.js';
import { EngineSearchResult, EngineSearchInfo, ChessEngine } from './base';

// Jos Engine adapter - josefjadrny/js-chess-engine
// Source: https://github.com/josefjadrny/js-chess-engine
// NPM: js-chess-engine
// License: MIT
// ELO: ~800-1400 (configurable via level 1-5)
// Size: ~15KB

export class JosEngine implements ChessEngine {
  private isReadyValue = true;

  async init(_options?: Record<string, unknown>): Promise<void> {
    // Engine is ready immediately
  }

  async search(
    fen: string,
    config: PlayerConfig,
    signal?: AbortSignal,
    onInfo?: (info: EngineSearchInfo) => void
  ): Promise<EngineSearchResult> {
    const startedAt = Date.now();

    const level = Math.min(Math.max(1, config.depth ?? 4), 5);
    const movetimeMs = config.movetimeMs;
    const timeoutMs = Math.max(movetimeMs ?? 3000, 10_000);

    return new Promise<EngineSearchResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Jos engine search timed out.'));
      }, timeoutMs);

      const abortHandler = () => {
        clearTimeout(timer);
        reject(new Error('Search aborted'));
      };

      signal?.addEventListener('abort', abortHandler, { once: true });

      // Use the stateless ai function from js-chess-engine
      // Dynamic import to enable code splitting
      import('js-chess-engine').then(({ ai }) => {
        clearTimeout(timer);

        if (signal?.aborted) {
          reject(new Error('Search aborted'));
          return;
        }

        try {
          const result = ai(fen, { level });

          if (!result || !result.move) {
            reject(new Error('Jos engine returned no move'));
            return;
          }

          // Convert move object {"E2": "E4"} to UCI format "e2e4"
          const moveKey = Object.keys(result.move)[0];
          const moveVal = result.move[moveKey as keyof typeof result.move];
          const uciMove = `${moveKey.toLowerCase()}${moveVal.toLowerCase()}`;

          // Convert to SAN for the ChessEngine interface
          let sanMove: string;
          try {
            const chess = new Chess(fen);
            sanMove = chess.move({
              from: moveKey,
              to: moveVal,
              promotion: uciMove[4]?.toLowerCase() as any
            })?.san;

            if (!sanMove) {
              throw new Error('Failed to convert to SAN');
            }
          } catch (parseError) {
            // If SAN conversion fails, use UCI as fallback
            sanMove = uciMove;
          }

          const elapsedMs = Date.now() - startedAt;

          const engineResult: EngineSearchResult = {
            move: sanMove,
            eval: result.bestScore ?? 0,
            depth: result.depth ?? level,
            pv: [uciMove],
            time: elapsedMs,
            elapsedMs
          };

          if (onInfo) {
            onInfo({ depth: result.depth ?? level, pv: [uciMove], eval: result.bestScore });
          }

          resolve(engineResult);
        } catch (error) {
          clearTimeout(timer);
          reject(new Error(`Jos engine search failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      }).catch((importError) => {
        clearTimeout(timer);
        reject(new Error(`Failed to load js-chess-engine: ${importError instanceof Error ? importError.message : 'Unknown error'}`));
      });
    });
  }

  terminate(): void {
    // Jos engine is stateless - nothing to clean up
  }

  isReady(): boolean {
    return this.isReadyValue;
  }
}