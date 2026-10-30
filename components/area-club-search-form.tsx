"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { focusSearchInput, SearchClearButton } from "@/components/search-clear-button";
import { SEARCH_DEBOUNCE_MS, syncFieldValue } from "@/components/organization-search-controls";

/**
 * The address for an Area Coordinator club search (#1013): the base path with
 * `year` and `sort` carried along and `q` only when the search has text.
 */
export function areaClubSearchHref(basePath: string, state: { q?: string; year?: string; sort?: string; month?: string }) {
  const params = new URLSearchParams();
  if (state.year) params.set("year", state.year);
  if (state.sort) params.set("sort", state.sort);
  if (state.month) params.set("month", state.month);
  const q = (state.q ?? "").trim();
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * The club-name search of the Area Coordinator tabs (#791, #1013). A plain GET
 * form, so it works before the script loads and Enter or Search submits it.
 * With script, typing updates the address with `router.replace` after a short
 * pause (the #723 pattern), so the server filters without a history entry per
 * keystroke or a scroll to the top. The status line comes from the server
 * result, so it is announced once per settled search.
 */
export function AreaClubSearchForm({
  basePath,
  clubYear,
  label,
  month,
  query,
  shown,
  sort,
  total,
}: {
  basePath: string;
  clubYear?: string;
  label: string;
  /** A report month ("YYYY-MM") a page keeps across searches (#1315). */
  month?: string;
  query: string;
  shown: number;
  sort?: string;
  total: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();
  const [hasText, setHasText] = useState(query !== "");

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    syncFieldValue(form.elements.namedItem("q") as HTMLInputElement | null, query, document.activeElement);
    setHasText((form.elements.namedItem("q") as HTMLInputElement | null)?.value !== "");
  }, [query]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function apply() {
    if (timer.current) clearTimeout(timer.current);
    const form = formRef.current;
    if (!form) return;
    const q = String(new FormData(form).get("q") ?? "");
    startTransition(() => router.replace(areaClubSearchHref(basePath, { q, year: clubYear, sort, month }), { scroll: false }));
  }

  return (
    <form
      action={basePath}
      aria-busy={pending}
      className="area-club-search"
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
      ref={formRef}
      role="search"
    >
      {clubYear && <input name="year" type="hidden" value={clubYear} />}
      {sort && <input name="sort" type="hidden" value={sort} />}
      {month && <input name="month" type="hidden" value={month} />}
      <div className="search-field" onMouseDown={focusSearchInput}>
        <Search aria-hidden="true" size={15} />
        <label className="sr-only" htmlFor="area-club-search">{label}</label>
        <input
          autoComplete="off"
          defaultValue={query}
          id="area-club-search"
          maxLength={80}
          name="q"
          onChange={(event) => {
            setHasText(event.target.value !== "");
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(apply, SEARCH_DEBOUNCE_MS);
          }}
          placeholder={label}
          type="search"
        />
        <SearchClearButton
          onClear={() => {
            const input = formRef.current?.elements.namedItem("q") as HTMLInputElement | null;
            if (input) input.value = "";
            setHasText(false);
            apply();
          }}
          visible={hasText}
        />
      </div>
      <button className="secondary-button" type="submit">Search</button>
      {/* Clearing cancels a search still waiting on its pause, so it cannot put the old filter back. */}
      {query && <Link className="text-button" href={areaClubSearchHref(basePath, { year: clubYear, sort, month })} onClick={() => { if (timer.current) clearTimeout(timer.current); }}>Clear</Link>}
      <small aria-live="polite" role="status">{query ? `${shown} of ${total} clubs match` : ""}</small>
    </form>
  );
}
