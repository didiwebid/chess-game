import { useEffect, useRef, useState } from 'react';
import { useChessStore } from './store/chessStore';
import { Toolbar } from './components/Toolbar';
import { BoardArea } from './components/board/BoardArea';
import { PlayerPanel } from './components/panels/PlayerPanel';
import { Sidebar } from './components/sidebar/Sidebar';
import { AiConfigModal } from './components/panels/AiConfigModal';
import { SaveLoadModal } from './components/modals/SaveLoadModal';
import { ResignModal } from './components/modals/ResignModal';
import { DrawOfferModal } from './components/modals/DrawOfferModal';
import { MemoryChoiceModal } from './components/modals/MemoryChoiceModal';
import { ConfirmDialog } from './components/modals/ConfirmDialog';
import { ToastStack } from './components/ui/ToastStack';
import {
  bootFromStorage,
  clearLastGame,
  saveLastGame,
} from './persistence/saveLoad';
import {
  abortAiTurn,
  abortAllAiTurns,
  requestAiTurn,
} from './ai/orchestrator';
import { materialAdvantage, opposite } from './engine/chessUtils';
import type { Color, Controller } from './types/chess';

type ModalState =
  | { type: 'ai'; color: Color }
  | { type: 'saves'; intent: 'save' | 'load' }
  | { type: 'resign' }
  | { type: 'memory'; color: Color }
  | null;

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: 'danger' | 'default';
  onConfirm: () => void;
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const bootedRef = useRef(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const notify = useChessStore((state) => state.notify);
  const players = useChessStore((state) => state.players);
  const status = useChessStore((state) => state.status);
  const turn = useChessStore((state) => state.turn);
  const orientation = useChessStore((state) => state.orientation);
  const fen = useChessStore((state) => state.fen);
  const threads = useChessStore((state) => state.threads);
  const thinking = useChessStore((state) => state.thinking);
  const aiHold = useChessStore((state) => state.aiHold);
  const aiPaused = useChessStore((state) => state.aiPaused);
  const aiDelayMs = useChessStore((state) => state.aiDelayMs);
  const drawOffer = useChessStore((state) => state.drawOffer);
  const gameVersion = useChessStore((state) => state.gameVersion);
  const showCoordinates = useChessStore((state) => state.showCoordinates);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const result = bootFromStorage();
    if (result.error) {
      useChessStore.getState().notify(
        `Previous autosave could not be restored: ${result.error}`,
        'error',
      );
    }
    setBooted(true);
  }, []);

  const bothAi =
    players.white.controller === 'ai' && players.black.controller === 'ai';
  const currentPlayer = players[turn];

  // AI turn scheduler.
  useEffect(() => {
    if (!booted || status.result !== 'ongoing') return;
    if (currentPlayer.controller !== 'ai') return;
    if (thinking[turn] || aiHold[turn]) return;
    if (bothAi && aiPaused) return;
    const delay = bothAi ? aiDelayMs : 320;
    const timer = window.setTimeout(() => {
      requestAiTurn(turn).catch((error: unknown) => {
        useChessStore.getState().notify(
          error instanceof Error ? error.message : 'The AI turn failed.',
          'error',
        );
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    aiDelayMs,
    aiHold,
    aiPaused,
    booted,
    bothAi,
    currentPlayer.controller,
    status.result,
    thinking,
    turn,
  ]);

  // Debounced autosave to the reserved local slot.
  useEffect(() => {
    if (!booted) return;
    const timer = window.setTimeout(() => {
      saveLastGame();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    booted,
    fen,
    gameVersion,
    orientation,
    players,
    status.result,
    threads,
    showCoordinates,
  ]);

  // Arrow keys review the game when no dialog is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (modal || confirm || drawOffer) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const state = useChessStore.getState();
      const currentPly = state.viewPly ?? state.moves.length;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        state.setViewPly(Math.max(0, currentPly - 1));
      } else {
        event.preventDefault();
        state.setViewPly(Math.min(state.moves.length, currentPly + 1));
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirm, drawOffer, modal]);

  const topColor: Color = orientation === 'white' ? 'black' : 'white';
  const bottomColor: Color = orientation === 'white' ? 'white' : 'black';

  const performNewGame = () => {
    abortAllAiTurns();
    useChessStore.getState().newGame();
    setConfirm(null);
    notify('New game. White to move.', 'success');
  };

  const requestNewGame = () => {
    const state = useChessStore.getState();
    if (state.moves.length === 0 && state.status.result === 'ongoing') {
      performNewGame();
      return;
    }
    setConfirm({
      title: 'Start a new game?',
      message:
        'This clears the board, move history, and AI memory. Player names, controllers, and AI settings are kept. Save the current game first if you want to revisit it.',
      confirmLabel: 'Start new game',
      onConfirm: performNewGame,
    });
  };

  const performResetAll = () => {
    abortAllAiTurns();
    useChessStore.getState().resetAll();
    clearLastGame();
    setConfirm(null);
    notify(
      'Everything reset. Named save slots and stored API keys were kept.',
      'success',
    );
  };

  const requestResetAll = () => {
    setConfirm({
      title: 'Reset everything?',
      message:
        'The game, both player settings, controllers, and all AI memory will return to defaults. Named save slots and API keys stored in this browser are kept. This cannot be undone.',
      confirmLabel: 'Reset all',
      tone: 'danger',
      onConfirm: performResetAll,
    });
  };

  const handleToggleController = (color: Color, controller: Controller) => {
    const state = useChessStore.getState();
    if (state.players[color].controller === controller) return;
    if (controller === 'human') {
      abortAiTurn(color);
      state.setPlayerController(color, 'human');
      notify(`${state.players[color].name} is now human.`, 'info');
      return;
    }
    const thread = state.threads[color];
    if (thread.turns.length > 0 || thread.summary.trim()) {
      setModal({ type: 'memory', color });
      return;
    }
    state.setPlayerController(color, 'ai');
    state.setAiHold(color, false);
    notify(`${state.players[color].name} is now an AI player.`, 'info');
  };

  const handleMemoryChoice = (color: Color, memory: 'resume' | 'fresh') => {
    const state = useChessStore.getState();
    state.setPlayerController(color, 'ai', { clearMemory: memory === 'fresh' });
    state.setAiHold(color, false);
    setModal(null);
    notify(
      memory === 'fresh'
        ? `${state.players[color].name} is now AI with a fresh memory.`
        : `${state.players[color].name} is now AI, resuming its memory.`,
      'info',
    );
  };

  const handleResumeAi = (color: Color) => {
    const state = useChessStore.getState();
    state.setAiHold(color, false);
    state.setAiPaused(false);
    notify(`${state.players[color].name}: AI resumed.`, 'info');
  };

  const handleOfferDraw = () => {
    const state = useChessStore.getState();
    if (state.status.result !== 'ongoing') return;
    const by = state.turn;
    if (state.players[by].controller !== 'human') {
      notify('Wait for a human turn to offer a draw.', 'info');
      return;
    }
    const recipient = opposite(by);
    if (state.players[recipient].controller === 'human') {
      state.offerDraw(by);
      return;
    }

    const difference = Math.abs(materialAdvantage(state.fen).white);
    const accept = state.moves.length >= 60 && difference <= 1;
    if (accept) {
      abortAllAiTurns();
      state.agreeDraw();
      notify(
        `${state.players[recipient].name} accepts the draw. The position is balanced enough to share the point.`,
        'success',
      );
    } else {
      notify(
        `${state.players[recipient].name} declines the draw. It wants to keep playing.`,
        'info',
      );
    }
  };

  const recipientOfOffer = drawOffer ? opposite(drawOffer.by) : null;
  const showDrawModal =
    drawOffer !== null &&
    status.result === 'ongoing' &&
    recipientOfOffer !== null &&
    players[recipientOfOffer].controller === 'human';

  if (!booted) {
    return (
      <div className="app-loading">
        <div className="loading-mark">♞</div>
        <p>Setting the table</p>
        <span className="loading-line"><i /></span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toolbar
        onNewGame={requestNewGame}
        onOpenSaves={(intent) => setModal({ type: 'saves', intent })}
        onResign={() => setModal({ type: 'resign' })}
        onOfferDraw={handleOfferDraw}
      />

      <main className="app-main">
        <section className="arena" aria-label="Chess board and players">
          <PlayerPanel
            color={topColor}
            onOpenConfig={(color) => setModal({ type: 'ai', color })}
            onToggleController={handleToggleController}
            onResumeAi={handleResumeAi}
          />
          <BoardArea />
          <PlayerPanel
            color={bottomColor}
            onOpenConfig={(color) => setModal({ type: 'ai', color })}
            onToggleController={handleToggleController}
            onResumeAi={handleResumeAi}
          />
        </section>

        <Sidebar
          onOpenConfig={(color) => setModal({ type: 'ai', color })}
          onOpenSaves={(intent) => setModal({ type: 'saves', intent })}
          onNewGame={requestNewGame}
          onResetAll={requestResetAll}
          onResign={() => setModal({ type: 'resign' })}
          onOfferDraw={handleOfferDraw}
        />
      </main>

      {modal?.type === 'ai' ? (
        <AiConfigModal
          key={`ai-${modal.color}`}
          color={modal.color}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.type === 'saves' ? (
        <SaveLoadModal
          key={`saves-${modal.intent}`}
          intent={modal.intent}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.type === 'resign' ? (
        <ResignModal onClose={() => setModal(null)} />
      ) : null}

      {modal?.type === 'memory' ? (
        <MemoryChoiceModal
          color={modal.color}
          onChoose={(memory) => handleMemoryChoice(modal.color, memory)}
          onClose={() => setModal(null)}
        />
      ) : null}

      {showDrawModal ? <DrawOfferModal onClose={() => undefined} /> : null}

      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          tone={confirm.tone}
          onConfirm={() => {
            confirm.onConfirm();
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      <ToastStack />
    </div>
  );
}
