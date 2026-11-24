import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { Move, PieceSymbol, Square } from 'chess.js';
import type {
  AiMeta,
  Color,
  Controller,
  GameStatus,
  MoveRecord,
} from '../types/chess';

export const START_FEN = DEFAULT_POSITION;

export const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

export const PIECE_GLYPHS: Record<Color, Record<PieceSymbol, string>> = {
  white: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  black: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
};

export function opposite(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

export function colorFromTurn(turn: 'w' | 'b'): Color {
  return turn === 'w' ? 'white' : 'black';
}

export function turnFromColor(color: Color): 'w' | 'b' {
  return color === 'white' ? 'w' : 'b';
}

export function titleForColor(color: Color): string {
  return color === 'white' ? 'White' : 'Black';
}

export function deriveStatus(chess: Chess): GameStatus {
  if (chess.isCheckmate()) {
    return {
      result: chess.turn() === 'w' ? 'black' : 'white',
      reason: 'Checkmate',
    };
  }
  if (chess.isStalemate()) {
    return { result: 'draw', reason: 'Stalemate' };
  }
  if (chess.isInsufficientMaterial()) {
    return { result: 'draw', reason: 'Insufficient material' };
  }
  if (chess.isThreefoldRepetition()) {
    return { result: 'draw', reason: 'Threefold repetition' };
  }
  if (chess.isDrawByFiftyMoves()) {
    return { result: 'draw', reason: 'Fifty-move rule' };
  }
  if (chess.isDraw()) {
    return { result: 'draw', reason: 'Draw' };
  }
  return { result: 'ongoing', reason: '' };
}

export function findKingSquare(fen: string, color: Color): Square | null {
  const chess = new Chess(fen);
  const wanted = color === 'white' ? 'w' : 'b';
  const board = chess.board();
  for (const row of board) {
    for (const square of row) {
      if (square?.type === 'k' && square.color === wanted) {
        return square.square;
      }
    }
  }
  return null;
}

export function getCheckSquare(fen: string): Square | null {
  try {
    const chess = new Chess(fen);
    if (!chess.isCheck()) return null;
    return findKingSquare(fen, colorFromTurn(chess.turn()));
  } catch {
    return null;
  }
}

export function boardMaterial(fen: string): Record<Color, number> {
  const placement = fen.split(' ')[0] ?? '';
  const totals: Record<Color, number> = { white: 0, black: 0 };
  for (const char of placement) {
    const lower = char.toLowerCase();
    if (!(lower in PIECE_VALUES)) continue;
    const value = PIECE_VALUES[lower as PieceSymbol];
    totals[char === char.toUpperCase() ? 'white' : 'black'] += value;
  }
  return totals;
}

export function materialAdvantage(fen: string): { white: number; black: number } {
  const totals = boardMaterial(fen);
  return {
    white: totals.white - totals.black,
    black: totals.black - totals.white,
  };
}

export function getCapturedPieces(
  moves: MoveRecord[],
  byColor: Color,
): Array<{ piece: PieceSymbol; color: Color }> {
  const captured: Array<{ piece: PieceSymbol; color: Color }> = [];
  for (const move of moves) {
    if (move.color === byColor && move.captured) {
      captured.push({ piece: move.captured, color: opposite(byColor) });
    }
  }
  return captured.sort((a, b) => PIECE_VALUES[b.piece] - PIECE_VALUES[a.piece]);
}

export function getCapturedValue(moves: MoveRecord[], byColor: Color): number {
  return getCapturedPieces(moves, byColor).reduce(
    (total, item) => total + PIECE_VALUES[item.piece],
    0,
  );
}

export function moveToRecord(
  move: Move,
  controller: Controller,
  meta: AiMeta = {},
): MoveRecord {
  return {
    ply: 0,
    san: move.san,
    color: colorFromTurn(move.color),
    controller,
    from: move.from,
    to: move.to,
    piece: move.piece,
    captured: move.captured,
    promotion: move.promotion,
    provider: meta.provider,
    model: meta.model,
    reasoning: meta.reasoning,
    confidence: meta.confidence,
    fallback: meta.fallback,
    timestamp: new Date().toISOString(),
    elapsedMs: meta.elapsedMs,
  };
}

/**
 * Resolve free-form AI output to a well-formed SAN move backed by chess.js.
 * Accepts SAN (with or without check/annotation marks) and UCI coordinates.
 */
export function normalizeMoveInput(raw: string, fen: string): string | null {
  const input = raw
    .replace(/```(?:json)?/gi, '')
    .replace(/[`"']/g, '')
    .trim();
  if (!input) return null;

  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }

  const legal = chess.moves();
  const cleaned = input.replace(/[!?]+$/g, '').trim();

  // Exact SAN first.
  if (legal.includes(cleaned)) return cleaned;

  // Sometimes models omit a check/mate marker or include an annotation.
  for (const san of legal) {
    if (san.replace(/[+#]/g, '') === cleaned.replace(/[+#]/g, '')) {
      return san;
    }
  }

  // UCI-style move.
  const uci = cleaned
    .toLowerCase()
    .replace(/^[a-h][1-8][a-h][1-8][qrbn]?$/, (value) => value);
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    try {
      const from = uci.slice(0, 2) as Square;
      const to = uci.slice(2, 4) as Square;
      const promotion = uci.length === 5 ? uci[4] : undefined;
      const probe = new Chess(fen);
      const move = probe.move({ from, to, promotion });
      if (move) return move.san;
    } catch {
      // Fall through.
    }
  }

  // "Nf3" with stray whitespace or a "move:" prefix.
  const candidate = cleaned.replace(/^move\s*[:=]\s*/i, '').trim();
  if (candidate !== cleaned) {
    return normalizeMoveInput(candidate, fen);
  }

  return null;
}

export function getLatestMoveFor(
  moves: MoveRecord[],
  color: Color,
): MoveRecord | undefined {
  for (let index = moves.length - 1; index >= 0; index -= 1) {
    if (moves[index]?.color === color) return moves[index];
  }
  return undefined;
}

export function getGameResultLabel(status: GameStatus): string {
  if (status.result === 'ongoing') return 'In progress';
  if (status.result === 'draw') return `Draw · ${status.reason}`;
  return `${titleForColor(status.result)} wins · ${status.reason}`;
}

export function isTerminal(status: GameStatus): boolean {
  return status.result !== 'ongoing';
}
