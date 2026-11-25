import type { ScoreEntry, Scoreboard } from '../types/chess';

const SCOREBOARD_KEY = 'gambit.scoreboard.v1';

export function createEmptyScoreboard(): Scoreboard {
  return {
    white: { wins: 0, draws: 0, losses: 0 },
    black: { wins: 0, draws: 0, losses: 0 },
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : fallback;
}

function parseEntry(raw: unknown): ScoreEntry {
  if (!raw || typeof raw !== 'object') {
    return { wins: 0, draws: 0, losses: 0 };
  }
  const source = raw as Record<string, unknown>;
  return {
    wins: numberOr(source.wins, 0),
    draws: numberOr(source.draws, 0),
    losses: numberOr(source.losses, 0),
  };
}

export function loadScoreboard(): Scoreboard {
  try {
    const raw = window.localStorage.getItem(SCOREBOARD_KEY);
    if (!raw) return createEmptyScoreboard();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return createEmptyScoreboard();
    const source = parsed as Record<string, unknown>;
    return {
      white: parseEntry(source.white),
      black: parseEntry(source.black),
    };
  } catch {
    return createEmptyScoreboard();
  }
}

export function saveScoreboard(board: Scoreboard): void {
  try {
    window.localStorage.setItem(SCOREBOARD_KEY, JSON.stringify(board));
  } catch {
    // Best-effort persistence; quota failures should not interrupt play.
  }
}

export function clearScoreboardStorage(): void {
  try {
    window.localStorage.removeItem(SCOREBOARD_KEY);
  } catch {
    // No-op.
  }
}
