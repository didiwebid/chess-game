import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Square } from 'chess.js';
import { Eye, RotateCcw } from 'lucide-react';
import {
  findPromotionCandidate,
  getLegalTargets,
  getPieceAt,
  useChessStore,
} from '../../store/chessStore';
import {
  PIECE_GLYPHS,
  getCheckSquare,
  materialAdvantage,
  titleForColor,
} from '../../engine/chessUtils';
import type { Color } from '../../types/chess';

const PROMOTION_OPTIONS = [
  { piece: 'q', label: 'Queen' },
  { piece: 'r', label: 'Rook' },
  { piece: 'b', label: 'Bishop' },
  { piece: 'n', label: 'Knight' },
] as const;

interface PendingPromotion {
  from: Square;
  to: Square;
  color: Color;
}

function useBoardWidth() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      const styles = window.getComputedStyle(node);
      const horizontalPadding =
        parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      setWidth(Math.max(240, Math.floor(rect.width - horizontalPadding)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { frameRef, width };
}

export function BoardArea() {
  const { frameRef, width } = useBoardWidth();
  const fen = useChessStore((state) => state.fen);
  const snapshots = useChessStore((state) => state.snapshots);
  const moves = useChessStore((state) => state.moves);
  const turn = useChessStore((state) => state.turn);
  const players = useChessStore((state) => state.players);
  const status = useChessStore((state) => state.status);
  const thinking = useChessStore((state) => state.thinking);
  const orientation = useChessStore((state) => state.orientation);
  const showCoordinates = useChessStore((state) => state.showCoordinates);
  const viewPly = useChessStore((state) => state.viewPly);
  const setViewPly = useChessStore((state) => state.setViewPly);
  const makeMove = useChessStore((state) => state.makeMove);
  const notify = useChessStore((state) => state.notify);

  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] =
    useState<PendingPromotion | null>(null);

  const currentPly = viewPly ?? moves.length;
  const position = snapshots[currentPly] ?? fen;
  const latestMove = currentPly > 0 ? moves[currentPly - 1] : undefined;
  const canInteract =
    viewPly === null &&
    status.result === 'ongoing' &&
    players[turn].controller === 'human' &&
    !thinking[turn];
  const legalTargets = useMemo(() => {
    if (!selectedSquare || !canInteract) return [] as Square[];
    return getLegalTargets(fen, selectedSquare);
  }, [canInteract, fen, selectedSquare]);

  useEffect(() => {
    setSelectedSquare(null);
    setPendingPromotion(null);
  }, [position, viewPly, status.result, canInteract]);

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, Record<string, string | number>> = {};
    if (latestMove?.from) {
      styles[latestMove.from] = {
        backgroundImage:
          'linear-gradient(rgba(213, 176, 111, 0.24), rgba(213, 176, 111, 0.24))',
      };
    }
    if (latestMove?.to) {
      styles[latestMove.to] = {
        backgroundImage:
          'linear-gradient(rgba(213, 176, 111, 0.3), rgba(213, 176, 111, 0.3))',
      };
    }

    const checkSquare = getCheckSquare(position);
    if (checkSquare) {
      styles[checkSquare] = {
        ...styles[checkSquare],
        backgroundImage:
          'radial-gradient(circle, rgba(182, 78, 68, 0.68) 0%, rgba(182, 78, 68, 0.28) 45%, transparent 72%)',
      };
    }

    if (selectedSquare) {
      styles[selectedSquare] = {
        ...styles[selectedSquare],
        boxShadow: 'inset 0 0 0 3px rgba(230, 197, 133, 0.9)',
      };
    }

    for (const target of legalTargets) {
      const targetPiece = getPieceAt(position, target);
      if (targetPiece) {
        styles[target] = {
          ...styles[target],
          backgroundImage:
            'radial-gradient(circle at center, transparent 0 57%, rgba(230, 197, 133, 0.48) 59%, rgba(230, 197, 133, 0.48) 70%, transparent 72%)',
        };
      } else {
        styles[target] = {
          ...styles[target],
          backgroundImage:
            'radial-gradient(circle at center, rgba(230, 197, 133, 0.64) 0 13%, transparent 15%)',
        };
      }
    }

    return styles;
  }, [latestMove, legalTargets, position, selectedSquare, status.result]);

  const attemptMove = (from: Square, to: Square) => {
    if (!canInteract) return false;
    const piece = getPieceAt(fen, from);
    if (!piece) return false;
    if (findPromotionCandidate(fen, from, to) && legalTargets.includes(to)) {
      setPendingPromotion({ from, to, color: piece.color === 'w' ? 'white' : 'black' });
      setSelectedSquare(null);
      return false;
    }
    const result = makeMove({ from, to });
    if (!result.ok) {
      if (result.error && result.error !== 'That move is not legal.') {
        notify(result.error, 'warning');
      }
      return false;
    }
    setSelectedSquare(null);
    return true;
  };

  const completePromotion = (piece: 'q' | 'r' | 'b' | 'n') => {
    if (!pendingPromotion) return;
    const result = makeMove({
      from: pendingPromotion.from,
      to: pendingPromotion.to,
      promotion: piece,
    });
    if (!result.ok) {
      notify(result.error ?? 'That promotion is not legal.', 'warning');
    }
    setPendingPromotion(null);
    setSelectedSquare(null);
  };

  const handleSquareClick = (square: Square) => {
    if (!canInteract) return;
    const typedSquare = square;
    const pieceAtTarget = getPieceAt(fen, typedSquare);
    const ownColor = turn === 'white' ? 'w' : 'b';

    if (selectedSquare) {
      if (selectedSquare === typedSquare) {
        setSelectedSquare(null);
        return;
      }
      if (legalTargets.includes(typedSquare)) {
        attemptMove(selectedSquare, typedSquare);
        return;
      }
      if (pieceAtTarget?.color === ownColor) {
        setSelectedSquare(typedSquare);
        return;
      }
      setSelectedSquare(null);
      return;
    }

    if (pieceAtTarget?.color === ownColor) {
      setSelectedSquare(typedSquare);
    }
  };

  const playerToMove = players[turn];
  const advantage = materialAdvantage(fen);
  const viewingHistory = viewPly !== null;

  return (
    <div className="board-area">
      <div
        className={`board-frame ${viewingHistory ? 'is-reviewing' : ''} ${
          status.result !== 'ongoing' ? 'is-finished' : ''
        }`}
        ref={frameRef}
      >
        <div className="board-corner top-left" aria-hidden="true" />
        <div className="board-corner top-right" aria-hidden="true" />
        <div className="board-corner bottom-left" aria-hidden="true" />
        <div className="board-corner bottom-right" aria-hidden="true" />

        <Chessboard
          id="gambit-board"
          boardWidth={width}
          position={position}
          boardOrientation={orientation}
          onPieceDrop={(source, target) => attemptMove(source as Square, target as Square)}
          onSquareClick={(square) => handleSquareClick(square as Square)}
          onPieceDragBegin={(_piece, source) => {
            if (canInteract) setSelectedSquare(source as Square);
          }}
          onPieceDragEnd={() => {
            if (!pendingPromotion) setSelectedSquare(null);
          }}
          isDraggablePiece={({ piece }) => {
            if (!canInteract) return false;
            return piece.startsWith(turn === 'white' ? 'w' : 'b');
          }}
          arePiecesDraggable={canInteract}
          arePremovesAllowed={false}
          allowDragOutsideBoard={false}
          animationDuration={220}
          showBoardNotation={showCoordinates}
          customBoardStyle={{
            borderRadius: '3px',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.38)',
          }}
          customLightSquareStyle={{ backgroundColor: '#dfd0b4' }}
          customDarkSquareStyle={{ backgroundColor: '#8b6b4e' }}
          customNotationStyle={{
            color: 'rgba(32, 24, 17, 0.65)',
            fontSize: '10px',
            fontWeight: '700',
            letterSpacing: '0.03em',
          }}
          customDropSquareStyle={{
            boxShadow: 'inset 0 0 0 3px rgba(240, 211, 156, 0.9)',
          }}
          customSquareStyles={customSquareStyles}
        />

        {pendingPromotion ? (
          <div
            className="promotion-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setPendingPromotion(null);
            }}
          >
            <div className="promotion-panel" role="dialog" aria-label="Choose promotion piece">
              <p className="eyebrow">Pawn reaches the back rank</p>
              <h3>Promote to</h3>
              <div className="promotion-options">
                {PROMOTION_OPTIONS.map((option) => (
                  <button
                    key={option.piece}
                    type="button"
                    className="promotion-option"
                    onClick={() => completePromotion(option.piece)}
                    autoFocus={option.piece === 'q'}
                  >
                    <span className={`promotion-glyph ${pendingPromotion.color}`}>
                      {PIECE_GLYPHS[pendingPromotion.color][option.piece]}
                    </span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="text-button promotion-cancel"
                onClick={() => setPendingPromotion(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="board-caption">
        <div className="board-turn">
          <span
            className={`turn-indicator ${
              status.result === 'ongoing' ? turn : 'finished'
            }`}
            aria-hidden="true"
          />
          <div>
            <strong>
              {status.result === 'ongoing'
                ? `${titleForColor(turn)} to move`
                : status.result === 'draw'
                  ? 'Drawn game'
                  : `${titleForColor(status.result)} wins`}
            </strong>
            <span>
              Move {Math.floor(moves.length / 2) + 1} · {moves.length} ply
              {advantage.white !== 0
                ? ` · ${advantage.white > 0 ? 'White' : 'Black'} +${Math.abs(advantage.white)}`
                : ''}
            </span>
          </div>
        </div>

        {viewingHistory ? (
          <div className="review-controls">
            <Eye size={14} />
            <span>Reviewing move {currentPly}</span>
            <button type="button" onClick={() => setViewPly(null)}>
              <RotateCcw size={13} />
              Back to live
            </button>
          </div>
        ) : (
          <span className="board-hint">
            {canInteract
              ? 'Drag a piece or tap two squares'
              : status.result === 'ongoing'
                ? `${playerToMove.name} is thinking`
                : 'The game has ended'}
          </span>
        )}
      </div>
    </div>
  );
}
