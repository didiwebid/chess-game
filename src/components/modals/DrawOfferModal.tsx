import { Handshake } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useChessStore } from '../../store/chessStore';
import { abortAllAiTurns } from '../../ai/orchestrator';
import { opposite } from '../../engine/chessUtils';

interface DrawOfferModalProps {
  onClose: () => void;
}

export function DrawOfferModal({ onClose }: DrawOfferModalProps) {
  const drawOffer = useChessStore((state) => state.drawOffer);
  const status = useChessStore((state) => state.status);
  const players = useChessStore((state) => state.players);
  const clearDrawOffer = useChessStore((state) => state.clearDrawOffer);
  const agreeDraw = useChessStore((state) => state.agreeDraw);
  const notify = useChessStore((state) => state.notify);

  if (!drawOffer || status.result !== 'ongoing') return null;

  const recipient = opposite(drawOffer.by);
  const offererName = players[drawOffer.by].name;
  const recipientName = players[recipient].name;

  const accept = () => {
    abortAllAiTurns();
    agreeDraw();
    notify('Draw agreed.', 'success');
    onClose();
  };

  const decline = () => {
    clearDrawOffer();
    notify(`${recipientName} declined the draw offer.`, 'info');
    onClose();
  };

  return (
    <Modal
      title="A draw is offered"
      eyebrow="Agreement required"
      icon={<Handshake size={20} />}
      onClose={decline}
      size="sm"
      footer={
        <>
          <button type="button" className="secondary-button" onClick={decline}>
            Decline
          </button>
          <button type="button" className="primary-button" onClick={accept}>
            <Handshake size={14} />
            Accept draw
          </button>
        </>
      }
    >
      <div className="draw-offer-content">
        <div className="draw-emblem">
          <span className={`ai-chip-dot ${drawOffer.by}`} />
          <Handshake size={28} />
          <span className={`ai-chip-dot ${recipient}`} />
        </div>
        <h3>{offererName} offers a draw</h3>
        <p>
          {recipientName}, do you accept half a point? Accepting ends the game
          immediately as a draw.
        </p>
      </div>
    </Modal>
  );
}
