"use client";

import { useEffect, useState } from "react";
import { hasSearchWords } from "@/components/destination-search-model";
import { STAFF_SEARCH_MAX_QUERY_LENGTH, type StaffSearchResult } from "@/modules/staff-search/domain";

/** Wait this long after the last keystroke before asking the server. */
export const STAFF_RECORD_SEARCH_DEBOUNCE_MS = 200;

type Settled = { query: string; result: StaffSearchResult | null; failed: boolean };

/**
 * Clubs, events and churches for the typed words (#1837), from `GET /api/staff/search`. Nothing is requested for an
 * empty box or a query with no letter or digit. Typing waits 200 ms, and a request that a newer keystroke (or leaving
 * the box) has replaced is aborted, so a slow answer can never overwrite a newer one. The server decides what the
 * viewer may see; this only shows it.
 */
export function useStaffRecordSearch(query: string, enabled: boolean) {
  const words = query.trim().slice(0, STAFF_SEARCH_MAX_QUERY_LENGTH);
  const active = enabled && hasSearchWords(words);
  const [settled, setSettled] = useState<Settled>({ query: "", result: null, failed: false });

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/staff/search?q=${encodeURIComponent(words)}`, { signal: controller.signal, headers: { accept: "application/json" } })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Search answered ${response.status}`);
          return (await response.json()) as StaffSearchResult;
        })
        .then((result) => setSettled({ query: words, result, failed: false }))
        .catch((error: unknown) => {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
          setSettled({ query: words, result: null, failed: true });
        });
    }, STAFF_RECORD_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, words]);

  const current = active && settled.query === words;
  return {
    /** The answer for the typed words; the previous one stays up while a newer one loads, and none for an empty box. */
    result: active ? settled.result : null,
    /** True from the first keystroke until the answer for these words arrives. */
    pending: active && !current,
    failed: active && current && settled.failed,
  };
}
