import { Chess } from 'chess.js';
import type { PieceSymbol } from 'chess.js';
import type { Color } from '../types/chess';
import { PIECE_VALUES, colorFromTurn } from './chessUtils';

const CENTER_BONUS: Record<string, number> = {
  d4: 0.28,
  e4: 0.28,
  d5: 0.28,
  e5: 0.28,
  c4: 0.12,
  f4: 0.12,
  c5: 0.12,
  f5: 0.12,
};

function materialFor(chess: Chess, color: Color): number {
  let score = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const pieceColor = piece.color === 'w' ? 'white' : 'black';
      const value = PIECE_VALUES[piece.type as PieceSymbol];
      score += pieceColor === color ? value : -value;
    }
  }
  return score;
}

/**
 * Deterministic, dependency-free fallback for when an AI endpoint cannot
 * produce a legal move. It does a one-ply material scan with tiny positional
 * and checking bonuses, then chooses by SAN for stable results.
 */
export function chooseFallbackMove(fen: string): string | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const color = colorFromTurn(chess.turn());
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) return null;

  let bestSan: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const move of legalMoves) {
    let score = 0;
    try {
      const probe = new Chess(fen);
      probe.move(move.san);
      if (probe.isCheckmate()) {
        score = 1_000;
      } else {
        score = materialFor(probe, color);
        score += CENTER_BONUS[move.to] ?? 0;
        if (probe.isCheck()) score += 0.18;
        if (move.promotion) score += PIECE_VALUES[move.promotion] - 1;
        // Avoid leaving the queen hanging on the next ply in the cheapest possible way.
        if (move.piece === 'q' && probe.isCheckmate() === false) score -= 0.02;
        if (probe.isStalemate()) score = Math.max(score, 0);
      }
    } catch {
      continue;
    }

    if (
      score > bestScore ||
      (score === bestScore && (bestSan === null || move.san < bestSan))
    ) {
      bestScore = score;
      bestSan = move.san;
    }
  }

  return bestSan;
}

