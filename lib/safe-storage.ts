/**
 * The one way client code touches localStorage and sessionStorage (#1445). Privacy browsers, blocked site data,
 * private windows and some embedded iframes make `window.localStorage` itself throw (even reading the property), or
 * make writes throw when storage is full. Every call here is wrapped: reads come back empty, writes and removals do
 * nothing, and the page renders and works the same without storage. Never store anything the page needs to be correct.
 */
export type SafeStorageKind = "local" | "session";

export function getSafeStorage(kind: SafeStorageKind): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function safeGetItem(kind: SafeStorageKind, key: string): string | null {
  try {
    return getSafeStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** True when the value was stored. */
export function safeSetItem(kind: SafeStorageKind, key: string, value: string): boolean {
  try {
    const storage = getSafeStorage(kind);
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemoveItem(kind: SafeStorageKind, key: string): void {
  try {
    getSafeStorage(kind)?.removeItem(key);
  } catch {
    // Nothing to remove.
  }
}

/** Every key currently stored, or an empty list. */
export function safeKeys(kind: SafeStorageKind): string[] {
  try {
    const storage = getSafeStorage(kind);
    if (!storage) return [];
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}
