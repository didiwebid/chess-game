# Browser Chess Game (2 Players, Human / AI Mix) — Build Prompt & Design Notes

This file has two parts:

- **Part 1 — Design decisions and recommendations** (answers to your six questions, plus the tech stack reasoning).
- **Part 2 — Paste-ready build prompt** for a coding AI agent. Copy everything from `## PART 2` onward into the agent.

---

# PART 1 — Design Decisions & Recommendations

## 1. Recommended tech stack (no backend, runs entirely in the browser)

| Layer | Recommendation | Why |
|---|---|---|
| Language | **TypeScript** | A chess state machine + LLM message threads get messy in plain JS; types prevent illegal-state bugs (FEN, move objects, save schema). |
| UI framework | **React 18 + Vite** | You have many stateful pieces (two player panels, config modals, history list, thinking panel); React state/effects fit naturally. Build output is static files — no server needed. |
| Rules engine | **chess.js (v1.x)** | The source of truth for legal moves, check/checkmate/stalemate, castling, en passant, promotion, threefold repetition, 50-move rule, insufficient material. **Never let the LLM be the rules engine.** |
| Board rendering | **react-chessboard** (fallback: chessground / custom SVG) | Drag + click moves, highlights, orientations, animations out of the box. |
| Client state | **zustand** (or React Context) | Single store: game position, move history, player configs, AI threads, UI flags. Simple to serialize into save files. |
| AI calls | `fetch` + **streaming** (ReadableStream / SSE) against an **OpenAI-compatible Chat Completions endpoint** | Provider-agnostic: works with OpenAI, DeepSeek, OpenRouter, local Ollama (`/v1`), etc. Base URL, model name, and API key are user-configurable per player. |
| Persistence | `localStorage` (save slots + autosave) + `Blob` download / `<input type="file">` upload | No backend, no account. JSON save file; PGN export as a bonus. |
| Styling | Plain CSS / CSS Modules (Tailwind optional) | Keeps the dependency footprint small; not core to functionality. |

**Alternatives considered:**
- *Vanilla HTML/CSS/JS, no build step*: possible for a single-file demo, but the AI threading, streaming UI, config modals, and serialization balloon into unmanageable vanilla code. Only choose this if "zero build tooling" is a hard requirement.
- *Stockfish WASM instead of an LLM*: extremely strong, free, offline, and fast, but it has no "reasoning" to display and no natural-language personality — it does not match your "show what AI thinks" and "AI prompt" goals. Recommended only as an **optional extra engine mode** (easy/offline opponent), not the primary AI.

## 2. Answers to your six questions

### (1) UI layout
- **Center:** chess board (responsive square; flip board button; last-move and check highlights; promotion picker dialog).
- **Top panel (Player 2) and bottom panel (Player 1):** name, controller badge (`Human` / `AI`), avatar/initial, captured pieces, material score difference, status line (`thinking… 3.2s`, `in check`, `resigned`), and a gear button opening that player's AI config modal.
- **Right sidebar with tabs:**
  - *Moves* — numbered SAN history, click a move to jump/review, with expandable AI reasoning per move.
  - *AI Thinking* — live stream of the active AI's reasoning text; per-player selector/toggle.
  - *Game* — controls and save/load (see below).
- **Header toolbar:** New Game / Restart, Undo, Flip Board, Resign, Draw offer, Save (slot), Download (.json), Load (file picker + saved slots list), Export PGN, Restart.
- **AI config modal (per player, independent settings):** provider base URL, model, API key, temperature, max tokens, streaming on/off, personality/style preset + free-text system-prompt override, strength/playing style, context budget (max tokens, compression threshold, keep-last-N-plies), "clear AI memory" button.
- **Player-type switch:** a Human ⇄ AI toggle on each panel. Switching mid-game just changes who responds on the next turn; history and reasoning are preserved.

### (2) AI context — keep full, or compress when full?
**Layered policy; compress before the window fills, never at the last message.** The board position itself must never rely on history: the current **FEN is sent fresh every turn**. History only supports reasoning.

Per AI player, maintain a message thread:
1. System prompt (static).
2. Compression/summary block (empty initially) — narrative of the early game.
3. Recent verbatim moves — last **N plies** (default 20, configurable).
4. The current turn message (FEN, side to move, last move, legal-move list SAN, recent history, requested JSON).

Trigger compression when estimated tokens ≥ **80%** of the configured context budget: run a lightweight summarization request that produces: opening played, material count, king safety, pawn structure, active threats, plan so far; replace all verbatim moves older than N with that single summary message. Always re-estimate after compression. Persist the thread (or enough of it to rebuild) in the save file so an AI resumes with continuity after a reload.

