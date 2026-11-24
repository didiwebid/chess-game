import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Check,
  Clock3,
  Download,
  FileJson,
  FileText,
  FolderOpen,
  HardDriveDownload,
  LoaderCircle,
  Pencil,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useChessStore } from '../../store/chessStore';
import type { SaveSlot } from '../../types/chess';
import {
  deleteSaveSlot,
  downloadCurrentGame,
  downloadCurrentPgn,
  importGameFile,
  listSaveSlots,
  loadSlot,
  renameSaveSlot,
  saveNamedSlot,
} from '../../persistence/saveLoad';

interface SaveLoadModalProps {
  intent: 'save' | 'load';
  onClose: () => void;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function SaveLoadModal({ intent, onClose }: SaveLoadModalProps) {
  const status = useChessStore((state) => state.status);
  const moves = useChessStore((state) => state.moves);
  const players = useChessStore((state) => state.players);
  const notify = useChessStore((state) => state.notify);
  const [slots, setSlots] = useState<SaveSlot[]>(() => listSaveSlots());
  const [saveName, setSaveName] = useState(
    () => `${players.white.name} vs ${players.black.name}`,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busyImport, setBusyImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => setSlots(listSaveSlots());

  useEffect(() => {
    refresh();
  }, []);

  const handleSave = () => {
    setError('');
    const result = saveNamedSlot(saveName);
    if (!result.ok) {
      setError(result.error ?? 'The game could not be saved.');
      return;
    }
    refresh();
    notify(`Game saved to “${result.slot?.name ?? saveName}”.`, 'success');
    setSaveName(`${players.white.name} vs ${players.black.name}`);
  };

  const handleLoad = (slot: SaveSlot) => {
    setError('');
    const result = loadSlot(slot.id);
    if (!result.ok) {
      setError(result.error ?? 'The saved game could not be loaded.');
      return;
    }
    onClose();
  };

  const startRename = (slot: SaveSlot) => {
    setEditingId(slot.id);
    setEditName(slot.name);
    setPendingDeleteId(null);
    setError('');
  };

  const commitRename = () => {
    if (!editingId) return;
    const result = renameSaveSlot(editingId, editName);
    if (!result.ok) {
      setError(result.error ?? 'The saved game could not be renamed.');
      return;
    }
    setEditingId(null);
    setEditName('');
    refresh();
  };

  const handleDelete = (slot: SaveSlot) => {
    if (pendingDeleteId !== slot.id) {
      setPendingDeleteId(slot.id);
      return;
    }
    const result = deleteSaveSlot(slot.id);
    if (!result.ok) {
      setError(result.error ?? 'The saved game could not be deleted.');
      return;
    }
    setPendingDeleteId(null);
    refresh();
    notify('Saved game deleted.', 'info');
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setBusyImport(true);
    try {
      const result = await importGameFile(file);
      if (!result.ok) {
        setError(result.error ?? 'That file could not be loaded.');
        return;
      }
      onClose();
    } finally {
      setBusyImport(false);
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
    <Modal
      title="Save &amp; load"
      eyebrow={intent === 'save' ? 'Preserve this game' : 'Return to a saved game'}
      icon={<FolderOpen size={20} />}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <p className="modal-footer-note">
            <HardDriveDownload size={13} />
            Saved locally in this browser. Keys are never included.
          </p>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="save-load-layout">
        <section className="save-current-section">
          <div className="config-section-title">
            <div>
              <p className="eyebrow">Current game</p>
              <h3>Save to a local slot</h3>
            </div>
            <span className="status-chip">
              {status.result === 'ongoing'
                ? `${moves.length} plies`
                : status.result === 'draw'
                  ? 'Draw'
                  : `${status.result} won`}
            </span>
          </div>
          <div className="save-name-row">
            <label className="field">
              <span className="sr-only">Save name</span>
              <input
                type="text"
                value={saveName}
                maxLength={60}
                onChange={(event) => setSaveName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSave();
                }}
                placeholder="Name this game"
                autoFocus={intent === 'save'}
              />
            </label>
            <button type="button" className="primary-button" onClick={handleSave}>
              <Save size={15} />
              Save game
            </button>
          </div>
          <div className="download-row">
            <button type="button" className="data-action" onClick={handleDownload}>
              <FileJson size={15} />
              <span>Download .json</span>
            </button>
            <button type="button" className="data-action" onClick={handlePgn}>
              <FileText size={15} />
              <span>Export .pgn</span>
            </button>
          </div>
        </section>

        <section className="slots-section">
          <div className="config-section-title">
            <div>
              <p className="eyebrow">Local library</p>
              <h3>Saved games</h3>
            </div>
            <span className="slot-count">{slots.length}</span>
          </div>

          {slots.length === 0 ? (
            <div className="empty-slots">
              <FolderOpen size={24} />
              <p>No saved slots yet. Save the current game above to create one.</p>
            </div>
          ) : (
            <div className="slot-list">
              {slots.map((slot) => {
                const editing = editingId === slot.id;
                const confirmingDelete = pendingDeleteId === slot.id;
                const savedMoves = slot.snapshot.moves.length;
                const result = slot.snapshot.status.result;
                return (
                  <div className="slot-row" key={slot.id}>
                    <div className="slot-icon">
                      <Clock3 size={16} />
                    </div>
                    <div className="slot-main">
                      {editing ? (
                        <div className="slot-edit-row">
                          <input
                            type="text"
                            value={editName}
                            maxLength={60}
                            onChange={(event) => setEditName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') commitRename();
                              if (event.key === 'Escape') setEditingId(null);
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="icon-button mini"
                            onClick={commitRename}
                            aria-label="Save name"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button mini"
                            onClick={() => setEditingId(null)}
                            aria-label="Cancel rename"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="slot-name">{slot.name}</div>
                      )}
                      <div className="slot-meta">
                        <span>{formatDate(slot.savedAt)}</span>
                        <span>·</span>
                        <span>{savedMoves} plies</span>
                        <span>·</span>
                        <span>
                          {result === 'ongoing'
                            ? 'In progress'
                            : result === 'draw'
                              ? 'Draw'
                              : `${result} won`}
                        </span>
                      </div>
                    </div>
                    <div className="slot-actions">
                      {editing ? (
                        <button
                          type="button"
                          className="slot-load-button"
                          onClick={commitRename}
                        >
                          <Check size={13} />
                          Done
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="slot-load-button"
                            onClick={() => handleLoad(slot)}
                          >
                            <Download size={13} />
                            Load
                          </button>
                          <button
                            type="button"
                            className="icon-button mini"
                            onClick={() => startRename(slot)}
                            aria-label={`Rename ${slot.name}`}
                            title="Rename"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className={`icon-button mini delete ${confirmingDelete ? 'is-confirming' : ''}`}
                            onClick={() => handleDelete(slot)}
                            aria-label={
                              confirmingDelete
                                ? `Confirm delete ${slot.name}`
                                : `Delete ${slot.name}`
                            }
                            title={confirmingDelete ? 'Click again to confirm' : 'Delete'}
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="import-section">
          <div className="import-copy">
            <div className="import-icon">
              <Upload size={18} />
            </div>
            <div>
              <h4>Load from a file</h4>
              <p>Open a Gambit .json save or import a standard .pgn game.</p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.pgn,application/json,application/x-chess-pgn"
            className="sr-only"
            onChange={handleFile}
            tabIndex={-1}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={busyImport}
            onClick={() => fileInputRef.current?.click()}
          >
            {busyImport ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Upload size={14} />
            )}
            {busyImport ? 'Reading file…' : 'Choose file'}
          </button>
        </section>

        {error ? (
          <div className="form-error" role="alert">
            <X size={14} />
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
