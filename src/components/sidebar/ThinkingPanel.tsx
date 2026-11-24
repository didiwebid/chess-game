import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  BrainCircuit,
  CircleStop,
  Clock3,
  Gauge,
  Play,
  Settings2,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useChessStore } from '../../store/chessStore';
import { extractPartialReasoning, estimateThreadMemoryTokens } from '../../ai/contextManager';
import { abortAiTurn } from '../../ai/orchestrator';
import { getLatestMoveFor } from '../../engine/chessUtils';
import { formatCount, formatElapsed, useElapsed } from '../../hooks/useElapsed';
import { Toggle } from '../ui/Toggle';
import type { Color } from '../../types/chess';

interface ThinkingPanelProps {
  onOpenConfig: (color: Color) => void;
}

export function ThinkingPanel({ onOpenConfig }: ThinkingPanelProps) {
  const players = useChessStore((state) => state.players);
  const moves = useChessStore((state) => state.moves);
  const status = useChessStore((state) => state.status);
  const thinking = useChessStore((state) => state.thinking);
  const thinkingStartedAt = useChessStore((state) => state.thinkingStartedAt);
  const aiHold = useChessStore((state) => state.aiHold);
  const aiErrors = useChessStore((state) => state.aiErrors);
  const thread = useChessStore((state) => state.threads);
  const showThinking = useChessStore((state) => state.showThinking);
  const setShowThinking = useChessStore((state) => state.setShowThinking);
  const streamRaw = useChessStore((state) => state.streamRaw);
  const streamReasoning = useChessStore((state) => state.streamReasoning);
  const setAiHold = useChessStore((state) => state.setAiHold);
  const setAiPaused = useChessStore((state) => state.setAiPaused);
  const notify = useChessStore((state) => state.notify);

  const liveColor = thinking.white ? 'white' : thinking.black ? 'black' : null;
  const [selectedColor, setSelectedColor] = useState<Color>(
    players.black.controller === 'ai' ? 'black' : 'white',
  );
  const textRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed(
    selectedColor === liveColor ? thinkingStartedAt[selectedColor] : null,
  );

  useEffect(() => {
    if (liveColor) setSelectedColor(liveColor);
  }, [liveColor]);

  const selectedPlayer = players[selectedColor];
  const selectedIsAi = selectedPlayer.controller === 'ai';
  const selectedThinking = thinking[selectedColor];
  const selectedMove = getLatestMoveFor(moves, selectedColor);
  const selectedError = aiErrors[selectedColor];
  const selectedHold = aiHold[selectedColor];
  const selectedThread = thread[selectedColor];
  const memoryTokens = useMemo(
    () => estimateThreadMemoryTokens(selectedThread),
    [selectedThread],
  );
  const usagePercent = Math.min(
    100,
    Math.round((memoryTokens / selectedPlayer.config.context.maxTokens) * 100),
  );
  const reasoningText =
    streamReasoning[selectedColor].trim() ||
    extractPartialReasoning(streamRaw[selectedColor]) ||
    'Opening the position and checking the candidate moves';

  useEffect(() => {
    if (!selectedThinking) return;
    const node = textRef.current;
    if (!node) return;
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [reasoningText, selectedThinking]);

  const stopThinking = () => {
    abortAiTurn(selectedColor, { hold: true });
    notify(`${selectedPlayer.name}: AI stopped.`, 'info');
  };

  const resumeThinking = () => {
    setAiPaused(false);
    setAiHold(selectedColor, false);
    notify(`${selectedPlayer.name}: resuming.`, 'info');
  };

  return (
    <div className="thinking-panel-component">
      <div className="thinking-topbar">
        <div className="ai-selector" role="group" aria-label="AI player">
          {(['white', 'black'] as const).map((color) => {
            const player = players[color];
            const isAi = player.controller === 'ai';
            return (
              <button
                type="button"
                key={color}
                className={`ai-select-chip ${selectedColor === color ? 'is-selected' : ''}`}
                onClick={() => setSelectedColor(color)}
                aria-pressed={selectedColor === color}
              >
                <span className={`ai-chip-dot ${color}`} />
                <span>{player.name}</span>
                {isAi ? (
                  thinking[color] ? <span className="live-pulse" /> : <Bot size={12} />
                ) : (
                  <span className="human-tag">human</span>
                )}
              </button>
            );
          })}
        </div>
        <label className="thinking-visibility">
          <span>Show</span>
          <Toggle
            checked={showThinking}
            onChange={setShowThinking}
            label="Show AI thinking"
            compact
          />
        </label>
      </div>

      {!showThinking ? (
        <div className="thinking-hidden">
          <Sparkles size={26} />
          <h3>Thinking display is off</h3>
          <p>Reasoning is still stored with each AI move. Turn the display back on to reveal it.</p>
          <button type="button" className="secondary-button" onClick={() => setShowThinking(true)}>
            Show AI thinking
          </button>
        </div>
      ) : !selectedIsAi ? (
        <div className="thinking-hidden">
          <BrainCircuit size={28} />
          <h3>{selectedPlayer.name} is human</h3>
          <p>
            Switch this side to AI from the player panel to watch it reason through the
            position in real time.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onOpenConfig(selectedColor)}
          >
            <Settings2 size={14} />
            Open AI settings
          </button>
        </div>
      ) : selectedThinking ? (
        <div className="thinking-live">
          <div className="thinking-live-head">
            <div className="thinking-live-title">
              <div className="thinking-orb" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div>
                <p className="eyebrow">Live reasoning</p>
                <h3>{selectedPlayer.name} is thinking</h3>
              </div>
            </div>
            <div className="thinking-live-meta">
              <span><Clock3 size={13} /> {formatElapsed(elapsed)}</span>
              <span className="model-chip">{selectedPlayer.config.model || 'AI'}</span>
            </div>
          </div>

          <div className="thinking-stream" ref={textRef} aria-live="polite">
            <p>{reasoningText}<span className="typing-caret" /></p>
          </div>

          <div className="thinking-live-footer">
            <span>Streamed from your configured provider</span>
            <button type="button" className="danger-subtle-button" onClick={stopThinking}>
              <CircleStop size={14} />
              Stop
            </button>
          </div>
        </div>
      ) : (
        <div className="thinking-content">
          {status.result === 'ongoing' && selectedHold ? (
            <div className="ai-state-card warning-card">
              <div className="ai-state-icon"><TriangleAlert size={18} /></div>
              <div>
                <h3>AI stopped before moving</h3>
                <p>
                  The request was interrupted or could not finish. Resume when you are ready,
                  or check its endpoint settings.
                </p>
                {selectedError ? (
                  <details className="error-details">
                    <summary>Show error details</summary>
                    <p>{selectedError.message}</p>
                    {selectedError.detail ? <p>{selectedError.detail}</p> : null}
                  </details>
                ) : null}
                <div className="inline-actions">
                  <button type="button" className="primary-button small" onClick={resumeThinking}>
                    <Play size={13} />
                    Resume AI
                  </button>
                  <button
                    type="button"
                    className="secondary-button small"
                    onClick={() => onOpenConfig(selectedColor)}
                  >
                    <Settings2 size={13} />
                    Settings
                  </button>
                </div>
              </div>
            </div>
          ) : selectedError ? (
            <div className="ai-state-card warning-card">
              <div className="ai-state-icon"><TriangleAlert size={18} /></div>
              <div>
                <h3>{selectedError.message}</h3>
                <p>{selectedError.detail || 'The AI provider returned an error.'}</p>
                <button
                  type="button"
                  className="secondary-button small"
                  onClick={() => onOpenConfig(selectedColor)}
                >
                  <Settings2 size={13} />
                  Review AI settings
                </button>
              </div>
            </div>
          ) : null}

          {selectedMove?.reasoning ? (
            <div className="last-thought">
              <div className="last-thought-head">
                <div>
                  <p className="eyebrow">Last decision</p>
                  <h3>
                    Move {Math.ceil(selectedMove.ply / 2)}
                    {selectedMove.color === 'white' ? '.' : '…'} {selectedMove.san}
                  </h3>
                </div>
                <span className={`confidence-badge ${selectedMove.confidence ?? 'medium'}`}>
                  {selectedMove.confidence ?? 'medium'} confidence
                </span>
              </div>
              <p className="last-thought-text">{selectedMove.reasoning}</p>
              <div className="last-thought-footer">
                <span><Bot size={12} /> {selectedMove.model || selectedPlayer.config.model || 'AI'}</span>
                {selectedMove.elapsedMs ? (
                  <span><Clock3 size={12} /> {formatElapsed(Math.round(selectedMove.elapsedMs / 1000))}</span>
                ) : null}
                {selectedMove.fallback ? (
                  <span className="fallback-label"><TriangleAlert size={12} /> Fallback move</span>
                ) : null}
              </div>
            </div>
          ) : !selectedHold && !selectedError ? (
            <div className="thinking-hidden">
              <Sparkles size={26} />
              <h3>No reasoning yet</h3>
              <p>
                When {selectedPlayer.name} makes an AI move, its explanation will be stored
                here and under the move in the history.
              </p>
            </div>
          ) : null}

          <div className="memory-card">
            <div className="memory-head">
              <span><BrainCircuit size={14} /> AI memory</span>
              <button type="button" onClick={() => onOpenConfig(selectedColor)}>
                <Settings2 size={13} />
                Manage
              </button>
            </div>
            <div className="memory-stats">
              <span>{selectedThread.turns.length} stored exchanges</span>
              <span>{summaryHasContent(selectedThread.summary) ? 'Summary active' : 'No summary'}</span>
            </div>
            <div className="usage-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(2, usagePercent)}%` }} />
              <i
                style={{
                  left: `${Math.round(selectedPlayer.config.context.thresholdRatio * 100)}%`,
                }}
              />
            </div>
            <div className="memory-foot">
              <span><Gauge size={12} /> ~{formatCount(memoryTokens)} tokens stored</span>
              <span>{usagePercent}% of context</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function summaryHasContent(summary: string): boolean {
  return summary.trim().length > 0;
}