### (3) AI prompt
Two prompts are needed:
- **System prompt:** persona + objective + concise rules summary + strict output format + behavioral constraints (see template in Part 2).
- **Per-turn user message:** FEN, side to move, move number, last move, **full list of legal moves in SAN** (this is critical — the model picks from valid moves, it never invents one), recent history, and the instruction to return JSON with `move` + `reasoning`.
- **Compression prompt:** small template that condenses old moves into the summary block.

### (4) Are chess rules injected into the AI prompt?
**Yes, but as guidance only; enforcement belongs to chess.js.**
- System prompt contains a short rules summary: objective, legal move families, castling, en passant, promotion, check/checkmate, stalemate, draw types (threefold repetition, 50-move, insufficient material).
- Every turn sends the authoritative **legal-move list** from chess.js.
- The returned move is validated by chess.js; if illegal, feed the correction back (`Illegal move "X"; legal moves: …`) and retry (default max 3 attempts), then fall back to a deterministic legal move (preferred engine/random) so the game never stalls.
- The model's prose may mis-describe rules; the position never does.

### (5) Show what AI thinks
- Stream reasoning tokens live into that player's panel / the *AI Thinking* tab while the move request is in flight.
- Store each AI's `reasoning` string on its move record; expandable under the move in history.
- Toggle: show/hide thinking; if the endpoint does not support streaming, fall back to showing the final reasoning after the call and a `thinking…` indicator with elapsed time.

### (6) Save / load / download / switch player types
- **Save model (JSON):** format version, FEN, PGN, move records (ply, SAN, controller, provider/model, reasoning, timestamp, clock if any), both players' full configs (including which are human/AI), status/result, and the AI message threads (or serializable reconstruction data).
- **Save:** autosave to a `last game` localStorage slot on every move; manual named slots; **Download** writes the JSON file via `Blob`; **Load** reads an uploaded JSON file or restores a slot; validate FEN and schema version before applying.
- **Player type switching:** each panel's toggle changes `controller: human | ai` immediately; the next turn uses the new controller. If an AI call is in flight when toggled to human, abort it; if toggled to AI on its turn, trigger a move request. Configs per slot persist across restart, save, and load; a "New Game" resets position but keeps player configs unless "Reset all" is chosen.
- **Bonus:** standard PGN export for compatibility with external chess apps.

## Security / caveats to state in the prompt
- No backend means the API key lives in the browser (`localStorage`) and is visible to anyone using that machine — it must be user-entered, never hardcoded, and masked in the UI.
- All AI output (moves, reasoning) is untrusted input: validate moves, sanitize rendered reasoning text (escape HTML), cap token counts and request timeouts.

---

# PART 2 — Paste-Ready Build Prompt

> Copy the prompt below (from `## BUILD PROMPT START` to `## BUILD PROMPT END`) into your coding AI agent.

## BUILD PROMPT START

You are a senior frontend engineer. Build a **fully client-side, web-based chess game** that two players can play locally (same screen), where each player slot can be independently configured as **Human** or **AI**, in any combination (Human vs Human, Human vs AI, AI vs AI). **There is no backend, no server, no accounts, and no database** — all state lives in the browser; game files are saved/loaded via download/upload and `localStorage`.

### 1. Tech stack (use exactly this unless blocked)
- **Vite + React 18 + TypeScript** (strict mode).
- **chess.js v1.x** as the sole authority on chess rules and legality.
- **react-chessboard** for the board UI (fallback: chessground or custom SVG board).
- **zustand** for global game state.
- OpenAI-compatible **Chat Completions API** called directly from the frontend with `fetch`; **stream responses** when the endpoint supports it. Configurable base URL so OpenAI, OpenRouter, DeepSeek, or local Ollama (`http://localhost:11434/v1`) all work.
- Persistence: `localStorage` + `Blob` download + file upload; export standard **PGN**.
- Plain CSS / CSS Modules; Tailwind allowed but optional. Keep dependencies minimal.

### 2. Hard non-goals
- No backend, no API keys hardcoded in source; the user enters keys in the UI and they are stored only in that browser's `localStorage`, masked in the input.
- The LLM must never be trusted for legality, position state, or game result. chess.js enforces everything.
- No user authentication, no multiplayer over the network, no analytics.

