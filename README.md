# ♞ Gambit — Local Chess Table

A fully client-side, two-player chess game built with React, Vite, and TypeScript. Play Human vs Human, Human vs AI, or AI vs AI — all in your browser with no backend, no accounts, and no analytics.

Each player slot can be independently configured as **Human** or **AI**, where the AI connects to any OpenAI-compatible Chat Completions endpoint (OpenAI, OpenRouter, DeepSeek, local Ollama, etc.). AI reasoning streams live, context is managed with automatic compression, and games can be saved, loaded, and exported as PGN.

## Features

- **Four play modes**: Human vs Human, Human vs AI, AI vs Human, AI vs AI
- **Configurable AI**: Per-player provider URL, model, API key, temperature, streaming, persona, and context settings
- **Live reasoning**: AI thoughts stream in real-time on the player panel and Thinking tab
- **Context management**: Automatic compression when the context window fills; memory clear and resume options
- **Full chess rules**: Castling, en passant, promotion (Q/R/B/N), check/checkmate/stalemate, threefold repetition, 50-move rule, insufficient material
- **Move review**: Click any move in history to review; navigate with arrow keys
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
| AI Calls | `fetch` + SSE streaming (OpenAI-compatible) |
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
2. Enter your provider's base URL (e.g., `https://api.openai.com/v1`, `http://localhost:11434/v1` for Ollama)
3. Enter the model name (e.g., `gpt-4o-mini`, `llama3`)
4. Enter your API key (stored only in that browser's `localStorage`)
5. Click **Test connection** to verify, then **Save settings**
6. Toggle the player to **AI** using the controller switch on their panel

The AI will automatically play on its turn. If the endpoint fails, the game plays a deterministic fallback move and shows a warning.

### Supported Endpoints

Any OpenAI-compatible Chat Completions API:

- **OpenAI**: `https://api.openai.com/v1`
- **OpenRouter**: `https://openrouter.ai/api/v1`
- **DeepSeek**: `https://api.deepseek.com/v1`
- **Ollama (local)**: `http://localhost:11434/v1`
- **Any custom proxy**

## Save & Load

- **Autosave**: The current game is automatically saved to `localStorage` after every move
- **Named slots**: Save games with custom names; rename, delete, and restore from the Save/Load dialog
- **Download**: Export the full game state as a `.json` file
- **Upload**: Import a previously downloaded `.json` file
- **PGN**: Export standard PGN for use with external chess apps; import PGN to set up positions

API keys are **never** written into save files or PGN exports.

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
