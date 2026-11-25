import type { PlayerConfig } from '../../types/chess';
import { EngineSearchResult, EngineSearchInfo, ChessEngine } from './base';
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
    _signal?: AbortSignal,
    onInfo?: (info: EngineSearchInfo) => void
  ): Promise<EngineSearchResult> {
    const startedAt = Date.now();
    const move = chooseFallbackMove(fen);

    if (!move) {
      throw new Error('Fallback engine could not find a legal move.');
    }

    const result: EngineSearchResult = {
      move,
      eval: 0,
      depth: 1,
      pv: [move],
      time: Date.now() - startedAt,
      elapsedMs: Date.now() - startedAt,
    };
    if (onInfo) {
      onInfo({ depth: 1, pv: [move] });
    }
    return result;
  }

  terminate(): void {
    this.isReadyValue = false;
  }

  isReady(): boolean {
    return this.isReadyValue;
  }
}
