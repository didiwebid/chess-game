import { BrainCircuit, RotateCcw, Sparkles } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useChessStore } from '../../store/chessStore';
import type { Color } from '../../types/chess';

interface MemoryChoiceModalProps {
  color: Color;
  onChoose: (memory: 'resume' | 'fresh') => void;
  onClose: () => void;
}

export function MemoryChoiceModal({
  color,
  onChoose,
  onClose,
}: MemoryChoiceModalProps) {
  const player = useChessStore((state) => state.players[color]);
  const thread = useChessStore((state) => state.threads[color]);
  const hasSummary = thread.summary.trim().length > 0;

  return (
    <Modal
      title={`Wake ${player.name} up`}
      eyebrow="AI switch"
      icon={<BrainCircuit size={20} />}
      onClose={onClose}
      size="sm"
      footer={
        <button type="button" className="secondary-button" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <div className="memory-choice-content">
        <p>
          {player.name} already has AI memory from earlier in this game. Choose how this
          seat should continue.
        </p>
        <div className="memory-summary-facts">
          <span>{thread.turns.length} stored exchanges</span>
          <span>{hasSummary ? 'Compressed summary available' : 'No summary yet'}</span>
        </div>
        <div className="memory-choice-options">
          <button
            type="button"
            className="memory-choice-card"
            onClick={() => onChoose('resume')}
          >
            <span className="memory-choice-icon">
              <Sparkles size={18} />
            </span>
            <span>
              <strong>Resume memory</strong>
              <small>Continue from the existing reasoning thread and game summary.</small>
            </span>
          </button>
          <button
            type="button"
            className="memory-choice-card muted"
            onClick={() => onChoose('fresh')}
          >
            <span className="memory-choice-icon">
              <RotateCcw size={18} />
            </span>
            <span>
              <strong>Start fresh</strong>
              <small>Clear the stored thread. The current position is still authoritative.</small>
            </span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
