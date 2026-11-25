// Stockfish Worker - Runs the Stockfish UCI engine off the main thread.
//
// The vendored build (stockfish/stockfish.js) speaks raw UCI text:
//   - main thread posts a UCI command string, e.g. "uci", "go depth 12"
//   - the worker answers with UCI line strings, e.g. "uciok",
//     "info depth 8 score cp 12 pv e2e4 ...", "bestmove e2e4"
// Importing the script installs its own global onmessage/postMessage bridge.
import './stockfish/stockfish.js';

// Surface worker load/runtime errors to the main-thread adapter.
self.addEventListener('error', (e) => {
  self.postMessage('error: ' + e.message);
});
