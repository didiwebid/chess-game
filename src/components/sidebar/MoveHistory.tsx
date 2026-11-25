import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Radio,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useChessStore } from '../../store/chessStore';
import type { MoveRecord } from '../../types/chess';
import { formatElapsed } from '../../hooks/useElapsed';

function MoveCell({
  move,
  active,
  expanded,
  onSelect,
  onToggleReasoning,
  showThinking,
}: {
  move?: MoveRecord;
  active: boolean;
  expanded: boolean;
  onSelect: (move: MoveRecord) => void;
  onToggleReasoning: (ply: number) => void;
  showThinking: boolean;
}) {
  if (!move) return <div className="move-cell move-cell-empty" />;
  const hasReasoning = Boolean(move.reasoning) && showThinking;
  return (
    <div className={`move-cell ${active ? 'is-active' : ''}`}>
      <button
        type="button"
        className="move-san"
        onClick={() => onSelect(move)}
        aria-label={`Review move ${move.ply}, ${move.san}`}
      >
        <span>{move.san}</span>
        {move.controller === 'ai' ? (
          <Bot size={12} className="move-ai-icon" aria-label="AI move" />
        ) : null}
        {move.fallback ? (
          <TriangleAlert
            size={12}
            className="move-fallback-icon"
            aria-label="Fallback move"
          />
        ) : null}
      </button>
      {hasReasoning ? (
        <button
          type="button"
          className={`reasoning-toggle ${expanded ? 'is-open' : ''}`}
          onClick={() => onToggleReasoning(move.ply)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} reasoning for ${move.san}`}
          title={expanded ? 'Hide AI reasoning' : 'Show AI reasoning'}
        >
          <Sparkles size={12} />
          <ChevronDown size={11} />
        </button>
      ) : null}
    </div>
  );
}

export function MoveHistory() {
  const moves = useChessStore((state) => state.moves);
  const viewPly = useChessStore((state) => state.viewPly);
  const setViewPly = useChessStore((state) => state.setViewPly);
  const showThinking = useChessStore((state) => state.showThinking);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const currentPly = viewPly ?? moves.length;

  useEffect(() => {
    if (viewPly !== null) return;
    const node = listRef.current;
    if (!node) return;
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [moves.length, viewPly]);

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(
        [...current].filter((ply) => ply <= moves.length),
      );
      return next;
    });
  }, [moves.length]);

  const toggleReasoning = (ply: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(ply)) next.delete(ply);
      else next.add(ply);
      return next;
    });
  };

  const selectMove = (move: MoveRecord) => {
    setViewPly(move.ply);
  };

  const rows = [];
  for (let index = 0; index < moves.length; index += 2) {
    const white = moves[index];
    const black = moves[index + 1];
    const number = Math.floor(index / 2) + 1;
    rows.push(
      <div className="move-row" key={`${number}-${white?.ply ?? index}`}>
        <span className="move-number">{number}.</span>
        <MoveCell
          move={white}
          active={white?.ply === currentPly}
          expanded={!!white && expanded.has(white.ply)}
          onSelect={selectMove}
          onToggleReasoning={toggleReasoning}
          showThinking={showThinking}
        />
        <MoveCell
          move={black}
          active={black?.ply === currentPly}
          expanded={!!black && expanded.has(black.ply)}
          onSelect={selectMove}
          onToggleReasoning={toggleReasoning}
          showThinking={showThinking}
        />
        {white && expanded.has(white.ply) && showThinking && white.reasoning ? (
          <div className="reasoning-panel">
            <div className="reasoning-meta">
              <Bot size={13} />
              <span>AI reasoning</span>
              {white.model ? <span className="reasoning-model">{white.model}</span> : null}
              {white.elapsedMs ? <span>{formatElapsed(Math.round(white.elapsedMs / 1000))}</span> : null}
            </div>
            <p>{white.reasoning}</p>
            {white.pv && white.pv.length > 1 ? (
              <div className="reasoning-pv">
                <span className="reasoning-pv-label">Main line</span>
                <span className="reasoning-pv-moves">{white.pv.join(' ')}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        {black && expanded.has(black.ply) && showThinking && black.reasoning ? (
          <div className="reasoning-panel">
            <div className="reasoning-meta">
              <Bot size={13} />
              <span>AI reasoning</span>
              {black.model ? <span className="reasoning-model">{black.model}</span> : null}
              {black.elapsedMs ? <span>{formatElapsed(Math.round(black.elapsedMs / 1000))}</span> : null}
            </div>
            <p>{black.reasoning}</p>
            {black.pv && black.pv.length > 1 ? (
              <div className="reasoning-pv">
                <span className="reasoning-pv-label">Main line</span>
                <span className="reasoning-pv-moves">{black.pv.join(' ')}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>,
    );
  }

  return (
    <div className="move-history">
      <div className="history-nav">
        <div className="history-position">
          <span className={`live-dot ${viewPly === null ? 'is-live' : ''}`} />
          <span>{viewPly === null ? 'Live position' : `After ply ${currentPly}`}</span>
        </div>
        <div className="history-nav-actions">
          <button
            type="button"
            className="icon-button mini"
            onClick={() => setViewPly(Math.max(0, currentPly - 1))}
            disabled={currentPly <= 0}
            aria-label="Previous position"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="icon-button mini"
            onClick={() => setViewPly(Math.min(moves.length, currentPly + 1))}
            disabled={currentPly >= moves.length}
            aria-label="Next position"
          >
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            className="live-button"
            onClick={() => setViewPly(null)}
            disabled={viewPly === null}
          >
            <Radio size={12} />
            Live
          </button>
        </div>
      </div>

      <div className="move-list-scroll" ref={listRef}>
        {moves.length === 0 ? (
          <div className="empty-history">
            <div className="empty-piece" aria-hidden="true">♞</div>
            <h3>The board is set</h3>
            <p>White opens the game. Every move and every AI thought will appear here.</p>
          </div>
        ) : (
          <div className="move-rows">{rows}</div>
        )}
      </div>

      <div className="history-footer">
        <span><CornerDownRight size={12} /> Click a move to review</span>
        <span>← → to navigate</span>
      </div>
    </div>
  );
}
