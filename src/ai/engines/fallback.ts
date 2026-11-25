import type { PlayerConfig } from '../../types/chess';
import { EngineSearchResult, ChessEngine } from './base';
import { chooseFallbackMove } from '../../engine/fallback';

/**
 * Deterministic fallback engine - plays as a lightweight, dependency-free AI.
 * Uses a one-ply material scan with positional bonuses.
 */
export class FallbackEngine implements ChessEngine {
  private isReadyValue = false;

  async init(): Promise<void> {
    this.isReadyValue = true;
  }

  async search(
    fen: string,
    _config: PlayerConfig,
    _signal?: AbortSignal
  ): Promise<EngineSearchResult> {
    const startedAt = Date.now();
    const move = chooseFallbackMove(fen);

    if (!move) {
      throw new Error('Fallback engine could not find a legal move.');
    }

    return {
      move,
      eval: 0,
      depth: 1,
      pv: [move],
      time: Date.now() - startedAt,
      elapsedMs: Date.now() - startedAt,
    };
  }

  terminate(): void {
    this.isReadyValue = false;
  }

  isReady(): boolean {
    return this.isReadyValue;
  }
}
