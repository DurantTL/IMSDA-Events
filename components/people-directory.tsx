import Link from "next/link";
import { EmptyState, NoMatchesState } from "./empty-state";
import { ListPager } from "@/components/list-pager";
import type { ReactNode } from "react";
import type { PeopleRow } from "@/modules/system-admin/people-directory";
import {
  NO_PEOPLE_FILTERS,
  PEOPLE_PAGE_SIZE,
  eventRolesNeedEvent,
  needsEventPick,
  peopleFilterChips,
  peopleFilterCount,
  peopleFilterSummary,
  peopleHref,
  peopleRoleKey,
  peopleRoleOptions,
  personPath,
  type PeopleFilters,
} from "@/modules/system-admin/people-directory-model";
import { PEOPLE_STATUS_ID, PeopleActiveFilters } from "./people-active-filters";
import { PeopleQuickFilters } from "./people-quick-filters";
import styles from "./people-directory.module.css";

type Option = { id: string; name: string };

/** The Filters panel (#1321): checkboxes for several roles, events and clubs at once. A plain GET form, no JavaScript needed. */
function PeopleFilterPanel({ query, scope, filters, eventOptions, clubOptions }: {
  query: string;
  scope: "full" | "clubs";
  filters: PeopleFilters;
  eventOptions: readonly Option[];
  clubOptions: readonly Option[];
}) {
  const count = peopleFilterCount(filters);
  const chosenRoles = new Set(filters.roles.map(peopleRoleKey));
  const roleGroups = peopleRoleOptions(scope).filter((group) => group.label !== "Invites");
  return (
    <details className={styles.panel}>
      <summary className={styles.panelSummary}>
        Filters{count > 0 ? <span className="count-badge">{count} active</span> : null}
      </summary>
      <form action="/admin/people" className={styles.panelForm} method="get">
        {query ? <input name="q" type="hidden" value={query} /> : null}
        <fieldset className={styles.panelSet}>
          <legend>Roles (anyone with any of these)</legend>
          <div className={styles.panelScroll}>
            {roleGroups.map((group) => (
              <fieldset className={styles.panelGroup} key={group.label}>
                <legend className={styles.panelGroupLabel}>{group.label}</legend>
                {group.options.map((option) => (
                  <label className={styles.panelCheck} key={option.key}>
                    <input defaultChecked={chosenRoles.has(option.key)} name="role" type="checkbox" value={option.key} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </fieldset>
        {scope === "full" ? (
          <fieldset className={styles.panelSet}>
            <legend>Events (any event role there, or the roles chosen above)</legend>
            <div className={styles.panelScroll}>
              {eventOptions.map((event) => (
                <label className={styles.panelCheck} key={event.id}>
                  <input defaultChecked={filters.eventIds.includes(event.id)} name="event" type="checkbox" value={event.id} />
                  <span>{event.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <fieldset className={styles.panelSet}>
          <legend>Clubs (any club role there, or the roles chosen above)</legend>
          <div className={styles.panelScroll}>
            {clubOptions.map((club) => (
              <label className={styles.panelCheck} key={club.id}>
                <input defaultChecked={filters.clubIds.includes(club.id)} name="club" type="checkbox" value={club.id} />
                <span>{club.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className={styles.panelActions}>
          <button className="primary-button" type="submit">Apply filters</button>
          {count > 0 ? <Link className="secondary-button" href={peopleHref({})}>Clear filters</Link> : null}
        </div>
      </form>
    </details>
  );
}

/** The People & access list (#1275): search box, one row per person, Previous/Next. Server rendered, URL state. */
export function PeopleDirectory({
  query,
  rows,
  page,
  pageCount,
  total,
  scope = "full",
  filters = NO_PEOPLE_FILTERS,
  eventOptions = [],
  clubOptions = [],
  pending,
  pendingCount = 0,
  pendingCapped = false,
}: {
  /**
   * The Pending invites section (#1276, with Resend and Cancel): drawn between the search and the results when no role
   * filter is on, and as the results when the Pending invites filter is (#1277).
   */
  pending?: ReactNode;
  /** How many invites that section lists. */
  pendingCount?: number;
  scope?: "full" | "clubs";
  query: string;
  filters?: PeopleFilters;
  eventOptions?: readonly { id: string; name: string }[];
  clubOptions?: readonly { id: string; name: string }[];
  /** The pending list hit its row cap, so the count is a lower bound. */
  pendingCapped?: boolean;
  rows: readonly PeopleRow[];
  page: number;
  pageCount: number;
  total: number;
}) {
  const pickEvent = needsEventPick(filters);
  const pendingOnly = filters.roles.length === 1 && filters.roles[0].kind === "pending";
  const summary = peopleFilterSummary(filters, { eventOptions, clubOptions });
  const chips = peopleFilterChips({ filters, query, scope, eventOptions, clubOptions });
  return (
    <div className={styles.wrap}>
      <PeopleQuickFilters clubOptions={clubOptions} eventOptions={eventOptions} filters={filters} query={query} scope={scope} />
      <PeopleFilterPanel clubOptions={clubOptions} eventOptions={eventOptions} filters={filters} query={query} scope={scope} />
      <PeopleActiveFilters chips={chips} clearHref={peopleHref({})} />
      {peopleFilterCount(filters) === 0 || pendingOnly ? pending : null}
      <p aria-live="polite" className={styles.count} id={PEOPLE_STATUS_ID} role="status" tabIndex={-1}>
        {pickEvent
          ? "Pick an event to see who has this role."
          : pendingOnly
            ? pendingCount === 0
              ? "No pending invites."
              : `${pendingCapped ? "The newest " : ""}${pendingCount} pending ${pendingCount === 1 ? "invite" : "invites"}${query ? ` matching "${query}"` : ""}${pendingCapped ? ". Older ones are not listed; search to narrow the list." : "."}`
            : total === 0
              ? "No people found."
              : `${total} ${total === 1 ? "person" : "people"}${summary ? ` with ${summary}` : ""}${query ? ` matching "${query}"` : ""}.`}
        {eventRolesNeedEvent(filters) ? " Event roles need an event. Pick one to include them." : ""}
      </p>
      {pickEvent ? (
        <p className={styles.empty}>Pick an event to see who has this role. Event roles belong to one event at a time.</p>
      ) : pendingOnly ? (
        pendingCount === 0 ? <p className={styles.empty}>No pending invites{query ? " match that search" : ""}.</p> : pending
      ) : rows.length === 0 ? (
        query || peopleFilterCount(filters) > 0
          ? <NoMatchesState clear={{ href: peopleHref({}) }} noun="people" query={query} />
          : <EmptyState className="empty-state panel" title="Nobody has an account yet">Staff logins and website accounts appear here once someone signs up or is invited.</EmptyState>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li className={styles.row} key={row.key}>
              <Link className={styles.rowLink} href={`${personPath(row)}${query ? `?from=${encodeURIComponent(query)}` : ""}`}>
                <strong translate="no">{row.name || row.email}</strong>
                <small translate="no">{row.email}</small>
              </Link>
              <ul aria-label={scope === "full" ? "Account kinds and sign-in" : "Account kinds"} className={styles.chips}>
                {row.kinds.map((kind) => <li className="status-chip neutral" key={kind}>{kind}</li>)}
                {row.signIn.map((chip) => (
                  <li className={`status-chip ${chip.tone}`} key={chip.side}>
                    {row.signIn.length > 1 ? `${chip.side}: ` : ""}{chip.label}
                  </li>
                ))}
              </ul>
              <p className={styles.access}>{row.access.length > 0 ? row.access.join(" · ") : scope === "full" ? "No access yet" : "No Area Coordinator or club roles"}</p>
            </li>
          ))}
        </ul>
      )}
      {!pickEvent && !pendingOnly && total > 0 ? (
        <ListPager
          hrefFor={(next) => peopleHref({ query, page: next, filters })}
          label="Pages"
          noun="people"
          nounOne="person"
          slice={{ from: (page - 1) * PEOPLE_PAGE_SIZE + 1, to: Math.min(total, page * PEOPLE_PAGE_SIZE), page, pageCount, total }}
        />
      ) : null}
    </div>
  );
}
