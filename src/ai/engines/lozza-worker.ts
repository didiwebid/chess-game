// Lozza Worker - Runs Lozza engine off the main thread
import './lozza/lozza.js';

// Catch any unhandled errors and report them
self.addEventListener('error', (e) => {
  self.postMessage('error: ' + e.message);
});
