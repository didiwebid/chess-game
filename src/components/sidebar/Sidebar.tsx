import { BrainCircuit, ListOrdered, SlidersHorizontal } from 'lucide-react';
import { useChessStore } from '../../store/chessStore';
import type { Color } from '../../types/chess';
import { MoveHistory } from './MoveHistory';
import { ThinkingPanel } from './ThinkingPanel';
import { GamePanel } from './GamePanel';

interface SidebarProps {
  onOpenConfig: (color: Color) => void;
  onOpenSaves: (intent: 'save' | 'load') => void;
  onNewGame: () => void;
  onResetAll: () => void;
  onResign: () => void;
  onOfferDraw: () => void;
  onClaimDraw: () => void;
}

export function Sidebar({
  onOpenConfig,
  onOpenSaves,
  onNewGame,
  onResetAll,
  onResign,
  onOfferDraw,
  onClaimDraw,
}: SidebarProps) {
  const tab = useChessStore((state) => state.sidebarTab);
  const setTab = useChessStore((state) => state.setSidebarTab);
  const moveCount = useChessStore((state) => state.moves.length);
  const thinking = useChessStore((state) => state.thinking);
  const anyThinking = thinking.white || thinking.black;

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs" role="tablist" aria-label="Match details">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'moves'}
          className={tab === 'moves' ? 'is-active' : ''}
          onClick={() => setTab('moves')}
        >
          <ListOrdered size={15} />
          <span>Moves</span>
          {moveCount > 0 ? <span className="tab-count">{Math.ceil(moveCount / 2)}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'thinking'}
          className={tab === 'thinking' ? 'is-active' : ''}
          onClick={() => setTab('thinking')}
        >
          <BrainCircuit size={15} />
          <span>Thinking</span>
          {anyThinking ? <span className="tab-live-dot" aria-label="AI thinking" /> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'game'}
          className={tab === 'game' ? 'is-active' : ''}
          onClick={() => setTab('game')}
        >
          <SlidersHorizontal size={15} />
          <span>Game</span>
        </button>
      </div>

      <div className="sidebar-panel">
        {tab === 'moves' ? <MoveHistory /> : null}
        {tab === 'thinking' ? <ThinkingPanel onOpenConfig={onOpenConfig} /> : null}
        {tab === 'game' ? (
          <GamePanel
            onOpenSaves={onOpenSaves}
            onNewGame={onNewGame}
            onResetAll={onResetAll}
            onResign={onResign}
            onOfferDraw={onOfferDraw}
            onClaimDraw={onClaimDraw}
          />
        ) : null}
      </div>
    </aside>
  );
}
