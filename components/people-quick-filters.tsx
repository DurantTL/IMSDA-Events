"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { isCurrentAddress, useDebouncedCallback } from "@/components/search-as-you-type";
import {
  PEOPLE_FILTER_SEVERAL,
  parsePeopleFilters,
  peopleFilterCount,
  peopleHref,
  peopleRoleKey,
  peopleRoleOptions,
  type PeopleFilters,
} from "@/modules/system-admin/people-directory-model";
import styles from "./people-directory.module.css";

type Option = { id: string; name: string };
type Dimension = "role" | "event" | "club";

/**
 * The search box and the Role, Event and Club selects (#1321). Changing a select goes straight to the filtered list
 * (`router.push` inside a transition, so the select stays mounted and keeps focus). It is still a plain GET form, so
 * without JavaScript the Search/Apply button does the same job. When the Filters panel chose several values for a
 * select, that select shows "Several (n)", and hidden `keep*` inputs carry the values through a no-JavaScript submit.
 */
export function PeopleQuickFilters({
  query,
  scope,
  filters,
  eventOptions,
  clubOptions,
}: {
  query: string;
  scope: "full" | "clubs";
  filters: PeopleFilters;
  eventOptions: readonly Option[];
  clubOptions: readonly Option[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  // What the selects show: the URL's filters, replaced at once by the tidied result of the viewer's own change.
  const signature = peopleHref({ filters });
  const [shown, setShown] = useState(filters);
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setShown(filters);
  }

  const change = (dimension: Dimension) => (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (value === PEOPLE_FILTER_SEVERAL) return;
    const next = parsePeopleFilters({
      role: dimension === "role" ? value : shown.roles.map(peopleRoleKey),
      event: dimension === "event" ? value : shown.eventIds,
      club: dimension === "club" ? value : shown.clubIds,
    }, scope);
    setShown(next);
    const typed = event.currentTarget.form ? String(new FormData(event.currentTarget.form).get("q") ?? "").trim() : query;
    startTransition(() => router.replace(peopleHref({ query: typed, filters: next }), { scroll: false }));
  };

  // With JavaScript, the search goes to the canonical repeated-param URL (page 1, no __several / keep* form fields),
  // after a pause in typing (#1431) or at once on Enter or Search; replace, so typing adds no history entries.
  const formRef = useRef<HTMLFormElement>(null);
  const apply = () => {
    const form = formRef.current;
    if (!form) return;
    const typed = String(new FormData(form).get("q") ?? "").trim();
    const href = peopleHref({ query: typed, filters: shown });
    if (isCurrentAddress(href)) return;
    startTransition(() => router.replace(href, { scroll: false }));
  };
  const typing = useDebouncedCallback(apply);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    typing.cancel();
    apply();
  };

  const selectValue = (list: readonly string[]) => (list.length === 0 ? "" : list.length === 1 ? list[0] : PEOPLE_FILTER_SEVERAL);
  const roleKeys = shown.roles.map(peopleRoleKey);
  const active = peopleFilterCount(shown) > 0;
  return (
    <form action="/admin/people" aria-busy={busy} className={styles.search} method="get" onSubmit={submit} ref={formRef} role="search">
      <label className={styles.searchField}>
        Search by name or email
        <input autoComplete="off" defaultValue={query} maxLength={120} name="q" onChange={() => typing.schedule()} type="search" />
      </label>
      <label className={styles.searchField}>
        Who has this role
        <select name="role" onChange={change("role")} value={selectValue(roleKeys)}>
          <option value="">Everyone</option>
          {roleKeys.length > 1 ? <option value={PEOPLE_FILTER_SEVERAL}>Several ({roleKeys.length}), see Filters</option> : null}
          {peopleRoleOptions(scope).map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {scope === "full" ? (
        <label className={styles.searchField}>
          Event
          <select name="event" onChange={change("event")} value={selectValue(shown.eventIds)}>
            <option value="">Pick an event</option>
            {shown.eventIds.length > 1 ? <option value={PEOPLE_FILTER_SEVERAL}>Several ({shown.eventIds.length}), see Filters</option> : null}
            {eventOptions.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </label>
      ) : null}
      <label className={styles.searchField}>
        Club
        <select name="club" onChange={change("club")} value={selectValue(shown.clubIds)}>
          <option value="">Any club</option>
          {shown.clubIds.length > 1 ? <option value={PEOPLE_FILTER_SEVERAL}>Several ({shown.clubIds.length}), see Filters</option> : null}
          {clubOptions.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
        </select>
      </label>
      {roleKeys.length > 1 ? roleKeys.map((key) => <input key={key} name="keepRole" type="hidden" value={key} />) : null}
      {shown.eventIds.length > 1 ? shown.eventIds.map((id) => <input key={id} name="keepEvent" type="hidden" value={id} />) : null}
      {shown.clubIds.length > 1 ? shown.clubIds.map((id) => <input key={id} name="keepClub" type="hidden" value={id} />) : null}
      <button className="primary-button" type="submit">{active ? "Apply" : "Search"}</button>
      {query ? <Link className="secondary-button" href={peopleHref({ filters })} onClick={() => typing.cancel()}>Clear</Link> : null}
    </form>
  );
}