### 3. Rules engine behavior (chess.js is authoritative)
- Legal moves, check, checkmate, stalemate, castling, en passant, promotion (with an on-board promotion picker), threefold repetition, 50-move rule, insufficient-material draws.
- Detect and display terminal states: checkmate winner, stalemate, draw types, resignation, agreement draw.
- Undo: revert the position to a previous ply, truncate the move list, truncate AI threads back to that ply, and re-validate.

### 4. UI requirements
Layout (responsive; board stays a square):

1. **Header toolbar:** New Game / Restart, Undo, Flip Board, Resign, Offer Draw, Save Slot, Download Game (.json), Load (file picker + saved-slot list with delete), Export PGN, Reset All.
2. **Player panels (top = opponent side, bottom = player side, flipped with orientation):** name, controller badge `Human`/`AI`, Human⇄AI toggle, captured pieces, material advantage (pawns count), status line (`thinking… ⏱ elapsed`, `in check`, `checkmate`, `resigned`), gear button for AI config, and a compact live reasoning area or toggle to open the thinking tab.
3. **Board:** legal-move highlights on selection, last-move highlight, check square highlight, optional animation, promotion dialog, coordinates toggle.
4. **Sidebar tabs:**
   - **Moves:** numbered SAN list; click a ply to view that position; expandable AI reasoning under AI moves.
   - **AI Thinking:** live streamed reasoning of the currently thinking AI; player selector; show/hide toggle; retains history of reasoning per move.
   - **Game:** controls, save-slot manager (name, timestamp, delete), result banner, draw/ resignation controls.
5. **Per-AI config modal (one independent instance per player slot):**
   - Provider: base URL, API key (password masked, stored per slot), model name.
   - Generation: temperature, max tokens, stream on/off, request timeout (default 20s, abortable).
   - Persona: style preset (e.g., Aggressive Positional / Quiet Solid / Tactical / Beginner-friendly) plus free-text system-prompt override.
   - Context: max context tokens (default 12000), compression threshold ratio (default 0.8), keep-last-N-plies verbatim (default 20), "Clear AI memory" button.
   - Test connection button (cheap models.list or a 1-token ping) with success/error display.

### 5. AI module specification

#### 5.1 Per-turn flow (when an AI controller owns the side to move)
1. Build the turn message from the live chess.js state: FEN, side to move, move number, last SAN move, **legal moves list in SAN** (from `game.moves()`), and recent history.
2. Compose thread = system prompt + optional summary block + recent verbatim turns + current turn message. Estimate tokens; if ≥ threshold, run compression first (5.3).
3. Call the configured endpoint with streaming; append streamed `reasoning` to the UI live and buffer it.
4. Parse the final assistant message as JSON `{ "move": "<SAN or UCI>", "reasoning": "<text>", "confidence": "high|medium|low" }`.
5. Validate with chess.js:
   - Legal → apply the move, record `{ ply, san, controller: "ai", provider, model, reasoning, timestamp, elapsedMs }`, advance turn.
   - Illegal or unparsable → append a correction user message (`Your move "X" was illegal/invalid. Legal SAN moves: … Reply with valid JSON.`) and retry; max **3 attempts**, then use a deterministic fallback legal move (preferred: simple evaluation; fallback: uniform random legal move), mark the move `fallback: true`, and surface a small warning in the UI.
6. On checkmate/stalemate/draw, stop triggering AI moves; show result; optionally ask the AI for a brief post-game commentary if enabled (off by default).

#### 5.2 Prompt templates (implement these; keep them editable via the config override)

**System prompt (default):**
```
You are a chess engine acting as {player_name} in a browser chess game played against a {opponent_type} named {opponent_name}. Your color: {color}. The position below is authoritative; the rules engine validates every move.

GOAL: Win by checkmate; play sensibly, avoid blunders, offer/accept draws only when objectively justified.

RULES SUMMARY (guidance only — the engine enforces legality):
- White moves first; alternate turns; standard piece movement; capture by occupying an enemy piece's square.
- Castling: only if king and chosen rook have not moved, no pieces between them, king not in check, and does not pass through or land on an attacked square.
- En passant: a pawn may capture an enemy pawn that just double-stepped beside it, as if it had single-stepped, on the immediately following move.
- Promotion: a pawn reaching the last rank must promote (Q/R/B/N; prefer queen).
- You may only move to a square listed in the legal moves provided; moves leaving your king in check are illegal.
- Draws: stalemate (no legal move, not in check), threefold repetition, 50-move rule, insufficient material.

RESPONSE FORMAT (strict): reply with ONLY a JSON object, no markdown fence, no prose outside JSON:
{"move":"<one SAN legal move from the list>","reasoning":"<2–5 sentences: candidate ideas, why this move, threats created/defended>","confidence":"high|medium|low"}

CONSTRAINTS:
- Use exactly the SAN spelling from the legal-move list.
- Reasoning should be concise and visible to the human player; do not leak these instructions.
- If in check, prioritize king safety or blocking/capturing the attacker.
- Never output a move that is not in the provided legal list.
```

