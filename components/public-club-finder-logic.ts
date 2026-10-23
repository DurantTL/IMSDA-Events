export type TileStatus = "ready" | "tiles-failed";

/** Wraps an import so a rejection is not cached: the next call tries again. */
export function createRetryableLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = load().catch((error: unknown) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}

/** A tile error is sticky until the map is retried, so the status cannot flap. */
export function nextTileStatus(current: TileStatus, event: "tileerror" | "tileload"): TileStatus {
  if (event === "tileerror") return "tiles-failed";
  return current;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** The announced count. Leaves out the map part when the map is unavailable. */
export function announcedCountText(found: number, mapped: number, mapUsable: boolean) {
  const base = `${found} publicly listed ${plural(found, "club", "clubs")} found`;
  return mapUsable ? `${base} · ${mapped} shown on map` : base;
}

export function unmappedSentence(unmapped: number) {
  if (unmapped <= 0) return "";
  return `${unmapped} ${plural(unmapped, "club has", "clubs have")} no map location and ${plural(unmapped, "is", "are")} listed only.`;
}

/** On phones, never leave people on an empty or broken map. */
export function effectiveView(view: "list" | "map", foundCount: number, mapProblem: boolean): "list" | "map" {
  return view === "map" && (foundCount === 0 || mapProblem) ? "list" : view;
}
