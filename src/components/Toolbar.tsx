import {
  ArrowLeftRight,
  Download,
  FileText,
  Flag,
  FolderOpen,
  Handshake,
  Plus,
  Save,
  Undo2,
} from 'lucide-react';
import { useChessStore } from '../store/chessStore';
import { abortAllAiTurns } from '../ai/orchestrator';
import { titleForColor } from '../engine/chessUtils';
import {
  downloadCurrentGame,
  downloadCurrentPgn,
} from '../persistence/saveLoad';

interface ToolbarProps {
  onNewGame: () => void;
  onOpenSaves: (intent: 'save' | 'load') => void;
  onResign: () => void;
  onOfferDraw: () => void;
}

export function Toolbar({
  onNewGame,
  onOpenSaves,
  onResign,
  onOfferDraw,
}: ToolbarProps) {
  const moves = useChessStore((state) => state.moves);
  const status = useChessStore((state) => state.status);
  const turn = useChessStore((state) => state.turn);
  const players = useChessStore((state) => state.players);
  const flipBoard = useChessStore((state) => state.flipBoard);
  const notify = useChessStore((state) => state.notify);
  const gameOver = status.result !== 'ongoing';
  const turnIsHuman = players[turn].controller === 'human';

  const handleUndo = () => {
    const store = useChessStore.getState();
    if (store.moves.length === 0) return;
    abortAllAiTurns();
    store.undo();
    const after = useChessStore.getState();
    const aiPaused = after.players[after.turn].controller === 'ai' && after.aiHold[after.turn];
    notify(
      aiPaused
        ? 'Move undone. The AI is paused — resume it from the player panel.'
        : 'Move undone.',
      'info',
    );
  };

  const handleDownload = () => {
    downloadCurrentGame();
    notify('Game downloaded as JSON.', 'success');
  };

  const handleExportPgn = () => {
    downloadCurrentPgn();
    notify('PGN exported.', 'success');
  };

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span>♞</span>
        </div>
        <div className="brand-copy">
          <span className="brand-name">GAMBIT</span>
          <span className="brand-sub">Local chess table</span>
        </div>
      </div>

      <div className={`match-chip ${gameOver ? 'is-final' : ''}`}>
        <span className={`match-dot ${gameOver ? 'finished' : turn}`} />
        <span>
          {status.result === 'draw'
            ? 'Draw'
            : status.result === 'ongoing'
              ? `${titleForColor(turn)} to move`
              : `${titleForColor(status.result)} wins`}
        </span>
        {!gameOver ? <i>·</i> : null}
        {!gameOver ? <span className="match-move">Move {Math.floor(moves.length / 2) + 1}</span> : null}
      </div>

      <nav className="toolbar" aria-label="Game controls">
        <div className="toolbar-group">
          <button type="button" className="toolbar-btn primary" onClick={onNewGame}>
            <Plus size={16} />
            <span className="toolbar-label">New game</span>
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleUndo}
            disabled={moves.length === 0}
            title="Undo last move"
          >
            <Undo2 size={16} />
            <span className="toolbar-label">Undo</span>
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={flipBoard}
            title="Flip board"
          >
            <ArrowLeftRight size={16} />
            <span className="toolbar-label">Flip</span>
          </button>
        </div>

        <span className="toolbar-divider" aria-hidden="true" />

        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => onOpenSaves('save')}
            title="Save to a local slot"
          >
            <Save size={16} />
            <span className="toolbar-label">Save</span>
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => onOpenSaves('load')}
            title="Load a saved game"
          >
            <FolderOpen size={16} />
            <span className="toolbar-label">Load</span>
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleDownload}
            title="Download game as JSON"
          >
            <Download size={16} />
            <span className="toolbar-label">Download</span>
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleExportPgn}
            title="Export PGN"
          >
            <FileText size={16} />
            <span className="toolbar-label">PGN</span>
          </button>
        </div>

        <span className="toolbar-divider" aria-hidden="true" />

        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={onOfferDraw}
            disabled={gameOver || !turnIsHuman}
            title={
              gameOver
                ? 'The game has ended'
                : turnIsHuman
                  ? 'Offer a draw'
                  : 'Draws can be offered on a human turn'
            }
          >
            <Handshake size={16} />
            <span className="toolbar-label">Draw</span>
          </button>
          <button
            type="button"
            className="toolbar-btn danger"
            onClick={onResign}
            disabled={gameOver}
            title="Resign the game"
          >
            <Flag size={16} />
            <span className="toolbar-label">Resign</span>
          </button>
        </div>
      </nav>
    </header>
  );
}
