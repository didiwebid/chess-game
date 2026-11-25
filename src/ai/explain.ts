import { Chess } from 'chess.js';
import type { Move, PieceSymbol, Square } from 'chess.js';
import type { Color } from '../types/chess';
import { PIECE_VALUES, opposite, titleForColor } from '../engine/chessUtils';
import type { EngineSearchResult } from './engines/base';

/**
 * Pure, dependency-light helpers that turn engine output and a chess.js
 * position into human-readable reasoning. No store access, no side effects.
 */

// ---------------------------------------------------------------------------
// Principal variation conversion
// ---------------------------------------------------------------------------

/**
 * Convert a list of UCI moves (e.g. ["e2e4", "e7e5"]) to SAN by replaying
 * them from `fen`. Tolerant of moves that are already SAN (Tonnetto/Fallback
 * emit SAN) and stops at the first move that cannot be applied.
 */
export function pvToSan(fen: string, moves: string[], maxMoves = 12): string[] {
  if (!moves || moves.length === 0) return [];
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }

  const result: string[] = [];
  for (const move of moves.slice(0, maxMoves)) {
    const clean = move.trim();
    if (!clean) break;

    let applied: Move | undefined;
    // UCI first.
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(clean)) {
      try {
        applied = chess.move({
          from: clean.slice(0, 2) as Square,
          to: clean.slice(2, 4) as Square,
          promotion: clean[4] as 'q' | 'r' | 'b' | 'n' | undefined,
        });
      } catch {
        applied = undefined;
      }
    }
    // Fall back to SAN.
    if (!applied) {
      try {
        applied = chess.move(clean.replace(/[+#]/g, ''));
      } catch {
        applied = undefined;
      }
    }
    if (!applied) break;
    result.push(applied.san);
  }
  return result;
}

/**
 * Apply a SAN move to a FEN and return the resulting FEN, or null if the
 * move is not legal from the given position.
 */
export function applyMoveToFen(fen: string, san: string): string | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move(san.replace(/[+#]/g, ''));
    return move ? chess.fen() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Position analysis
// ---------------------------------------------------------------------------

export interface PositionFacts {
  inCheck: boolean;
  /** Material advantage (positive = White ahead), in pawns. */
  materialWhite: number;
  materialBlack: number;
  whiteCastled: boolean;
  blackCastled: boolean;
  phase: 'opening' | 'middlegame' | 'endgame';
  /** Number of the side-to-move's knights/bishops still on their starting squares. */
  minorPiecesAtHome: number;
  /** Number of opponent pieces under attack by the side to move. */
  attackedEnemyPieces: number;
}

function kingSquare(chess: Chess, color: Color): Square | null {
  const wanted = color === 'white' ? 'w' : 'b';
  for (const row of chess.board()) {
    for (const square of row) {
      if (square?.type === 'k' && square.color === wanted) return square.square;
    }
  }
  return null;
}

function materialForColor(chess: Chess, color: Color): number {
  const wanted = color === 'white' ? 'w' : 'b';
  let total = 0;
  for (const row of chess.board()) {
    for (const square of row) {
      if (!square || square.color !== wanted) continue;
      total += PIECE_VALUES[square.type as PieceSymbol] ?? 0;
    }
  }
  return total;
}

function homeSquaresFor(color: Color): Square[] {
  // Only the minor pieces (knights and bishops) need to develop; the king and
  // queen legitimately stay on the back rank for a long time.
  return color === 'white'
    ? ['b1', 'c1', 'f1', 'g1']
    : ['b8', 'c8', 'f8', 'g8'];
}

/**
 * Compute a compact set of positional facts from a FEN. Used to phrase the
 * engine's reasoning in plain language.
 */
export function analyzePosition(fen: string): PositionFacts {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return {
      inCheck: false,
      materialWhite: 0,
      materialBlack: 0,
      whiteCastled: false,
      blackCastled: false,
      phase: 'middlegame',
      minorPiecesAtHome: 0,
      attackedEnemyPieces: 0,
    };
  }

  const turnColor: Color = chess.turn() === 'w' ? 'white' : 'black';
  const whiteKing = kingSquare(chess, 'white');
  const blackKing = kingSquare(chess, 'black');

  // Development proxy: how many of the side-to-move's minor pieces (knights
  // and bishops) still sit on their starting squares.
  const home = homeSquaresFor(turnColor);
  const wanted = turnColor === 'white' ? 'w' : 'b';
  let minorPiecesAtHome = 0;
  for (const square of home) {
    const piece = chess.get(square as Square);
    if (piece && piece.color === wanted) minorPiecesAtHome += 1;
  }

  // Count opponent pieces attacked by the side to move.
  const opponent: Color = opposite(turnColor);
  const opponentWanted = opponent === 'white' ? 'w' : 'b';
  const legal = chess.moves({ verbose: true });
  const attacked = new Set<Square>();
  for (const move of legal) {
    if (move.captured) attacked.add(move.to);
  }
  let attackedEnemyPieces = 0;
  for (const row of chess.board()) {
    for (const square of row) {
      if (square?.color === opponentWanted && attacked.has(square.square)) {
        attackedEnemyPieces += 1;
      }
    }
  }

  // Phase: opening while both queens are on and few moves have been made,
  // endgame when queens are off or material is light.
  const queensOn =
    chess.get('d1')?.type === 'q' || chess.get('d8')?.type === 'q';
  const halfMoves = Math.floor(chess.moveNumber());
  let phase: PositionFacts['phase'] = 'middlegame';
  if (halfMoves <= 8) phase = 'opening';
  else if (!queensOn || materialForColor(chess, 'white') + materialForColor(chess, 'black') <= 24) {
    phase = 'endgame';
  }

  return {
    inCheck: chess.isCheck(),
    materialWhite: materialForColor(chess, 'white'),
    materialBlack: materialForColor(chess, 'black'),
    whiteCastled: whiteKing === 'g1' || whiteKing === 'c1',
    blackCastled: blackKing === 'g8' || blackKing === 'c8',
    phase,
    minorPiecesAtHome,
    attackedEnemyPieces,
  };
}

// ---------------------------------------------------------------------------
// Move description
// ---------------------------------------------------------------------------

/**
 * Produce a short clause describing what a move does, given the position
 * before it is played. Returns '' if the move cannot be resolved.
 */
export function describeMove(fen: string, san: string): string {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return '';
  }

  const move = chess
    .moves({ verbose: true })
    .find((candidate) => candidate.san.replace(/[+#]/g, '') === san.replace(/[+#]/g, ''));
  if (!move) return '';

  const pieceName: Record<PieceSymbol, string> = {
    p: 'pawn',
    n: 'knight',
    b: 'bishop',
    r: 'rook',
    q: 'queen',
    k: 'king',
  };

  const parts: string[] = [];
  if (move.san.startsWith('O-O-O')) {
    parts.push('Castles queenside');
  } else if (move.san.startsWith('O-O')) {
    parts.push('Castles kingside');
  } else {
    parts.push(`${titleForColor(move.color === 'w' ? 'white' : 'black')}'s ${pieceName[move.piece]} moves to ${move.to}`);
  }

  if (move.captured) {
    parts.push(`capturing the ${pieceName[move.captured]}`);
    if (move.san.includes('e.p.')) parts.push('en passant');
  }
  if (move.promotion) {
    parts.push(`promoting to a ${pieceName[move.promotion]}`);
  }
  if (move.san.endsWith('#')) {
    parts.push('delivering checkmate');
  } else if (move.san.endsWith('+')) {
    parts.push('giving check');
  }

  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Opening detection
// ---------------------------------------------------------------------------

// A small built-in table of common openings, matched against the SAN move
// list (longest-prefix first). Kept intentionally small and conservative.
const OPENING_TABLE: Array<{ key: string; name: string }> = [
  { key: 'e4 e5 Nf3 Nc6 Bb5', name: 'Ruy López' },
  { key: 'e4 e5 Nf3 Nc6 Bc4', name: 'Italian Game' },
  { key: 'e4 e5 Nf3 Nf6', name: 'Petrov Defense' },
  { key: 'e4 e5 Nf3', name: 'King\u2019s Pawn Game' },
  { key: 'e4 e5', name: 'King\u2019s Pawn Game' },
  { key: 'e4 c5 Nf3 d6', name: 'Sicilian Defense' },
  { key: 'e4 c5', name: 'Sicilian Defense' },
  { key: 'e4 e6', name: 'French Defense' },
  { key: 'e4 d5', name: 'Scandinavian Defense' },
  { key: 'e4 c6', name: 'Caro-Kann Defense' },
  { key: 'd4 d5 c4', name: 'Queen\u2019s Gambit' },
  { key: 'd4 d5', name: 'Queen\u2019s Pawn Game' },
  { key: 'd4 Nf6 c4 g6', name: 'King\u2019s Indian Defense' },
  { key: 'd4 Nf6 c4 e6', name: 'Nimzo-Indian Defense' },
  { key: 'd4 e6 c4', name: 'French Defense' },
  { key: 'd4 d6', name: 'Pirc Defense' },
  { key: 'c4', name: 'English Opening' },
  { key: 'Nf3', name: 'Réti Opening' },
  { key: 'g3', name: 'Modern Opening' },
  { key: 'f4', name: 'Bird\u2019s Opening' },
  { key: 'b3', name: 'Queen\u2019s Indian Defense' },
  { key: 'e4', name: 'King\u2019s Pawn Opening' },
  { key: 'd4', name: 'Queen\u2019s Pawn Opening' },
];

/**
 * Detect the opening name from the SAN move list (including the current
 * move). Returns null when no known opening matches.
 */
export function detectOpening(sanMoves: string[]): string | null {
  if (sanMoves.length === 0) return null;
  // Match the longest prefix first.
  const sorted = [...OPENING_TABLE].sort(
    (a, b) => b.key.split(' ').length - a.key.split(' ').length,
  );
  for (const entry of sorted) {
    const pieces = entry.key.split(' ');
    if (sanMoves.length < pieces.length) continue;
    const match = pieces.every((san, index) => {
      const actual = sanMoves[index].replace(/[+#]/g, '');
      return actual === san;
    });
    if (match) return entry.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reasoning composition
// ---------------------------------------------------------------------------

function formatEval(cp: number, engineIsWhite: boolean): string {
  const value = (engineIsWhite ? cp : -cp) / 100;
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function describeEval(cp: number, engineIsWhite: boolean): string {
  const value = (engineIsWhite ? cp : -cp) / 100;
  const abs = Math.abs(value);
  if (abs < 0.15) return 'the position is roughly balanced';
  const leader = value > 0
    ? (engineIsWhite ? 'White' : 'Black')
    : (engineIsWhite ? 'Black' : 'White');
  const scale =
    abs >= 1.5 ? 'a large advantage' : abs >= 0.6 ? 'a clear advantage' : 'a modest edge';
  return `${leader} has ${scale}`;
}

export interface EngineReasoning {
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
  pvSan: string[];
}

/**
 * Compose a descriptive, human-readable explanation of the engine's move.
 *
 * @param fen Position before the move.
 * @param color The side the engine is playing.
 * @param san The SAN move the engine chose.
 * @param result The engine search result.
 * @param historySan Full SAN history including the current move.
 */
export function buildEngineReasoning(options: {
  fen: string;
  color: Color;
  san: string;
  result: EngineSearchResult;
  historySan: string[];
  providerType: string;
}): EngineReasoning {
  const { fen, color, san, result, historySan, providerType } = options;
  const hasEval = providerType === 'stockfish' || providerType === 'lozza';

  const sentence: string[] = [];

  // 1. What the move does.
  const moveDesc = describeMove(fen, san);
  if (moveDesc) sentence.push(moveDesc.charAt(0).toUpperCase() + moveDesc.slice(1));

  // 2. Opening context (first ~8 plies).
  const opening = detectOpening(historySan);
  if (opening && historySan.length <= 16) {
    sentence.push(`This is the ${opening}.`);
  }

  // 3. Positional rationale, based on the position after the move.
  const preFacts = analyzePosition(fen);
  if (preFacts.inCheck) {
    sentence.push('The move responds to the check on the king.');
  }
  const postFen = applyMoveToFen(fen, san);
  if (postFen) {
    const postFacts = analyzePosition(postFen);
    if (postFacts.attackedEnemyPieces > 0) {
      sentence.push(
        `After the move, the opponent has ${postFacts.attackedEnemyPieces} piece${postFacts.attackedEnemyPieces === 1 ? '' : 's'} under attack.`,
      );
    }
    if (postFacts.minorPiecesAtHome > 2) {
      sentence.push('Development is not yet complete, with several pieces still at home.');
    }
  }

  // 4. Main line preview.
  const pvSan = pvToSan(fen, result.pv, 10);
  if (pvSan.length > 1) {
    const line = pvSan.slice(0, 8).join(' ');
    sentence.push(`The engine's main line continues: ${line}.`);
  }

  // 5. Evaluation / confidence.
  let confidence: EngineReasoning['confidence'];
  if (result.mate !== undefined) {
    sentence.push(
      result.mate > 0
        ? `The engine sees a forced mate in ${result.mate} for ${titleForColor(color)}.`
        : `The engine is lost, facing mate in ${Math.abs(result.mate)}.`,
    );
    confidence = 'high';
  } else if (hasEval) {
    const engineIsWhite = color === 'white';
    const evalLabel = formatEval(result.eval, engineIsWhite);
    sentence.push(
      `At depth ${result.depth}, the evaluation is ${evalLabel} — ${describeEval(result.eval, engineIsWhite)}.`,
    );
    const abs = Math.abs(result.eval);
    confidence = abs >= 100 ? 'high' : 'medium';
  } else {
    sentence.push(
      `The local engine chose this move at depth ${result.depth}. It does not report a numeric evaluation, so the choice is based on its internal search.`,
    );
    confidence = 'low';
  }

  return {
    reasoning: sentence.join(' '),
    confidence,
    pvSan,
  };
}

/**
 * Format a live engine search progress line for the thinking stream.
 * Example: "Depth 9 · +0.35 · e4 e5 Nf3 Nc6 Bb5"
 */
export function formatEngineInfo(info: {
  depth?: number;
  eval?: number;
  mate?: number;
  pv?: string[];
}, fen: string, color: Color): string {
  const bits: string[] = [];
  if (info.depth !== undefined) bits.push(`Depth ${info.depth}`);
  if (info.mate !== undefined) {
    bits.push(info.mate > 0 ? `mate in ${info.mate}` : `mated in ${Math.abs(info.mate)}`);
  } else if (info.eval !== undefined) {
    const value = (color === 'white' ? info.eval : -info.eval) / 100;
    const sign = value >= 0 ? '+' : '';
    bits.push(`${sign}${value.toFixed(2)}`);
  }
  const pvSan = pvToSan(fen, info.pv ?? [], 8);
  if (pvSan.length > 0) bits.push(pvSan.join(' '));
  return bits.join(' · ');
}
