"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ProfileCorrectionForm } from "@/components/profile-correction-form";
import { ProfilePersonalCorrectionForm } from "@/components/profile-personal-correction-form";
import styles from "@/components/profile-account-search.module.css";

/** Kept in step with `modules/attendee-accounts/account-search-staff.ts` (a test compares them). */
export const ACCOUNT_SEARCH_MIN = 3;

type Result = { accountId: string; displayName: string; email: string; note: string | null };
type Opened = { accountId: string; accountName: string; current: { firstName: string; lastName: string; phone: string; shirtSize: string } };

/**
 * Find an attendee account that is not on the list above (#1512), then open the same two corrections for it. It searches
 * on Enter or the Search button, needs three characters and lists nothing while empty (docs/SITE-RULES.md S10): every
 * search and every opened account is written to the identity read audit, so nothing is looked up on a keystroke.
 */
export function ProfileAccountSearch() {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [limit, setLimit] = useState(0);
  const [busy, setBusy] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState("");
  const [tooShort, setTooShort] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusPanel = useRef(false);
  const dirty = useRef({ correction: false, personal: false });
  const onCorrectionDirty = useCallback((value: boolean) => { dirty.current.correction = value; }, []);
  const onPersonalDirty = useCallback((value: boolean) => { dirty.current.personal = value; }, []);

  // Once an account has loaded for an Open click, focus moves to its panel heading.
  useEffect(() => {
    if (opened && focusPanel.current) {
      focusPanel.current = false;
      headingRef.current?.focus();
    }
  }, [opened]);

  function say(textToShow: string, isError = false) {
    setError(isError ? textToShow : "");
    if (!isError) setTooShort(false);
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const query = text.trim();
    // An opened account stays open while searching, so typed corrections are not lost.
    setTooShort(false);
    if (query.length < ACCOUNT_SEARCH_MIN) {
      setSearched(null);
      setResults([]);
      setTooShort(true);
      setError(`Type at least ${ACCOUNT_SEARCH_MIN} characters of a name or email, then search.`);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    say("");
    try {
      const response = await fetch(`/api/people/profile-updates/accounts/search?q=${encodeURIComponent(query)}`, { credentials: "same-origin", cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { message?: string; results?: Result[]; limit?: number };
      if (!response.ok) {
        setSearched(null);
        setResults([]);
        say(body.message ?? "The search could not be completed.", true);
        return;
      }
      setSearched(query);
      setResults(body.results ?? []);
      setLimit(body.limit ?? 0);
      say("");
    } catch {
      setSearched(null);
      setResults([]);
      say("The search could not be completed. Check your connection and try again.", true);
    } finally {
      setBusy(false);
    }
  }

  async function open(accountId: string, reload = false) {
    if (openingId !== null) return;
    if (!reload && (dirty.current.correction || dirty.current.personal)
      && !window.confirm("You have unsaved corrections for the account that is open. Open another account and discard them?")) return;
    setOpeningId(accountId);
    say("");
    try {
      const response = await fetch(`/api/people/profile-updates/accounts/${encodeURIComponent(accountId)}`, { credentials: "same-origin", cache: "no-store" });
      const body = await response.json().catch(() => ({})) as Partial<Opened> & { message?: string };
      if (!response.ok || !body.accountId || !body.current) {
        say(body.message ?? "That account could not be opened.", true);
        return;
      }
      if (!reload) focusPanel.current = true;
      setOpened(body as Opened);
    } catch {
      say("That account could not be opened. Check your connection and try again.", true);
    } finally {
      setOpeningId(null);
    }
  }

  const shown = searched !== null;
  const status = shown
    ? results.length === 0
      ? `No accounts match “${searched}”. Check the spelling, or try part of the email address.`
      : results.length >= limit && limit > 0
        ? `The first ${results.length} matches are listed. Add more of the name or email to narrow them.`
        : `${results.length} ${results.length === 1 ? "account matches" : "accounts match"}.`
    : "";

  return (
    <section className={styles.section} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className={styles.title}>Find an account</h2>
      <p className={styles.help} id={`${id}-help`}>
        For someone who is not listed above, such as a person who phones in. Search by name or email (at least {ACCOUNT_SEARCH_MIN} characters).
        Each search and each account you open is recorded in the audit log.
      </p>
      <form className={styles.form} role="search" aria-label="Find an attendee account" onSubmit={(event) => void search(event)} noValidate>
        <label className={styles.label} htmlFor={`${id}-query`}>Name or email</label>
        <div className={styles.row}>
          <input
            ref={inputRef}
            id={`${id}-query`}
            className={styles.input}
            type="text"
            name="account-lookup"
            autoComplete="off"
            maxLength={100}
            aria-describedby={tooShort ? `${id}-help ${id}-error` : `${id}-help`}
            aria-invalid={tooShort || undefined}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className="secondary-button" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
        </div>
      </form>
      <p className={styles.status} role="status">{error ? "" : status}</p>
      <p id={`${id}-error`} className={styles.error} role="alert">{error}</p>
      {shown && results.length > 0 ? (
        <ul className={styles.list}>
          {results.map((result) => (
            <li key={result.accountId} className={styles.card}>
              <div className={styles.who}>
                <span className={styles.name} translate="no">{result.displayName}</span>
                <span className={styles.meta} translate="no">{result.email}</span>
                {result.note ? <span className={styles.note}>{result.note}</span> : null}
              </div>
              <button
                type="button"
                className="secondary-button"
                aria-disabled={openingId !== null || undefined}
                aria-busy={openingId === result.accountId || undefined}
                aria-label={`Open corrections for ${result.displayName}`}
                onClick={() => void open(result.accountId)}
              >
                {openingId === result.accountId ? "Opening…" : "Open"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {opened ? (
        <div className={styles.opened} aria-label={`Corrections for ${opened.accountName}`}>
          <h3 ref={headingRef} tabIndex={-1} className={styles.name} translate="no">{opened.accountName}</h3>
          <ProfileCorrectionForm key={opened.accountId} accountId={opened.accountId} current={opened.current} onSaved={() => void open(opened.accountId, true)} onDirtyChange={onCorrectionDirty} />
          <ProfilePersonalCorrectionForm key={`${opened.accountId}-personal`} accountId={opened.accountId} onDirtyChange={onPersonalDirty} />
        </div>
      ) : null}
    </section>
  );
}
