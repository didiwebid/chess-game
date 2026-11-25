# ♞ Gambit — Local Chess Table

A fully client-side, two-player chess game built with React, Vite, and TypeScript. Play Human vs Human, Human vs AI, or AI vs AI — all in your browser with no backend, no accounts, and no analytics.

Each player slot can be independently configured as **Human** or **AI**. An AI seat can be powered by any OpenAI-compatible Chat Completions endpoint (OpenAI, OpenRouter, DeepSeek, local Ollama, etc.), or by a **local chess engine that runs entirely in the browser** — Stockfish, Lozza, Tonnetto, Sunfish, or a deterministic Fallback engine. When using an API provider, reasoning streams live and context is managed with automatic compression. Games can be saved, loaded, and exported as PGN.

## Features

- **Four play modes**: Human vs Human, Human vs AI, AI vs Human, AI vs AI
- **Two AI backends**: Any OpenAI-compatible API endpoint, or a local in-browser chess engine (Stockfish, Lozza, Tonnetto, Sunfish, Fallback)
- **Configurable AI**: Per-player provider URL, model, API key, temperature, streaming, persona, and context settings for API providers; depth, movetime, skill, threads, and hash for local engines
- **Live reasoning**: AI thoughts stream in real-time on the player panel and Thinking tab
- **Context management**: Automatic compression when the context window fills; memory clear and resume options
- **Full chess rules**: Castling, en passant, promotion (Q/R/B/N), check/checkmate/stalemate, FIDE repetition rules (threefold claim, fivefold automatic draw), 50-move rule, insufficient material
- **Move review**: Click any move in history to review; navigate with arrow keys
- **Match scoreboard**: Tracks wins, draws, losses, and points for both players across games; persisted in the browser with a one-click reset
- **Save & load**: Named localStorage slots, autosave, JSON download/upload, PGN export/import
- **Responsive layout**: Works on desktop and narrow screens; sidebar stacks below the board
- **Dark walnut-and-gold theme**: Custom CSS, no external fonts or frameworks

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict) |
| UI Framework | React 18 + Vite |
| Rules Engine | chess.js v1.x |
| Board Rendering | react-chessboard v4 |
| Client State | zustand v5 |
| AI Calls | `fetch` + SSE streaming (OpenAI-compatible) and local WebAssembly / Web Worker chess engines |
| Persistence | `localStorage` + Blob download/upload |
| Styling | Plain CSS |

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Install & Run

```bash
npm install
npm run dev
```

The dev server starts at `http://127.0.0.1:5173/`. Open it in your browser.

### Build for Production

```bash
npm run build
npm run preview
```

The production build outputs to the `dist/` directory — static files you can serve from any HTTP server.

### Type Check

```bash
npm run typecheck
```

## Using AI Opponents

1. Click the **gear icon** on a player panel to open AI settings
2. Choose a **Provider**: an OpenAI-compatible API endpoint, or a local engine (Stockfish, Lozza, Tonnetto, Sunfish, or Fallback)
3. Configure the provider:
   - **OpenAI-compatible API** — enter the base URL, model, and API key, then click **Test connection**
   - **Local engine** — set search depth, movetime, skill level, threads, and hash
   - **Stockfish** — Skill level (0–20) controls strength; depth or movetime controls search effort
4. Click **Save settings**
5. Toggle the player to **AI** using the controller switch on their panel

The AI will automatically play on its turn. When using an API endpoint, reasoning streams live; when using a local engine, the engine's depth and evaluation are shown. If an endpoint fails, the game plays a deterministic fallback move and shows a warning.

### OpenAI-compatible Endpoints

Any OpenAI-compatible Chat Completions API:

- **OpenAI**: `https://api.openai.com/v1`
- **OpenRouter**: `https://openrouter.ai/api/v1`
- **DeepSeek**: `https://api.deepseek.com/v1`
- **Ollama (local)**: `http://localhost:11434/v1`
- **Any custom proxy**

### Local Chess Engines

Run entirely in the browser — no API key, no network, no downloads:

- **Stockfish** — UCI engine (Stockfish 10, asm.js build, GPLv3) running in a Web Worker; strongest local option. Skill level 0–20 via UCI `Skill Level`; depth or movetime search
- **Lozza** — WebAssembly UCI engine; strong play, tuned for depth
- **Tonnetto** — TypeScript engine running in a Web Worker; lightweight and fast
- **Sunfish** — pure-JS port of the Sunfish engine (GPLv3, ~30 KB) in a Web Worker; very lightweight and fast at shallow depth; position rebuilt from the move history (no FEN input)
- **Fallback** — deterministic one-ply evaluator; dependency-free and instant

