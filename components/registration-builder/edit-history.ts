// Undo and redo for the draft definition (#1134), kept free of React and the DOM so it can be tested.
// The history holds earlier drafts only; it never touches a saved or published version.

export const HISTORY_LIMIT = 50;
/** Edits to the same text within this many milliseconds are one undo step. */
export const COALESCE_MS = 1000;

export type EditHistory<T> = {
  past: readonly T[];
  future: readonly T[];
  /** What the latest recorded edit changed, for coalescing; null when it must not merge with the next. */
  lastKey: string | null;
  lastAt: number;
};

export function emptyHistory<T>(): EditHistory<T> {
  return { past: [], future: [], lastKey: null, lastAt: 0 };
}

export const canUndo = (history: EditHistory<unknown>) => history.past.length > 0;
export const canRedo = (history: EditHistory<unknown>) => history.future.length > 0;

/**
 * Records that `before` is about to be replaced by an edit. An edit with the same non-null `key` as the previous one,
 * within COALESCE_MS, extends that step instead of adding another. A new edit clears the redo stack.
 */
export function recordEdit<T>(history: EditHistory<T>, before: T, key: string | null, now: number, limit = HISTORY_LIMIT): EditHistory<T> {
  if (key !== null && key === history.lastKey && history.past.length > 0 && now - history.lastAt <= COALESCE_MS) {
    return { ...history, future: [], lastAt: now };
  }
  const past = [...history.past, before];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [], lastKey: key, lastAt: now };
}

export function undo<T>(history: EditHistory<T>, current: T): { history: EditHistory<T>; value: T } | null {
  const value = history.past[history.past.length - 1];
  if (history.past.length === 0 || value === undefined) return null;
  return { value, history: { past: history.past.slice(0, -1), future: [current, ...history.future], lastKey: null, lastAt: 0 } };
}

export function redo<T>(history: EditHistory<T>, current: T): { history: EditHistory<T>; value: T } | null {
  const value = history.future[0];
  if (history.future.length === 0 || value === undefined) return null;
  return { value, history: { past: [...history.past, current], future: history.future.slice(1), lastKey: null, lastAt: 0 } };
}

export function clearHistory<T>(): EditHistory<T> {
  return emptyHistory<T>();
}

/**
 * The path of the one text or number value that differs between two drafts, or null when the edit changed anything else
 * (a structural change, several values, nothing). Typing in one box yields the same path each keystroke.
 */
export function singleValueEditKey(before: unknown, after: unknown): string | null {
  const found: string[] = [];
  const isScalar = (value: unknown) => typeof value === "string" || typeof value === "number";
  function walk(a: unknown, b: unknown, path: string): boolean {
    if (found.length > 1) return false;
    if (a === b) return true;
    if (isScalar(a) && isScalar(b) && typeof a === typeof b) { found.push(path); return true; }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, index) => walk(item, b[index], `${path}[${index}]`));
    }
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const left = a as Record<string, unknown>;
      const right = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (!walk(left[key], right[key], `${path}.${key}`)) return false;
      }
      return true;
    }
    return false;
  }
  return walk(before, after, "$") && found.length === 1 ? found[0]! : null;
}