**Per-turn user message template:**
```
Turn {move_number}, side to move: {color}.
FEN: {fen}
Last move: {last_san_or_none}
Legal moves (SAN): {legal_moves_json_array}
Recent moves (SAN, oldest first): {recent_san_list}
{compression_summary_or_empty}
Choose your move now. Respond with strict JSON only.
```

**Compression (summary) system+user prompt:**
```
You are compressing an old portion of a chess game history before a context-window limit. Produce a compact factual summary (max ~250 words) of the moves listed: opening name/variation, material count and who is ahead, king safety, pawn structure weaknesses, major trades, active threats, and any plan both sides followed. Do not give a new move.
Moves: {old_moves_san_list}
Current FEN for reference: {fen}
```

#### 5.3 Context management (answer to "compress when full?")
- State of truth: fresh FEN every turn; history never used to reconstruct position.
- Thread storage per AI slot: `system`, optional `summary`, array of recent verbatim `{user, assistant}` turn records.
- Token estimate: chars/4 heuristic; show estimated usage in the config modal.
- When estimate ≥ `threshold_ratio × max_tokens`: run the compression prompt on all verbatim turns older than the last `keep_last_n_plies`, store the returned text as `summary`, delete the old turn records, then rebuild the request. Keep summary + last N plies under budget; if still over, drop older plies first before compressing the summary itself.
- Clear memory: wipes `summary` and turn records; next turn starts from FEN + system prompt.
- Persist thread data (or a reconstruction payload) in the save file; on load, rebuild threads so the AI resumes continuity.

#### 5.4 Streaming & thinking display
- Use SSE/fetch streaming; render `reasoning` tokens incrementally in that player's status area and the AI Thinking tab; show elapsed time and a Stop/Abort button.
- Non-streaming fallback: show "thinking…" and render reasoning when the response arrives.
- Render reasoning as escaped plain text (or safe markdown); never inject raw HTML.

### 6. Persistence specification

#### 6.1 Save file JSON schema (versioned; validate on load)
```json
{
  "format": "browser-chess-save",
  "version": 1,
  "savedAt": "ISO-8601 string",
  "orientation": "white",
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "pgn": "[Event \"Browser Game\"] ...",
  "moves": [
    {
      "ply": 1,
      "san": "e4",
      "color": "white",
      "controller": "ai",
      "provider": "https://api.openai.com/v1",
      "model": "gpt-4o-mini",
      "reasoning": "...",
      "fallback": false,
      "timestamp": "ISO-8601",
      "elapsedMs": 1834
    }
  ],
  "players": {
    "white": {
      "name": "White",
      "controller": "human",
      "config": {
        "baseUrl": "", "apiKeySaved": true, "model": "",
        "temperature": 0.7, "maxTokens": 600, "stream": true,
        "personaPreset": "positional", "systemPromptOverride": "",
        "context": { "maxTokens": 12000, "thresholdRatio": 0.8, "keepLastNPlies": 20 },
        "timeoutMs": 20000
      }
    },
    "black": { "...": "same shape" }
  },
  "threads": {
    "white": { "summary": "", "turns": [] },
    "black": { "summary": "", "turns": [] }
  },
  "status": { "result": "ongoing | white | black | draw", "reason": "..." },
  "clocks": { "enabled": false, "whiteMs": 0, "blackMs": 0 }
}
```
- Never write the raw API key into the exported file; store keys only in a separate, browser-local `localStorage` map keyed by slot; the save file only records `apiKeySaved: true` and a masked hint. On load, if no key exists, prompt in the AI config modal.

#### 6.2 Save / load behaviors
- Autosave to a reserved `chess.lastGame` localStorage entry after every completed move (debounced).
- Named slots: `chess.saves.v1` array `{id, name, savedAt, snapshot}`; UI lists, renames, deletes, and restores them.
- Download: serialize current state per schema and trigger a `.json` download named `chess-game-<timestamp>.json`.
- Load: file input `.json` (accept also `.pgn` for position-only import), validate schema version and FEN (`chess.js.validateFen`); reject corrupt files with a clear message; restore position, history, result, both configs, and threads; abort any in-flight AI request before applying.
- Export PGN via chess.js `pgn()`; import PGN sets the position and move list with `controller: "human"` for all plies.

