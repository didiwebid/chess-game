import {
  ArrowDownToLine,
  Bot,
  Crown,
  FileJson,
  FileText,
  Flag,
  FolderOpen,
  Github,
  Handshake,
  Pause,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { useChessStore } from '../../store/chessStore';
import { abortAllAiTurns } from '../../ai/orchestrator';
import { getGameResultLabel, titleForColor } from '../../engine/chessUtils';
import {
  downloadCurrentGame,
  downloadCurrentPgn,
} from '../../persistence/saveLoad';
import { Toggle } from '../ui/Toggle';

interface GamePanelProps {
  onOpenSaves: (intent: 'save' | 'load') => void;
  onNewGame: () => void;
  onResetAll: () => void;
  onResign: () => void;
  onOfferDraw: () => void;
}

export function GamePanel({
  onOpenSaves,
  onNewGame,
  onResetAll,
  onResign,
  onOfferDraw,
}: GamePanelProps) {
  const status = useChessStore((state) => state.status);
  const turn = useChessStore((state) => state.turn);
  const players = useChessStore((state) => state.players);
  const moves = useChessStore((state) => state.moves);
  const aiPaused = useChessStore((state) => state.aiPaused);
  const setAiPaused = useChessStore((state) => state.setAiPaused);
  const aiDelayMs = useChessStore((state) => state.aiDelayMs);
  const setAiDelayMs = useChessStore((state) => state.setAiDelayMs);
  const showThinking = useChessStore((state) => state.showThinking);
  const setShowThinking = useChessStore((state) => state.setShowThinking);
  const showCoordinates = useChessStore((state) => state.showCoordinates);
  const setShowCoordinates = useChessStore((state) => state.setShowCoordinates);
  const flipBoard = useChessStore((state) => state.flipBoard);
  const notify = useChessStore((state) => state.notify);

  const bothAi =
    players.white.controller === 'ai' && players.black.controller === 'ai';
  const anyAi =
    players.white.controller === 'ai' || players.black.controller === 'ai';
  const gameOver = status.result !== 'ongoing';
  const winnerName =
    status.result === 'white' || status.result === 'black'
      ? players[status.result].name
      : null;

  const toggleAutoplay = () => {
    if (aiPaused) {
      setAiPaused(false);
      notify('AI auto-play resumed.', 'info');
    } else {
      abortAllAiTurns();
      setAiPaused(true);
      notify('AI auto-play paused.', 'info');
    }
  };

  const handleDownload = () => {
    downloadCurrentGame();
    notify('Game downloaded as JSON.', 'success');
  };

  const handlePgn = () => {
    downloadCurrentPgn();
    notify('PGN exported.', 'success');
  };

  return (
    <div className="game-panel-component">
      <div className={`result-card ${gameOver ? 'is-final' : 'is-live'}`}>
        <div className="result-icon">
          {status.result === 'draw' ? (
            <Handshake size={22} />
          ) : gameOver ? (
            <Crown size={22} />
          ) : (
            <span className={`turn-indicator ${turn}`} aria-hidden="true" />
          )}
        </div>
        <div>
          <p className="eyebrow">{gameOver ? 'Final result' : 'Match status'}</p>
          <h3>{gameOver ? getGameResultLabel(status) : `${titleForColor(turn)} to move`}</h3>
          <p>
            {gameOver
              ? winnerName
                ? `${winnerName} takes the game.`
                : 'The point is shared.'
              : `${moves.length} ${moves.length === 1 ? 'ply' : 'plies'} played · move ${Math.floor(moves.length / 2) + 1}`}
          </p>
        </div>
      </div>

      <div className="game-player-strip">
        {(['white', 'black'] as const).map((color) => (
          <div className="game-player-item" key={color}>
            <span className={`ai-chip-dot ${color}`} />
            <div>
              <strong>{players[color].name}</strong>
              <span>{players[color].controller === 'ai' ? 'AI player' : 'Human'}</span>
            </div>
            {players[color].controller === 'ai' ? <Bot size={14} /> : <Users size={14} />}
          </div>
        ))}
      </div>

      {bothAi ? (
        <section className="game-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">AI vs AI</p>
              <h4>Auto-play</h4>
            </div>
            <button
              type="button"
              className={`autoplay-button ${aiPaused ? 'is-paused' : ''}`}
              onClick={toggleAutoplay}
            >
              {aiPaused ? <Play size={13} /> : <Pause size={13} />}
              {aiPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
          <div className="delay-row">
            <label htmlFor="ai-delay">Between moves</label>
            <span>{(aiDelayMs / 1000).toFixed(1)}s</span>
            <input
              id="ai-delay"
              type="range"
              min={300}
              max={3000}
              step={100}
              value={aiDelayMs}
              onChange={(event) => setAiDelayMs(Number(event.target.value))}
              disabled={!bothAi}
            />
          </div>
          <p className="section-note">
            {aiPaused
              ? 'Auto-play is paused. The current request, if any, was stopped.'
              : 'Both sides are AI. Play proceeds automatically.'}
          </p>
        </section>
      ) : null}

      {anyAi && !bothAi ? (
        <section className="game-section compact-section">
          <div className="ai-army-row">
            <Bot size={16} />
            <div>
              <strong>One AI seat active</strong>
              <span>The AI will respond automatically on its turn.</span>
            </div>
          </div>
        </section>
      ) : null}

      <section className="game-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Game data</p>
            <h4>Save &amp; export</h4>
          </div>
        </div>
        <div className="action-grid">
          <button type="button" className="data-action" onClick={() => onOpenSaves('save')}>
            <Save size={15} />
            <span>Save slot</span>
          </button>
          <button type="button" className="data-action" onClick={() => onOpenSaves('load')}>
            <FolderOpen size={15} />
            <span>Load game</span>
          </button>
          <button type="button" className="data-action" onClick={handleDownload}>
            <FileJson size={15} />
            <span>Download JSON</span>
          </button>
          <button type="button" className="data-action" onClick={handlePgn}>
            <FileText size={15} />
            <span>Export PGN</span>
          </button>
        </div>
        <p className="section-note">
          API keys are never written into save files or PGN exports.
        </p>
      </section>

      <section className="game-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Board &amp; interface</p>
            <h4>Display</h4>
          </div>
        </div>
        <div className="display-toggle-row">
          <span>
            <Sparkles size={14} />
            Show AI reasoning
          </span>
          <Toggle
            checked={showThinking}
            onChange={setShowThinking}
            label="Show AI reasoning"
          />
        </div>
        <div className="display-toggle-row">
          <span>
            <ArrowDownToLine size={14} className="rotate-icon" />
            Show coordinates
          </span>
          <Toggle
            checked={showCoordinates}
            onChange={setShowCoordinates}
            label="Show board coordinates"
          />
        </div>
        <button type="button" className="data-action display-action" onClick={flipBoard}>
          <RotateCcw size={15} />
          <span>Flip board orientation</span>
        </button>
      </section>

      <section className="game-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Table controls</p>
            <h4>End or restart</h4>
          </div>
        </div>
        <div className="action-grid">
          <button
            type="button"
            className="data-action"
            onClick={onOfferDraw}
            disabled={gameOver}
          >
            <Handshake size={15} />
            <span>Offer draw</span>
          </button>
          <button
            type="button"
            className="data-action danger-action"
            onClick={onResign}
            disabled={gameOver}
          >
            <Flag size={15} />
            <span>Resign</span>
          </button>
        </div>
        <div className="action-grid table-actions">
          <button type="button" className="secondary-button" onClick={onNewGame}>
            <RotateCcw size={14} />
            New game
          </button>
          <button type="button" className="danger-subtle-button" onClick={onResetAll}>
            <Trash2 size={14} />
            Reset all
          </button>
        </div>
      </section>

      <div className="local-note">
        <span className="local-dot" />
        <div>
          <strong>Entirely local</strong>
          <p>No account, server, or analytics. Only your configured AI provider receives a request.</p>
        </div>
      </div>

      <a
        className="project-link project-link--footer"
        href="https://github.com/didiwebid/chess-game"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Github size={14} />
        <span>View source on GitHub</span>
      </a>
    </div>
  );
}
