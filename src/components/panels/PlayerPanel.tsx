import {
  AlertTriangle,
  Bot,
  Clock3,
  RotateCcw,
  Settings2,
  UserRound,
} from 'lucide-react';
import { useChessStore } from '../../store/chessStore';
import type { Color, Controller } from '../../types/chess';
import {
  PIECE_GLYPHS,
  getCapturedPieces,
  materialAdvantage,
} from '../../engine/chessUtils';
import { extractPartialReasoning } from '../../ai/contextManager';
import { formatElapsed, useElapsed } from '../../hooks/useElapsed';

interface PlayerPanelProps {
  color: Color;
  onOpenConfig: (color: Color) => void;
  onToggleController: (color: Color, controller: Controller) => void;
  onResumeAi: (color: Color) => void;
}

export function PlayerPanel({
  color,
  onOpenConfig,
  onToggleController,
  onResumeAi,
}: PlayerPanelProps) {
  const player = useChessStore((state) => state.players[color]);
  const turn = useChessStore((state) => state.turn);
  const status = useChessStore((state) => state.status);
  const inCheck = useChessStore((state) => state.inCheck);
  const moves = useChessStore((state) => state.moves);
  const fen = useChessStore((state) => state.fen);
  const thinking = useChessStore((state) => state.thinking[color]);
  const thinkingStartedAt = useChessStore(
    (state) => state.thinkingStartedAt[color],
  );
  const aiError = useChessStore((state) => state.aiErrors[color]);
  const aiHold = useChessStore((state) => state.aiHold[color]);
  const showThinking = useChessStore((state) => state.showThinking);
  const streamRaw = useChessStore((state) => state.streamRaw[color]);
  const streamReasoning = useChessStore((state) => state.streamReasoning[color]);
  const score = useChessStore((state) => state.scoreboard[color]);

  const elapsed = useElapsed(thinking ? thinkingStartedAt : null);
  const active = status.result === 'ongoing' && turn === color;
  const captured = getCapturedPieces(moves, color);
  const advantage = materialAdvantage(fen)[color];
  const isAi = player.controller === 'ai';
  const playerWon = status.result === color;
  const draw = status.result === 'draw';
  const scorePoints = score.wins + score.draws * 0.5;
  const scoreLabel = Number.isInteger(scorePoints)
    ? String(scorePoints)
    : scorePoints.toFixed(1);
  const liveReasoning =
    streamReasoning.trim() ||
    extractPartialReasoning(streamRaw) ||
    'Reading the position';
  const compactReasoning = liveReasoning.replace(/\s+/g, ' ').trim();

  let statusText = active ? 'To move' : 'Waiting';
  if (status.result !== 'ongoing') {
    statusText = playerWon ? 'Winner' : draw ? 'Draw' : 'Game over';
  } else if (thinking) {
    statusText = `Thinking · ${formatElapsed(elapsed)}`;
  } else if (aiHold && active) {
    statusText = 'AI stopped';
  } else if (active && inCheck) {
    statusText = 'In check';
  } else if (active) {
    statusText = isAi ? 'AI to move' : 'Your move';
  } else if (isAi) {
    statusText = 'Waiting';
  }

  return (
    <article
      className={`player-panel ${active ? 'is-active' : ''} ${
        thinking ? 'is-thinking' : ''
      } ${color}`}
      aria-label={`${player.name}, ${player.controller === 'ai' ? 'AI player' : 'human player'}`}
    >
      <div className="player-main">
        <div className={`player-avatar ${isAi ? 'is-ai' : ''}`}>
          {isAi ? <Bot size={22} /> : <span>{player.name.charAt(0).toUpperCase() || '?'}</span>}
          <i className="color-pip" aria-hidden="true" />
        </div>

        <div className="player-core">
          <div className="player-eyebrow">
            <span>{color}</span>
            <span className="dot-separator" />
            <span>
              {isAi ? (
                player.config.providerType === 'openai'
                  ? player.config.model || 'AI player'
                  : player.config.providerType.charAt(0).toUpperCase() + player.config.providerType.slice(1)
              ) : 'Human player'}
            </span>
          </div>
          <div className="player-name-row">
            <h2>{player.name}</h2>
            {active ? <span className="turn-chip">On move</span> : null}
            <span
              className="score-chip"
              title={`Score: ${score.wins}W · ${score.draws}D · ${score.losses}L`}
            >
              {scoreLabel} pts
            </span>
            {aiError ? (
              <button
                type="button"
                className="player-error-chip"
                title={`${aiError.message}${aiError.detail ? `\n\n${aiError.detail}` : ''}`}
                onClick={() => onOpenConfig(color)}
                aria-label="AI error. Open settings."
              >
                <AlertTriangle size={12} />
                AI issue
              </button>
            ) : null}
          </div>
          <div className="player-meta">
            {captured.length > 0 ? (
              <span
                className="captured-pieces"
                title={`Pieces captured by ${player.name}`}
              >
                {captured.map((piece, index) => (
                  <span
                    key={`${piece.piece}-${piece.color}-${index}`}
                    className={`captured-piece ${piece.color}`}
                  >
                    {PIECE_GLYPHS[piece.color][piece.piece]}
                  </span>
                ))}
              </span>
            ) : (
              <span className="captured-empty">No captures</span>
            )}
            {advantage > 0 ? (
              <span className="material-pill">+{advantage}</span>
            ) : null}
          </div>
        </div>

        <div className="player-controls">
          <div className="controller-toggle" role="group" aria-label="Player type">
            <button
              type="button"
              className={!isAi ? 'is-selected' : ''}
              aria-pressed={!isAi}
              onClick={() => onToggleController(color, 'human')}
              title={`Make ${player.name} human`}
            >
              <UserRound size={13} />
              <span>Human</span>
            </button>
            <button
              type="button"
              className={isAi ? 'is-selected' : ''}
              aria-pressed={isAi}
              onClick={() => onToggleController(color, 'ai')}
              title={`Make ${player.name} an AI`}
            >
              <Bot size={13} />
              <span>AI</span>
            </button>
          </div>
          <button
            type="button"
            className="icon-button player-settings"
            onClick={() => onOpenConfig(color)}
            title={`Configure ${player.name}`}
            aria-label={`Configure ${player.name}`}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </div>

      <div className="player-status-row">
        <div className={`player-status ${thinking ? 'is-live' : ''}`}>
          {thinking ? <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span> : null}
          {!thinking && isAi && active && !aiHold ? (
            <Clock3 size={13} className="status-icon" />
          ) : null}
          <span>{statusText}</span>
        </div>
        {active && isAi && aiHold && status.result === 'ongoing' ? (
          <button
            type="button"
            className="status-inline-action"
            onClick={() => onResumeAi(color)}
          >
            <RotateCcw size={13} />
            Resume AI
          </button>
        ) : null}
        {status.result === 'ongoing' && active && inCheck ? (
          <span className="status-warning">King under attack</span>
        ) : null}
        {status.result !== 'ongoing' ? (
          <span className="status-result">{status.reason}</span>
        ) : null}
      </div>

      {active && isAi && thinking && showThinking ? (
        <div className="live-reasoning-snippet" aria-live="polite">
          <span className="snippet-label">Reasoning</span>
          <p>{compactReasoning}<span className="typing-caret" /></p>
        </div>
      ) : null}
    </article>
  );
}
