declare module '../betafish.js' {
  export interface BetafishEngine {
    getFEN(): string;
    setFEN(fen: string): void;
    getMovesAtSquare(sq: number): number[];
    move(mv: number): void;
    makeAIMove(): string | false;
    reset(): void;
    gameStatus(): { over: string | false; sideToMove: string; check: number };
    setThinkingTime(time: number): void;
  }

  const engine: () => BetafishEngine;
  export { engine };
}