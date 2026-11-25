// Tonnetto Worker - Runs Tonnetto engine off the main thread
// Import the Tonnetto library as an ES module
import TonnettoEngine from './tonnetto-lib.js';

// Create engine instance
const engine = new TonnettoEngine();

// Handle incoming messages
self.onmessage = async (e: MessageEvent) => {
  const { fen, depth, id } = e.data;

  try {
    engine.setFen(fen);

    // Run search on worker thread
    const uciMove = engine.getBestMove(depth);

    if (!uciMove) {
      self.postMessage({ id, move: null, error: 'Tonnetto could not find a move' });
      return;
    }

    // Send result back to main thread
    self.postMessage({ id, move: uciMove, error: null });
  } catch (error) {
    self.postMessage({ id, move: null, error: error instanceof Error ? error.message : 'Unknown error' });
  }
};