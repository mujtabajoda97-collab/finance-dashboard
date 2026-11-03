'use client';

/** Light per-user copy of the last loaded data so the app opens instantly and works (read-only) offline. */
const PREFIX = 'lifeos_cache_v1:';

export function cacheGet<T>(uid: string, key: string): T | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${uid}:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function cacheSet(uid: string, key: string, value: unknown): void {
  try {
    localStorage.setItem(`${PREFIX}${uid}:${key}`, JSON.stringify(value));
  } catch {
    /* storage full or private mode: the cache is only a convenience */
  }
}

/** Removes every cached copy (used on sign-out so another account never sees it). */
export function cacheClear(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
