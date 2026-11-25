import type { Color } from '../types/chess';

const API_KEYS_STORAGE_KEY = 'gambit.apiKeys.v1';

type ApiKeyMap = Record<Color, string>;

function emptyKeys(): ApiKeyMap {
  return { white: '', black: '' };
}

export function getApiKeys(): ApiKeyMap {
  if (typeof window === 'undefined') return emptyKeys();
  try {
    const raw = window.localStorage.getItem(API_KEYS_STORAGE_KEY);
    if (!raw) return emptyKeys();
    const parsed = JSON.parse(raw) as Partial<ApiKeyMap>;
    return {
      white: typeof parsed.white === 'string' ? parsed.white : '',
      black: typeof parsed.black === 'string' ? parsed.black : '',
    };
  } catch {
    return emptyKeys();
  }
}

export function setApiKey(color: Color, key: string): void {
  if (typeof window === 'undefined') return;
  try {
    const keys = getApiKeys();
    keys[color] = key.trim();
    window.localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Storage can be unavailable in private or locked-down contexts.
  }
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 4) return '••••';
  return `••••••••${key.slice(-4)}`;
}
