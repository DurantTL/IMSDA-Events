// Loads the question library for the builder (#1070) and layers it over a palette registry. The library is read from the
// server for the event being built (the route checks the form-building permission); a failed or refused read leaves the
// palette as it was, with an empty Question library group.
import { useEffect, useMemo, useState } from "react";
import type { QuestionLibraryItemView } from "@/modules/question-library/domain";
import { createLibraryRegistry } from "./library-registry";
import type { PaletteRegistry } from "./palette-registry";

export function useQuestionLibraryRegistry(base: PaletteRegistry, eventId: string | null | undefined, refresh: number): PaletteRegistry {
  const [items, setItems] = useState<readonly QuestionLibraryItemView[]>([]);
  useEffect(() => {
    let cancelled = false;
    const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : "";
    fetch(`/api/question-library${query}`, { headers: { Accept: "application/json" } })
      .then(async (response) => (response.ok ? ((await response.json()) as { items?: QuestionLibraryItemView[] }).items ?? [] : []))
      .catch(() => [] as QuestionLibraryItemView[])
      .then((loaded) => { if (!cancelled) setItems(loaded); });
    return () => { cancelled = true; };
  }, [eventId, refresh]);
  return useMemo(() => createLibraryRegistry(base, items), [base, items]);
}
