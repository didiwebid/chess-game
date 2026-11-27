import type { PlayerConfig } from '../../types/chess';
import { Chess } from 'chess.js';
import { EngineSearchResult, EngineSearchInfo, ChessEngine } from './base';
import { buildFetchUrl } from '../client';

// Stockfish API (Online) engine adapter
// Calls a user-hosted Stockfish REST API (CORS-enabled):
// Source: https://github.com/didiwebid/Stockfish-REST-API
// The base URL is entered by the user in the engine settings (config.baseUrl),
// e.g. "https://chess.example.com" or "http://localhost".
//
// The API exposes POST /api/v1/analyze with a JSON body
// { fen, depth?, time?, multipv? } and returns
// { fen, best_move, ponder, evaluations: [{ depth, multipv, score_cp |
//   score_mate, score_type, pv, nodes, nps, ... }] }.

interface ApiEvaluation {
  depth?: number;
  multipv?: number;
  nodes?: number;
  nps?: number;
  seldepth?: number;
  score_cp?: number;
  score_mate?: number;
  score_type?: 'cp' | 'mate';
  pv?: string[];
  time_ms?: number;
}

interface ApiResponse {
  fen: string;
  best_move: string;
  ponder?: string;
  evaluations?: ApiEvaluation[];
}

export class StockfishApiEngine implements ChessEngine {
  private isReadyValue = true;

  async init(_options?: Record<string, unknown>): Promise<void> {
    // Nothing to load — the API is reached on every search.
  }

  async search(
    fen: string,
    config: PlayerConfig,
    signal?: AbortSignal,
    onInfo?: (info: EngineSearchInfo) => void
  ): Promise<EngineSearchResult> {
    const baseUrl = config.baseUrl.trim();
    if (!baseUrl) {
      throw new Error(
        "Add the Stockfish API base URL in this player's engine settings first.",
      );
    }

    const startedAt = Date.now();
    const depth = Math.min(Math.max(1, config.depth ?? 15), 50);
    const movetimeMs = config.movetimeMs;
    const timeoutMs = Math.max(
      movetimeMs ? movetimeMs + 10_000 : 10_000,
      10_000,
    );

    const { url, proxyHeaders } = buildFetchUrl(baseUrl, '/api/v1/analyze');

    const body: Record<string, string | number> = { fen, depth };
    if (movetimeMs) body.time = movetimeMs;

    // One AbortController for both the safety timeout and external aborts.
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...proxyHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`.trim();
        try {
          const text = (await response.text()).trim();
          if (text) detail = text.slice(0, 300);
        } catch {
          // Ignore body-read failures; the status line is enough.
        }
        throw new Error(`Stockfish API error: ${detail}`);
      }

      const data = (await response.json()) as ApiResponse;

      const uciMove = data?.best_move;
      if (!uciMove) {
        throw new Error('Stockfish API returned no best move.');
      }

      // The API reports evaluation at every depth; the final entry is the
      // deepest one and carries the best move's score and PV.
      const latest = data.evaluations?.[data.evaluations.length - 1];
      const mate =
        latest?.score_type === 'mate' && latest.score_mate !== undefined
          ? latest.score_mate
          : undefined;
      const evalCp = mate !== undefined
        ? mate > 0
          ? 20_000 - mate
          : -20_000 - mate
        : latest?.score_cp ?? 0;
      const pv = latest?.pv ?? [uciMove];
      const resultDepth = latest?.depth ?? depth;

      // Convert UCI to SAN for the ChessEngine interface
      let sanMove: string;
      try {
        const chess = new Chess(fen);
        sanMove = chess.move({
          from: uciMove.slice(0, 2),
          to: uciMove.slice(2, 4),
          promotion: uciMove[4]?.toLowerCase() as any,
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
        eval: evalCp,
        depth: resultDepth,
        pv,
        mate,
        time: elapsedMs,
        elapsedMs,
      };

      if (onInfo) {
        onInfo({
          depth: resultDepth,
          eval: evalCp,
          mate,
          pv,
          nps: latest?.nps,
          nodes: latest?.nodes,
        });
      }

      return engineResult;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Search aborted');
      }
      if (controller.signal.aborted) {
        throw new Error('Stockfish API search timed out.');
      }
      if (error instanceof TypeError) {
        throw new Error(
          `Could not reach the Stockfish API: check the base URL and network.`,
        );
      }
      throw new Error(
        `Stockfish API search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  terminate(): void {
    // Stateless — no resources to clean up
  }

  isReady(): boolean {
    return this.isReadyValue;
  }
}