## Save & Load

- **Autosave**: The current game is automatically saved to `localStorage` after every move
- **Named slots**: Save games with custom names; rename, delete, and restore from the Save/Load dialog
- **Download**: Export the full game state as a `.json` file
- **Upload**: Import a previously downloaded `.json` file
- **PGN**: Export standard PGN for use with external chess apps; import PGN to set up positions

API keys are **never** written into save files or PGN exports.

## Match Scoreboard

The **Game** tab shows a scoreboard that tracks the running tally for both players: wins, draws, losses, and total points (a win is 1 point, a draw is 0.5). The scoreboard:

- Updates automatically when a game ends (checkmate, stalemate, resignation, agreed draw, or repetition draw)
- Persists in the browser across reloads and new games
- Is reversed automatically if you undo a finished game
- Can be cleared at any time with the **Reset score** button

## Repetition Rules (FIDE)

The game follows FIDE's 2014 repetition rules rather than ending automatically on the first repetition:

- **Threefold repetition** — the game does **not** end on its own. Once the same position has occurred three times, either player can claim a draw with the **Claim** button in the toolbar or the **Claim threefold** action in the Game panel.
- **Fivefold repetition** — the game is drawn automatically when the same position has occurred five times.

A position is considered identical when the piece placement, side to move, castling rights, and en passant square all match (the move counters are ignored). The current occurrence count is shown in the Claim button's tooltip, and the count is recomputed on every move and undo.

## Project Structure

```
src/
  main.tsx                      # Entry point
  App.tsx                       # Boot, AI scheduling, modal orchestration
  store/chessStore.ts           # Zustand store (game state, AI holds, undo)
  store/defaults.ts             # Initial players, threads, config sanitization
  engine/chessUtils.ts          # Chess.js wrapper, status/material/captures
  engine/fallback.ts            # Deterministic fallback evaluator
  ai/client.ts                  # OpenAI-compatible fetch + SSE streaming
  ai/prompts.ts                 # System, turn, compression templates
  ai/contextManager.ts          # Token estimation, compression, thread ops
  ai/orchestrator.ts            # Per-turn flow, retries, fallback, abort
  ai/engines/                   # Local chess engine adapters
    base.ts                     # EngineManager + shared ChessEngine interface
    stockfish.ts                # Stockfish (UCI Web Worker) engine wrapper
    stockfish-worker.ts         # Stockfish worker entry (loads stockfish/stockfish.js)
    sunfish.ts                  # Sunfish (pure-JS Web Worker) engine wrapper
    sunfish-worker.ts           # Sunfish worker entry (loads sunfish/sunfish.js)
    lozza.ts                    # Lozza (WebAssembly) engine wrapper
    tonnetto.ts                 # Tonnetto (Web Worker) engine wrapper
    fallback.ts                 # Deterministic fallback engine
  components/
    board/BoardArea.tsx         # Board interactions, promotion overlay
    panels/PlayerPanel.tsx      # Player info, captured pieces, status
    panels/AiConfigModal.tsx    # Per-player AI settings
    sidebar/MoveHistory.tsx     # SAN list, review, reasoning
    sidebar/ThinkingPanel.tsx   # Live streaming reasoning
    sidebar/GamePanel.tsx       # Match status, controls, save/export
    sidebar/Sidebar.tsx         # Tab container
    toolbar/Toolbar.tsx         # New game, undo, flip, save, load, etc.
    modals/                     # Resign, draw, memory choice, confirm, save/load
    ui/                         # Modal, toggle, toast stack
  persistence/
    saveLoad.ts                 # Schema, slots, autosave, download/upload, PGN
    apiKeys.ts                  # Browser-local key storage
    scoreboard.ts               # Match scoreboard persistence (wins/draws/losses)
  types/chess.ts                # Shared TypeScript types
  styles/global.css             # Dark walnut-and-gold theme, responsive
```

## Security Notes

- API keys are stored in `localStorage` and are visible to anyone using that machine
- Keys are never hardcoded, never sent to any server except the user-configured endpoint, and never written to save files or PGN exports
- All AI output (moves, reasoning) is treated as untrusted input: moves are validated by chess.js, and reasoning text is escaped before rendering

## Browser Support

Modern browsers with ES Module and CSS custom property support: Chrome 90+, Firefox 90+, Safari 14+, Edge 90+.

## License

MIT

## Source Code

The source code is available on GitHub: <a href="https://github.com/didiwebid/chess-game" target="_blank" rel="noopener noreferrer">https://github.com/didiwebid/chess-game</a>
