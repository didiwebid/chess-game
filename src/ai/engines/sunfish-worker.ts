// Sunfish Worker - Runs the lightweight Sunfish JS engine off the main thread.
//
// The vendored build (sunfish/sunfish.js) speaks a UCI-lite line protocol over
// postMessage strings (same convention as the Stockfish/Lozza workers):
//   main thread -> worker : "uci", "isready",
//                           "position startpos moves e2e4 e7e5",
//                           "go depth 4" / "go wtime 1000 btime 1000", "stop", "quit"
//   worker -> main thread : "uciok", "readyok", "bestmove e7e5"
// The engine script installs its own global onmessage bridge.
import './sunfish/sunfish.js';

// Surface worker load/runtime errors to the main-thread adapter.
self.addEventListener('error', (e) => {
  self.postMessage('error: ' + e.message);
});
