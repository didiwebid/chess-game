import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  BrainCircuit,
  Check,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  PlugZap,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Toggle } from '../ui/Toggle';
import { useChessStore } from '../../store/chessStore';
import type { Color, PersonaPreset, PlayerConfig } from '../../types/chess';
import { PERSONA_LABELS } from '../../ai/prompts';
import { estimateThreadMemoryTokens } from '../../ai/contextManager';
import { testAiConnection } from '../../ai/client';
import { abortAiTurn } from '../../ai/orchestrator';
import { formatCount } from '../../hooks/useElapsed';
import { maskApiKey } from '../../persistence/apiKeys';

interface AiConfigModalProps {
  color: Color;
  onClose: () => void;
}

type TestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

const PERSONAS: PersonaPreset[] = [
  'positional',
  'aggressive',
  'tactical',
  'solid',
  'beginner',
  'custom',
];

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

export function AiConfigModal({ color, onClose }: AiConfigModalProps) {
  const player = useChessStore((state) => state.players[color]);
  const opponent = useChessStore(
    (state) => state.players[color === 'white' ? 'black' : 'white'],
  );
  const thread = useChessStore((state) => state.threads[color]);
  const updatePlayerConfig = useChessStore((state) => state.updatePlayerConfig);
  const setPlayerName = useChessStore((state) => state.setPlayerName);
  const clearMemory = useChessStore((state) => state.clearMemory);
  const setAiHold = useChessStore((state) => state.setAiHold);
  const notify = useChessStore((state) => state.notify);

  const [name, setName] = useState(player.name);
  const [draft, setDraft] = useState<PlayerConfig>(player.config);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [formError, setFormError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const testControllerRef = useRef<AbortController | null>(null);
  const memoryTokens = useMemo(
    () => estimateThreadMemoryTokens(thread),
    [thread],
  );
  const memoryPercent = Math.min(
    100,
    Math.round((memoryTokens / Math.max(1, draft.context.maxTokens)) * 100),
  );
  const thresholdPercent = Math.round(draft.context.thresholdRatio * 100);
  const hasMemory = thread.turns.length > 0 || thread.summary.trim().length > 0;

  useEffect(() => {
    return () => {
      testControllerRef.current?.abort();
    };
  }, []);

  const update = (patch: Partial<PlayerConfig>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setTest({ status: 'idle' });
    setFormError('');
  };

  const updateContext = (patch: Partial<PlayerConfig['context']>) => {
    setDraft((current) => ({
      ...current,
      context: { ...current.context, ...patch },
    }));
    setTest({ status: 'idle' });
    setFormError('');
  };

  const validate = (): PlayerConfig | null => {
    if (!name.trim()) {
      setFormError('Give this player a name.');
      return null;
    }
    const baseUrl = normalizeBaseUrl(draft.baseUrl);
    if (!baseUrl) {
      setFormError('Add an API base URL.');
      return null;
    }
    try {
      const parsed = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setFormError('The API URL must use http:// or https://.');
        return null;
      }
    } catch {
      setFormError('That API base URL is not valid.');
      return null;
    }
    if (!draft.model.trim()) {
      setFormError('Add a model name.');
      return null;
    }
    return {
      ...draft,
      baseUrl,
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
      timeoutMs: Math.max(5_000, Math.min(180_000, draft.timeoutMs)),
    };
  };

  const handleTest = async () => {
    const config = validate();
    if (!config) return;
    testControllerRef.current?.abort();
    const controller = new AbortController();
    testControllerRef.current = controller;
    setTest({ status: 'loading' });
    try {
      const message = await testAiConnection(config, controller.signal);
      if (!controller.signal.aborted) setTest({ status: 'success', message });
    } catch (error) {
      if (controller.signal.aborted) return;
      setTest({
        status: 'error',
        message:
          error instanceof Error ? error.message : 'The connection test failed.',
      });
    }
  };

  const handleSave = () => {
    const config = validate();
    if (!config) return;
    setPlayerName(color, name);
    updatePlayerConfig(color, {
      ...config,
      context: config.context,
    });
    setAiHold(color, false);
    notify(`${name.trim()} settings saved.`, 'success');
    onClose();
  };

  const handleClearMemory = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    abortAiTurn(color, { hold: true });
    clearMemory(color);
    setConfirmClear(false);
    notify(`${player.name}'s AI memory cleared.`, 'info');
  };

  return (
    <Modal
      title={`${name.trim() || player.name} AI settings`}
      eyebrow={`Player configuration · ${color}`}
      icon={<Bot size={20} />}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={handleSave}>
            <Check size={15} />
            Save settings
          </button>
        </>
      }
    >
      <div className="config-settings">
        <section className="config-section">
          <div className="config-section-title">
            <div>
              <p className="eyebrow">Identity</p>
              <h3>Player name</h3>
            </div>
            {player.controller === 'ai' ? <span className="status-chip ai">AI seat</span> : <span className="status-chip">Human seat</span>}
          </div>
          <div className="form-grid two-col">
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                maxLength={40}
                onChange={(event) => {
                  setName(event.target.value);
                  setFormError('');
                }}
                placeholder={color === 'white' ? 'White' : 'Black'}
              />
            </label>
            <div className="field">
              <span>Color</span>
              <div className="readonly-color-field">
                <span className={`ai-chip-dot ${color}`} />
                {color === 'white' ? 'White' : 'Black'}
                <i>plays as</i>
              </div>
            </div>
          </div>
        </section>

        <section className="config-section">
          <div className="config-section-title">
            <div>
              <p className="eyebrow">Connection</p>
              <h3>OpenAI-compatible endpoint</h3>
            </div>
            <span className="config-mini-tag">Browser → provider</span>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Base URL</span>
              <input
                type="url"
                value={draft.baseUrl}
                onChange={(event) => update({ baseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
                autoCapitalize="none"
              />
              <small>Works with OpenAI, OpenRouter, DeepSeek, or local Ollama.</small>
            </label>
          </div>
          <div className="form-grid two-col">
            <label className="field">
              <span>Model</span>
              <input
                type="text"
                value={draft.model}
                onChange={(event) => update({ model: event.target.value })}
                placeholder="gpt-4o-mini"
                spellCheck={false}
                autoCapitalize="none"
              />
            </label>
            <label className="field">
              <span>
                API key
                {draft.apiKey ? <em className="field-badge">stored locally</em> : null}
              </span>
              <input
                type="password"
                value={draft.apiKey}
                onChange={(event) => update({ apiKey: event.target.value })}
                placeholder="sk-…"
                autoComplete="new-password"
                spellCheck={false}
              />
              <small>
                {draft.apiKey
                  ? `Masked key ending ${maskApiKey(draft.apiKey)} · stored only in this browser.`
                  : 'Optional for local endpoints. Never written to save files or PGN.'}
              </small>
            </label>
          </div>

          <div className="test-connection-row">
            <button
              type="button"
              className="secondary-button small"
              onClick={handleTest}
              disabled={test.status === 'loading'}
            >
              {test.status === 'loading' ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <PlugZap size={14} />
              )}
              {test.status === 'loading' ? 'Testing…' : 'Test connection'}
            </button>
            {test.status === 'success' ? (
              <span className="test-result success">
                <CircleCheck size={14} />
                {test.message}
              </span>
            ) : null}
            {test.status === 'error' ? (
              <span className="test-result error">
                <CircleAlert size={14} />
                {test.message}
              </span>
            ) : null}
          </div>

          <div className="security-note">
            <ShieldCheck size={15} />
            <p>
              Requests are sent directly from your browser to this URL. The provider must
              permit cross-origin requests. Anyone with access to this browser profile can
              read the stored key.
            </p>
          </div>
        </section>

        <section className="config-section">
          <div className="config-section-title">
            <div>
              <p className="eyebrow">Generation</p>
              <h3>Response behavior</h3>
            </div>
          </div>
          <div className="form-grid two-col">
            <label className="field">
              <span>
                Temperature
                <em className="field-value">{draft.temperature.toFixed(1)}</em>
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={draft.temperature}
                onChange={(event) => update({ temperature: Number(event.target.value) })}
              />
              <small>Lower is steadier; higher is more varied.</small>
            </label>
            <label className="field">
              <span>Max response tokens</span>
              <input
                type="number"
                min={64}
                max={32000}
                step={50}
                value={draft.maxTokens}
                onChange={(event) => update({ maxTokens: Number(event.target.value) })}
              />
              <small>Room for the move, reasoning, and JSON.</small>
            </label>
          </div>
          <div className="form-grid two-col">
            <label className="field">
              <span>Request timeout</span>
              <div className="input-with-suffix">
                <input
                  type="number"
                  min={5}
                  max={180}
                  step={1}
                  value={Math.round(draft.timeoutMs / 1000)}
                  onChange={(event) =>
                    update({ timeoutMs: Number(event.target.value) * 1000 })
                  }
                />
                <span>sec</span>
              </div>
            </label>
            <div className="field">
              <span>Streaming</span>
              <div className="toggle-field">
                <Toggle
                  checked={draft.stream}
                  onChange={(stream) => update({ stream })}
                  label="Stream AI reasoning"
                />
                <small>{draft.stream ? 'Show reasoning as it arrives.' : 'Wait for the full response.'}</small>
              </div>
            </div>
          </div>
        </section>

        <section className="config-section">
          <div className="config-section-title">
            <div>
              <p className="eyebrow">Personality</p>
              <h3>Playing style</h3>
            </div>
            <span className="config-mini-tag">{PERSONA_LABELS[draft.personaPreset] ?? 'Custom'}</span>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Style preset</span>
              <select
                value={draft.personaPreset}
                onChange={(event) =>
                  update({ personaPreset: event.target.value as PersonaPreset })
                }
              >
                {PERSONAS.map((persona) => (
                  <option key={persona} value={persona}>
                    {persona === 'beginner'
                      ? 'Club player — clear plans, friendly explanations'
                      : persona === 'aggressive'
                        ? 'Attacking — dynamic, king-hunting chess'
                        : persona === 'positional'
                          ? 'Positional — harmony, structure, slow pressure'
                          : persona === 'tactical'
                            ? 'Tactical — checks, captures, threats'
                            : persona === 'solid'
                              ? 'Solid — calm defense, fewer risks'
                              : 'Custom — use my own instructions'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>
              Custom system prompt
              <em className="field-badge optional">optional</em>
            </span>
            <textarea
              rows={5}
              maxLength={8000}
              value={draft.systemPromptOverride}
              onChange={(event) => update({ systemPromptOverride: event.target.value })}
              placeholder="Override the style instructions, e.g. “Play like a cautious club player who favors closed positions and explains each plan in two short sentences.”"
            />
            <small>
              Replaces the persona description. Chess rules and the strict JSON response
              format are always enforced.
            </small>
          </label>
        </section>

        <section className="config-section">
          <div className="config-section-title">
            <div>
              <p className="eyebrow">Context</p>
              <h3>Memory &amp; compression</h3>
            </div>
            <span className="config-mini-tag"><BrainCircuit size={12} /> {formatCount(memoryTokens)} stored</span>
          </div>
          <div className="context-usage-card">
            <div className="context-usage-head">
              <span>Current thread usage</span>
              <span>{memoryPercent}% of {formatCount(draft.context.maxTokens)} token budget</span>
            </div>
            <div className="usage-bar large" aria-hidden="true">
              <span style={{ width: `${Math.max(2, memoryPercent)}%` }} />
              <i style={{ left: `${thresholdPercent}%` }} />
            </div>
            <div className="context-usage-foot">
              <span>Compress at {thresholdPercent}%</span>
              <span>{thread.turns.length} stored exchanges</span>
            </div>
          </div>
          <div className="form-grid three-col">
            <label className="field">
              <span>Context budget</span>
              <div className="input-with-suffix">
                <input
                  type="number"
                  min={1000}
                  max={400000}
                  step={1000}
                  value={draft.context.maxTokens}
                  onChange={(event) =>
                    updateContext({ maxTokens: Number(event.target.value) })
                  }
                />
                <span>tokens</span>
              </div>
            </label>
            <label className="field">
              <span>Compress at</span>
              <div className="input-with-suffix">
                <input
                  type="number"
                  min={30}
                  max={98}
                  step={1}
                  value={thresholdPercent}
                  onChange={(event) =>
                    updateContext({
                      thresholdRatio: Number(event.target.value) / 100,
                    })
                  }
                />
                <span>%</span>
              </div>
            </label>
            <label className="field">
              <span>Keep last</span>
              <div className="input-with-suffix">
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  value={draft.context.keepLastNPlies}
                  onChange={(event) =>
                    updateContext({ keepLastNPlies: Number(event.target.value) })
                  }
                />
                <span>plies</span>
              </div>
            </label>
          </div>
          <p className="config-hint">
            The live FEN and legal move list are always sent fresh. When the thread crosses
            the threshold, older moves are summarized before the context window fills.
          </p>
          <div className="memory-clear-row">
            <div>
              <strong>AI memory</strong>
              <span>
                {hasMemory
                  ? (thread.summary
                      ? 'A compressed game summary and recent exchanges are stored.'
                      : 'Recent exchanges are stored for this AI seat.')
                  : 'No stored context. The next turn starts from the position.'}
              </span>
            </div>
            <button
              type="button"
              className={`danger-subtle-button ${confirmClear ? 'is-confirming' : ''}`}
              onClick={handleClearMemory}
              disabled={!hasMemory}
            >
              <Trash2 size={13} />
              {confirmClear ? 'Confirm clear' : 'Clear memory'}
            </button>
          </div>
        </section>

        {formError ? (
          <div className="form-error" role="alert">
            <CircleAlert size={15} />
            {formError}
          </div>
        ) : null}

        <div className="config-footer-note">
          <UserRound size={13} />
          <span>
            You are editing {color}'s seat against {opponent.name}. Changes apply to the
            next move and persist across new games and save files.
          </span>
        </div>
      </div>
    </Modal>
  );
}
