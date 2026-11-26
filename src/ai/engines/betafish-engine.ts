import type { PlayerConfig } from '../../types/chess';
import { Chess } from 'chess.js';
import { EngineSearchResult, EngineSearchInfo, ChessEngine } from './base';

// Betafish Engine adapter
// Vendored engine at: vendor/betafish/betafish.js
// Source: https://github.com/Strryke/betafish
// License: MIT
// ELO: ~1800 (configurable via setThinkingTime)
// Size: ~60KB

export class BetafishEngine implements ChessEngine {
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

    const depth = Math.min(Math.max(1, config.depth ?? 7), 50);
    const movetimeMs = config.movetimeMs ?? 3000;

    return new Promise<EngineSearchResult>((resolve, reject) => {
      const abortHandler = () => {
        reject(new Error('Search aborted'));
      };

      signal?.addEventListener('abort', abortHandler, { once: true });

      // Dynamic import to enable code splitting
      import('../../../vendor/betafish/betafish.js')
        .then((module) => {
          try {
            const engine = module.engine();

            // Check if game is over first
            const status = engine.gameStatus();
            if (status.over) {
              reject(new Error(`Game over: ${status.over}`));
              return;
            }

            // Set up timeout-based thinking
            engine.setFEN(fen);
            // setThinkingTime takes seconds, converts internally to ms
            engine.setThinkingTime(movetimeMs / 1000);

            const result = engine.makeAIMove();

            if (!result) {
              reject(new Error('Betafish engine returned no move'));
              return;
            }

            if (signal?.aborted) {
              reject(new Error('Search aborted'));
              return;
            }

            const uciMove = result;

            // Convert to SAN for the ChessEngine interface
            let sanMove: string;
            try {
              const chess = new Chess(fen);
              sanMove = chess.move({
                from: uciMove.slice(0, 2),
                to: uciMove.slice(2, 4),
                promotion: uciMove[4]?.toLowerCase() as any
              })?.san;

              if (!sanMove) {
                throw new Error('Failed to convert to SAN');
              }
            } catch (parseError) {
              sanMove = uciMove;
            }

            const elapsedMs = Date.now() - startedAt;

            const engineResult: EngineSearchResult = {
              move: sanMove,
              eval: 0,
              depth,
              pv: [uciMove],
              time: elapsedMs,
              elapsedMs
            };

            if (onInfo) {
              onInfo({ depth, pv: [uciMove], eval: 0 });
            }

            resolve(engineResult);
          } catch (error) {
            reject(new Error(`Betafish engine search failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
          }
        })
        .catch((importError) => {
          reject(new Error(`Failed to load betafish: ${importError instanceof Error ? importError.message : 'Unknown error'}`));
        });
    });
  }

  terminate(): void {
    // Betafish is stateless - nothing to clean up
  }

  isReady(): boolean {
    return this.isReadyValue;
  }
}