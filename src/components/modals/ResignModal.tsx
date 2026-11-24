import { useState } from 'react';
import { Flag } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useChessStore } from '../../store/chessStore';
import { abortAllAiTurns } from '../../ai/orchestrator';
import type { Color } from '../../types/chess';

interface ResignModalProps {
  onClose: () => void;
}

export function ResignModal({ onClose }: ResignModalProps) {
  const turn = useChessStore((state) => state.turn);
  const players = useChessStore((state) => state.players);
  const resign = useChessStore((state) => state.resign);
  const notify = useChessStore((state) => state.notify);
  const [selected, setSelected] = useState<Color>(turn);

  const handleResign = () => {
    abortAllAiTurns();
    resign(selected);
    notify(`${players[selected].name} resigned.`, 'info');
    onClose();
  };

  return (
    <Modal
      title="Resign the game?"
      eyebrow="This ends the match"
      icon={<Flag size={20} />}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Keep playing
          </button>
          <button type="button" className="danger-button" onClick={handleResign}>
            <Flag size={14} />
            Resign {players[selected].name}
          </button>
        </>
      }
    >
      <div className="resign-content">
        <p>Choose the side that is resigning. Their opponent wins immediately.</p>
        <div className="resign-options">
          {(['white', 'black'] as const).map((color) => (
            <button
              type="button"
              key={color}
              className={`resign-option ${selected === color ? 'is-selected' : ''}`}
              onClick={() => setSelected(color)}
              aria-pressed={selected === color}
            >
              <span className={`ai-chip-dot ${color}`} />
              <span>
                <strong>{players[color].name}</strong>
                <small>{players[color].controller === 'ai' ? 'AI player' : 'Human player'}</small>
              </span>
              <span className="radio-mark" aria-hidden="true" />
            </button>
          ))}
        </div>
        <p className="resign-note">
          A resigned game stays in the move history and can be saved or undone.
        </p>
      </div>
    </Modal>
  );
}