### 7. Switching player types anytime
- Each panel toggle sets `controller` between `human` and `ai`; the change takes effect on the upcoming turn (never mid-move).
- If the switched-to AI owns the side to move, enqueue one AI turn after a short delay; if an AI request is in flight and its slot is switched to human, `AbortController.abort()` it and discard partial output.
- Switching back to AI restores that slot's persisted thread; offer a small menu: "Resume memory" / "Start fresh memory".
- Configs (model, key, persona, context) persist across restarts and saves independently of controller type.

### 8. Edge cases & robustness
- API failure, timeout, malformed JSON, and repeated illegal attempts: retry with backoff (max 2), deterministic fallback move, visible error badge; never leave the game waiting forever.
- AI vs AI auto-play: optional speed delay between moves (e.g., 800ms) and a Pause/Play button; stop on terminal state.
- Resign button per side; draw offer with acceptance/rejection dialog; prevent offers after terminal state.
- Responsive layout for narrow screens: panels stack above/below the board; sidebar becomes a bottom sheet/tabs.
- Escape all rendered reasoning and names; clamp input lengths; sanitize config values before requests.

### 9. Suggested file structure
```
src/
  main.tsx
  App.tsx
  store/chessStore.ts            # zustand: position, history, players, threads, ui flags
  engine/chess.ts                # chess.js wrapper: legal moves, apply, undo, FEN/PGN, status
  ai/
    client.ts                    # OpenAI-compatible fetch + streaming
    prompts.ts                   # system, turn, compression templates
    contextManager.ts            # token estimate, compression trigger, thread ops
    orchestrator.ts              # per-turn flow, retries, fallback, abort
  components/
    board/ChessBoard.tsx
    panels/PlayerPanel.tsx
    panels/AiConfigModal.tsx
    sidebar/MoveHistory.tsx
    sidebar/ThinkingPanel.tsx
    sidebar/GameControls.tsx
    toolbar/Toolbar.tsx
  persistence/saveLoad.ts        # schema, localStorage slots, download/upload, PGN
  types/chess.ts                 # shared TS types (SaveFile, MoveRecord, PlayerConfig, Thread)
  styles/...
```

### 10. Acceptance checklist (verify before finishing)
- [ ] Human vs Human play: all legal move types (castling both sides, en passant, promotion to Q/R/B/N), check/checkmate/stalemate/draw detection displayed.
- [ ] Each of the four controller combinations works; Human⇄AI toggle works mid-game without breaking position.
- [ ] AI move always comes from the legal list; illegal retries and fallback path exercised and logged.
- [ ] AI reasoning streams live when streaming is supported; stored per move and viewable in history; hidden when toggled off.
- [ ] Context compression triggers at threshold; summary replaces old plies; current FEN remains authoritative; game state unchanged after compression.
- [ ] Save JSON download → reload file reproduces position, history, result, configs, and AI threads; named localStorage slots save/restore/delete; PGN export/import works.
- [ ] API key masked in UI, absent from exported files, never committed in source.
- [ ] New Game, Restart, Undo, Flip, Resign, Draw, Abort/Stop AI, AI-vs-AI pause all function; responsive layout works at narrow widths.
- [ ] TypeScript strict build passes with no errors; no external network calls except the user-configured AI endpoint.

### 11. Implementation order (suggested milestones)
1. Project scaffold + chess.js state store + board rendering with Human moves and history.
2. Panels, toolbar, undo/flip/resign/draw, status display.
3. AI client + single AI slot turn flow with validation, retries, fallback.
4. Streaming reasoning UI + thinking tab + per-move reasoning records.
5. Context manager (estimation, compression, memory clear).
6. Persistence: schema, slots, autosave, download/upload, PGN export/import.
7. Config modal per slot, provider/test-connection, mid-game type switching, AI-vs-AI autoplay controls.
8. Polish: responsive layout, error states, acceptance checklist pass, build and lint clean.

## BUILD PROMPT END

---

## Optional enhancements (not required; mention in the prompt only if wanted)
- Stockfish WASM as a free offline engine mode (no reasoning text; used for "Beginner/Intermediate" levels or when no API key exists).
- Chess clocks with increment; move-time limits for AI turns.
- Opening-book hints, move-quality evaluation bar, and post-game move review.
- Themes/board piece sets and sound effects.
